import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { syncGithubStars } from "@/lib/github";
import { requireOwner } from "@/lib/owner";

export async function POST() {
  try {
    await requireOwner();
    const result = await syncGithubStars();
    revalidateTag("github-stars", "max");
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "同步失败";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 500 });
  }
}
