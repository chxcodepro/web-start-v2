import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  createClipboardToken,
  deriveClipboardKey,
  readClipboard,
  validateClipboardPassword
} from "@/lib/clipboard";

export const runtime = "nodejs";

const schema = z.object({ password: z.string() });

export async function POST(request: NextRequest) {
  try {
    const { password: rawPassword } = schema.parse(await request.json());
    const password = validateClipboardPassword(rawPassword);
    const key = deriveClipboardKey(password);
    const record = await readClipboard(key);
    return NextResponse.json({ token: createClipboardToken(key), ...record }, {
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "无法打开剪切板";
    const status = error instanceof z.ZodError || /密码/.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
