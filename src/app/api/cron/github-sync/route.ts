import { revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { syncGithubStars } from "@/lib/github";
import { translateStarNotes, type NoteTranslation } from "@/lib/star-notes-server";

export const runtime = "nodejs";
// 同步之后还要翻译新项目的备注，留足时间
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const result = await syncGithubStars();
    revalidateTag("github-stars", "max");
    // 把新项目的英文简介翻译成中文备注；AI 没配置或出错都不影响同步结果，没翻完的留到下一次
    const notes: NoteTranslation = await translateStarNotes({ budgetMs: 35_000 })
      .catch((error: unknown) => ({ translated: 0, pending: 0, error: error instanceof Error ? error.message : "翻译备注失败" }));
    if (notes.translated) revalidateTag("github-stars", "max");
    return NextResponse.json({ ...result, notes });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "同步失败" }, { status: 500 });
  }
}
