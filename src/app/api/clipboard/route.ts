import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readClipboard, verifyClipboardToken, writeClipboard } from "@/lib/clipboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSchema = z.object({ content: z.string().max(100_000) });

function clipboardKey(request: NextRequest) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  return verifyClipboardToken(token);
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store, max-age=0" } });
}

export async function GET(request: NextRequest) {
  try {
    const key = clipboardKey(request);
    if (!key) return json({ error: "剪切板凭证无效，请重新输入密码" }, 401);
    return json(await readClipboard(key));
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "读取失败" }, 500);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const key = clipboardKey(request);
    if (!key) return json({ error: "剪切板凭证无效，请重新输入密码" }, 401);
    const { content } = updateSchema.parse(await request.json());
    return json(await writeClipboard(key, content));
  } catch (error) {
    const status = error instanceof z.ZodError ? 400 : 500;
    return json({ error: error instanceof Error ? error.message : "保存失败" }, status);
  }
}
