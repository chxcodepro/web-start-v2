import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOwner } from "@/lib/owner";
import { loadSiteMetadata } from "@/lib/site-metadata";

export const runtime = "nodejs";

const schema = z.object({
  url: z.string().trim().url().refine((value) => ["http:", "https:"].includes(new URL(value).protocol), "网址只支持 http 或 https")
});

export async function POST(request: NextRequest) {
  try {
    await requireOwner();
    const { url } = schema.parse(await request.json());
    const metadata = await loadSiteMetadata(url);
    return NextResponse.json({ ok: true, ...metadata });
  } catch (error) {
    const message = error instanceof Error ? error.message : "无法读取网站信息";
    const status = message === "UNAUTHORIZED" ? 401 : error instanceof z.ZodError ? 400 : 422;
    return NextResponse.json({ error: message === "UNAUTHORIZED" ? "请先登录" : message }, { status });
  }
}
