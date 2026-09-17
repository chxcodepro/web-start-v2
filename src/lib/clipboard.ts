import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase";

const CLIPBOARD_BUCKET = "start-web-clipboard";
const MAX_CLIPBOARD_LENGTH = 100_000;

export type ClipboardRecord = {
  content: string;
  updatedAt: string;
  revision: string;
};

const emptyRecord = (): ClipboardRecord => ({ content: "", updatedAt: "", revision: "" });

function secret() {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error("剪切板服务尚未配置");
  return value;
}

export function validateClipboardPassword(password: string) {
  const normalized = password.trim();
  if (normalized.length < 6) throw new Error("密码至少需要 6 个字符");
  if (normalized.length > 128) throw new Error("密码不能超过 128 个字符");
  return normalized;
}

export function deriveClipboardKey(password: string) {
  return createHmac("sha256", secret()).update(`clipboard:${password}`, "utf8").digest("hex");
}

export function createClipboardToken(key: string) {
  const signature = createHmac("sha256", secret()).update(`clipboard-token:${key}`, "utf8").digest("base64url");
  return `${key}.${signature}`;
}

export function verifyClipboardToken(token: string) {
  const [key, suppliedSignature, extra] = token.split(".");
  if (extra || !key || !suppliedSignature || !/^[a-f0-9]{64}$/.test(key)) return null;
  const expectedSignature = createHmac("sha256", secret()).update(`clipboard-token:${key}`, "utf8").digest("base64url");
  const expected = Buffer.from(expectedSignature);
  const supplied = Buffer.from(suppliedSignature);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  return key;
}

export async function ensureClipboardBucket() {
  const storage = getSupabaseAdmin().storage;
  const { data, error } = await storage.getBucket(CLIPBOARD_BUCKET);
  if (data && !error) return;

  const { error: createError } = await storage.createBucket(CLIPBOARD_BUCKET, {
    public: false,
    fileSizeLimit: "128KB",
    allowedMimeTypes: ["application/json"]
  });
  if (createError && !/already exists|duplicate/i.test(createError.message)) throw createError;
}

function objectPath(key: string) {
  return `${key}.json`;
}

export async function readClipboard(key: string): Promise<ClipboardRecord> {
  await ensureClipboardBucket();
  const { data, error } = await getSupabaseAdmin().storage.from(CLIPBOARD_BUCKET).download(objectPath(key));
  if (error) {
    if (/not found|does not exist|404/i.test(error.message)) return emptyRecord();
    throw error;
  }

  try {
    const parsed = JSON.parse(await data.text()) as Partial<ClipboardRecord>;
    return {
      content: typeof parsed.content === "string" ? parsed.content : "",
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
      revision: typeof parsed.revision === "string" ? parsed.revision : ""
    };
  } catch {
    throw new Error("剪切板内容无法读取");
  }
}

export async function writeClipboard(key: string, content: string): Promise<ClipboardRecord> {
  if (content.length > MAX_CLIPBOARD_LENGTH) throw new Error("内容不能超过 100,000 个字符");
  await ensureClipboardBucket();
  const record: ClipboardRecord = {
    content,
    updatedAt: new Date().toISOString(),
    revision: randomUUID()
  };
  const { error } = await getSupabaseAdmin().storage.from(CLIPBOARD_BUCKET).upload(
    objectPath(key),
    JSON.stringify(record),
    { contentType: "application/json", upsert: true, cacheControl: "0" }
  );
  if (error) throw error;
  return record;
}
