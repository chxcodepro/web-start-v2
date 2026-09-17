import { revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { setGithubStar } from "@/lib/github";
import { requireOwner } from "@/lib/owner";
import { getSupabaseAdmin } from "@/lib/supabase";

const bodySchema = z.object({ id: z.string().uuid(), fullName: z.string().min(3).max(220), starred: z.boolean() });

export async function POST(request: NextRequest) {
  try {
    await requireOwner();
    const body = bodySchema.parse(await request.json());
    await setGithubStar(body.fullName, body.starred);
    const { error } = await getSupabaseAdmin().from("github_stars").update({ is_active: body.starred, synced_at: new Date().toISOString() }).eq("id", body.id);
    if (error) {
      await setGithubStar(body.fullName, !body.starred);
      throw error;
    }
    revalidateTag("github-stars", "max");
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "操作失败";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 500 });
  }
}
