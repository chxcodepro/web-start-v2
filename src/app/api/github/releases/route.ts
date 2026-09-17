import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getGithubGroups } from "@/lib/data";
import { getGithubDownloadCatalog } from "@/lib/github-downloads";
import { requireOwner } from "@/lib/owner";

const querySchema = z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/).max(220);

export async function GET(request: NextRequest) {
  try {
    const repository = querySchema.parse(request.nextUrl.searchParams.get("repo"));
    let isOwner = false;
    try { await requireOwner(); isOwner = true; } catch { /* Visitors may access public stars below. */ }
    if (!isOwner) {
      const publicStars = (await getGithubGroups(false)).flatMap((group) => group.items);
      const isPublicStar = publicStars.some((item) => item.fullName.toLowerCase() === repository.toLowerCase());
      if (!isPublicStar) return NextResponse.json({ error: "仓库未公开展示" }, { status: 404 });
    }
    return NextResponse.json(await getGithubDownloadCatalog(repository));
  } catch (error) {
    const message = error instanceof Error ? error.message : "获取 Release 失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
