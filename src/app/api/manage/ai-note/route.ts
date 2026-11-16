import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AiRequestError } from "@/lib/ai";
import { requireOwner } from "@/lib/owner";
import { NoteError, analyzeStarNote } from "@/lib/star-notes-server";

export const runtime = "nodejs";
// 要先读 README 再等 AI 生成，留足时间
export const maxDuration = 60;

const schema = z.object({ id: z.string().uuid() });

// 编辑弹窗的「AI 分析」：只返回生成的备注，用户确认后随表单一起保存
export async function POST(request: NextRequest) {
  try {
    await requireOwner();
    const { id } = schema.parse(await request.json());
    return NextResponse.json(await analyzeStarNote(id));
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "请先登录" }, { status: 401 });
    if (error instanceof z.ZodError) return NextResponse.json({ error: "请求参数不正确" }, { status: 400 });
    if (error instanceof NoteError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof AiRequestError) return NextResponse.json({ error: error.message, retryable: error.retryable }, { status: error.status });
    console.error("[ai-note]", error);
    return NextResponse.json({ error: "AI 分析失败，请稍后重试" }, { status: 500 });
  }
}
