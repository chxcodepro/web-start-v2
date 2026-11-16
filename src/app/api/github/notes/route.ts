import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/owner";
import { translateStarNotes } from "@/lib/star-notes-server";

export const runtime = "nodejs";
// 每次最多翻译约 45 秒；还有剩余时前端会接着请求
export const maxDuration = 60;

// 手动同步后调用：把还没有中文备注的项目分批翻译
export async function POST() {
  try {
    await requireOwner();
    const result = await translateStarNotes({ budgetMs: 45_000 });
    if (result.translated) revalidateTag("github-stars", "max");
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "请先登录" }, { status: 401 });
    console.error("[github-notes]", error);
    return NextResponse.json({ error: "翻译备注失败，请稍后重试" }, { status: 500 });
  }
}
