import { revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { syncGithubStars } from "@/lib/github";

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const result = await syncGithubStars();
    revalidateTag("github-stars", "max");
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "同步失败" }, { status: 500 });
  }
}
