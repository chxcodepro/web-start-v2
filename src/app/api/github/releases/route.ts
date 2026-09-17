import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getGithubDownloadCatalog } from "@/lib/github-downloads";
import { requireOwner } from "@/lib/owner";

const querySchema = z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/).max(220);

export async function GET(request: NextRequest) {
  try {
    await requireOwner();
    const repository = querySchema.parse(request.nextUrl.searchParams.get("repo"));
    return NextResponse.json(await getGithubDownloadCatalog(repository));
  } catch (error) {
    const message = error instanceof Error ? error.message : "获取 Release 失败";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 500 });
  }
}
