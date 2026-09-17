import { revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOwner } from "@/lib/owner";
import { getSupabaseAdmin } from "@/lib/supabase";

const uuid = z.string().uuid();
const schema = z.discriminatedUnion("entity", [
  z.object({ entity: z.enum(["groups", "bookmarks", "github_stars"]), ids: z.array(uuid).max(500) }),
  z.object({
    entity: z.literal("move"),
    kind: z.enum(["bookmark", "github"]),
    itemId: uuid.optional(),
    itemIds: z.array(uuid).min(1).max(500).default([]),
    groupId: uuid.nullable(),
    orders: z.array(z.object({ groupId: uuid.nullable(), ids: z.array(uuid).max(500) })).min(1).max(500)
  })
]);

export async function POST(request: NextRequest) {
  try {
    await requireOwner();
    const body = schema.parse(await request.json());
    const db = getSupabaseAdmin();
    if (body.entity === "move") {
      const itemIds = body.itemIds.length ? body.itemIds : body.itemId ? [body.itemId] : [];
      if (!itemIds.length) throw new Error("没有可移动的项目");
      if (body.kind === "bookmark" && !body.groupId) throw new Error("书签必须选择分组");
      if (body.groupId) {
        const { data: group, error: groupError } = await db.from("groups").select("id").eq("id", body.groupId).eq("kind", body.kind).maybeSingle();
        if (groupError) throw groupError;
        if (!group) throw new Error("目标分组不存在");
      }
      const table = body.kind === "bookmark" ? "bookmarks" : "github_stars";
      const { error: moveError } = await db.from(table).update({ group_id: body.groupId }).in("id", itemIds);
      if (moveError) throw moveError;
      const results = await Promise.all(body.orders.flatMap((order) => order.ids.map((id, sort_order) => db.from(table).update({ sort_order }).eq("id", id))));
      const failed = results.find((result) => result.error)?.error;
      if (failed) throw failed;
      revalidateTag(body.kind === "github" ? "github-stars" : "bookmarks", "max");
      return NextResponse.json({ ok: true });
    }

    const results = await Promise.all(body.ids.map((id, sort_order) => db.from(body.entity).update({ sort_order }).eq("id", id)));
    const failed = results.find((result) => result.error)?.error;
    if (failed) throw failed;
    revalidateTag(body.entity === "github_stars" ? "github-stars" : "bookmarks", "max");
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "排序保存失败";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 500 });
  }
}
