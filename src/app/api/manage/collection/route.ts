import { revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOwner } from "@/lib/owner";
import { getSupabaseAdmin } from "@/lib/supabase";

const id = z.string().uuid();
const kind = z.enum(["bookmark", "github"]);
const name = z.string().trim().min(1).max(80);
const tags = z.array(z.string().trim().min(1).max(32)).max(20).default([]);
const url = z.string().trim().url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === "http:" || protocol === "https:";
}, "网址只支持 http 或 https");
const faviconUrl = url.nullable().optional();

const createSchema = z.discriminatedUnion("entity", [
  z.object({ entity: z.literal("group"), kind, name: z.string().trim().min(1).max(40) }),
  z.object({
    entity: z.literal("bookmark"),
    groupId: id,
    title: name,
    url,
    faviconUrl,
    description: z.string().trim().max(300).default(""),
    tags,
    isPublic: z.boolean().default(true)
  })
]);

const updateSchema = z.discriminatedUnion("entity", [
  z.object({ entity: z.literal("group"), id, kind, name: z.string().trim().min(1).max(40) }),
  z.object({
    entity: z.literal("bookmark"),
    id,
    groupId: id,
    title: name,
    url,
    faviconUrl,
    description: z.string().trim().max(300).default(""),
    tags,
    isPublic: z.boolean().default(true)
  }),
  z.object({
    entity: z.literal("star"),
    id,
    groupId: id.nullable(),
    displayName: z.string().trim().max(80).default(""),
    note: z.string().trim().max(500).default(""),
    tags,
    isPublic: z.boolean().default(true)
  }),
  z.object({
    entity: z.literal("bulk"),
    kind,
    ids: z.array(id).min(1).max(500),
    groupId: id.nullable()
  })
]);

const deleteSchema = z.discriminatedUnion("entity", [
  z.object({ entity: z.literal("group"), id, kind }),
  z.object({ entity: z.literal("bookmark"), id })
]);

class RequestError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

function cacheTag(value: "bookmark" | "github") {
  return value === "bookmark" ? "bookmarks" : "github-stars";
}

async function assertGroup(groupId: string, expectedKind: "bookmark" | "github") {
  const { data, error } = await getSupabaseAdmin().from("groups").select("id").eq("id", groupId).eq("kind", expectedKind).maybeSingle();
  if (error) throw error;
  if (!data) throw new RequestError("目标分组不存在");
}

function responseError(error: unknown) {
  const message = error instanceof Error ? error.message : "保存失败";
  const status = message === "UNAUTHORIZED" ? 401 : error instanceof RequestError ? error.status : error instanceof z.ZodError ? 400 : 500;
  return NextResponse.json({ error: message === "UNAUTHORIZED" ? "请先登录" : message }, { status });
}

export async function POST(request: NextRequest) {
  try {
    await requireOwner();
    const body = createSchema.parse(await request.json());
    const db = getSupabaseAdmin();

    if (body.entity === "group") {
      const { count, error: countError } = await db.from("groups").select("id", { count: "exact", head: true }).eq("kind", body.kind);
      if (countError) throw countError;
      const { data: created, error } = await db.from("groups").insert({ kind: body.kind, name: body.name, sort_order: count ?? 0, is_public: true }).select("id, name, is_public").single();
      if (error) throw error;
      revalidateTag(cacheTag(body.kind), "max");
      return NextResponse.json({ ok: true, group: { id: created.id, name: created.name, isPublic: created.is_public } });
    } else {
      await assertGroup(body.groupId, "bookmark");
      const { count, error: countError } = await db.from("bookmarks").select("id", { count: "exact", head: true }).eq("group_id", body.groupId);
      if (countError) throw countError;
      const { data: created, error } = await db.from("bookmarks").insert({
        group_id: body.groupId,
        title: body.title,
        url: body.url,
        favicon_url: body.faviconUrl || null,
        description: body.description || null,
        tags: body.tags,
        is_public: body.isPublic,
        sort_order: count ?? 0
      }).select("id, group_id, title, url, description, favicon_url, tags, is_public").single();
      if (error) throw error;
      revalidateTag("bookmarks", "max");
      return NextResponse.json({
        ok: true,
        bookmark: {
          id: created.id,
          groupId: created.group_id,
          title: created.title,
          url: created.url,
          description: created.description,
          faviconUrl: created.favicon_url,
          tags: created.tags,
          isPublic: created.is_public
        }
      });
    }
  } catch (error) {
    return responseError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    await requireOwner();
    const body = updateSchema.parse(await request.json());
    const db = getSupabaseAdmin();

    if (body.entity === "group") {
      const { error } = await db.from("groups").update({ name: body.name }).eq("id", body.id).eq("kind", body.kind);
      if (error) throw error;
      revalidateTag(cacheTag(body.kind), "max");
    } else if (body.entity === "bookmark") {
      await assertGroup(body.groupId, "bookmark");
      const { error } = await db.from("bookmarks").update({
        group_id: body.groupId,
        title: body.title,
        url: body.url,
        ...(body.faviconUrl !== undefined ? { favicon_url: body.faviconUrl || null } : {}),
        description: body.description || null,
        tags: body.tags,
        is_public: body.isPublic
      }).eq("id", body.id);
      if (error) throw error;
      revalidateTag("bookmarks", "max");
    } else if (body.entity === "star") {
      if (body.groupId) await assertGroup(body.groupId, "github");
      const { error } = await db.from("github_stars").update({
        group_id: body.groupId,
        display_name: body.displayName || null,
        note: body.note || null,
        tags: body.tags,
        is_public: body.isPublic
      }).eq("id", body.id);
      if (error) throw error;
      revalidateTag("github-stars", "max");
    } else {
      if (body.kind === "bookmark" && !body.groupId) throw new RequestError("书签必须选择分组");
      if (body.groupId) await assertGroup(body.groupId, body.kind);
      const table = body.kind === "bookmark" ? "bookmarks" : "github_stars";
      const { error } = await db.from(table).update({ group_id: body.groupId }).in("id", body.ids);
      if (error) throw error;
      revalidateTag(cacheTag(body.kind), "max");
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return responseError(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await requireOwner();
    const body = deleteSchema.parse(await request.json());
    const db = getSupabaseAdmin();

    if (body.entity === "bookmark") {
      const { error } = await db.from("bookmarks").delete().eq("id", body.id);
      if (error) throw error;
      revalidateTag("bookmarks", "max");
    } else {
      const itemTable = body.kind === "bookmark" ? "bookmarks" : "github_stars";
      const { count, error: countError } = await db.from(itemTable).select("id", { count: "exact", head: true }).eq("group_id", body.id);
      if (countError) throw countError;
      if ((count ?? 0) > 0) throw new RequestError("请先移动或删除分组中的内容", 409);
      const { error } = await db.from("groups").delete().eq("id", body.id).eq("kind", body.kind);
      if (error) throw error;
      revalidateTag(cacheTag(body.kind), "max");
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return responseError(error);
  }
}
