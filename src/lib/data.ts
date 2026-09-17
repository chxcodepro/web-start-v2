import { unstable_cache } from "next/cache";
import { demoBookmarkGroups, demoGithubGroups } from "@/lib/demo-data";
import { getSupabaseAdmin, hasDatabaseConfig } from "@/lib/supabase";
import type { Bookmark, BookmarkGroup, GithubGroup, GithubStar, Group } from "@/lib/types";

function mapGroup(row: Record<string, unknown>): Group {
  return { id: String(row.id), kind: row.kind as Group["kind"], name: String(row.name), sortOrder: Number(row.sort_order), isPublic: Boolean(row.is_public) };
}

function mapBookmark(row: Record<string, unknown>): Bookmark {
  return { id: String(row.id), groupId: String(row.group_id), title: String(row.title), url: String(row.url), description: row.description ? String(row.description) : null, faviconUrl: row.favicon_url ? String(row.favicon_url) : null, tags: Array.isArray(row.tags) ? row.tags.map(String) : [], sortOrder: Number(row.sort_order), isPublic: Boolean(row.is_public) };
}

function mapStar(row: Record<string, unknown>): GithubStar {
  const githubUpdatedAt = row.synced_at ? String(row.synced_at) : null;
  return { id: String(row.id), githubRepoId: Number(row.github_repo_id), groupId: row.group_id ? String(row.group_id) : null, fullName: String(row.full_name), displayName: row.display_name ? String(row.display_name) : null, htmlUrl: String(row.html_url), description: row.description ? String(row.description) : null, language: row.language ? String(row.language) : null, starsCount: Number(row.stars_count), ownerAvatarUrl: row.owner_avatar_url ? String(row.owner_avatar_url) : null, tags: Array.isArray(row.tags) ? row.tags.map(String) : [], note: row.note ? String(row.note) : null, sortOrder: Number(row.sort_order), isPublic: Boolean(row.is_public), isActive: Boolean(row.is_active), starredAt: row.starred_at ? String(row.starred_at) : null, syncedAt: githubUpdatedAt, repoUpdatedAt: githubUpdatedAt };
}

const loadBookmarks = unstable_cache(async (includePrivate = false): Promise<BookmarkGroup[]> => {
  const db = getSupabaseAdmin();
  let groupQuery = db.from("groups").select("*").eq("kind", "bookmark").order("sort_order");
  let itemQuery = db.from("bookmarks").select("*").order("sort_order");
  if (!includePrivate) { groupQuery = groupQuery.eq("is_public", true); itemQuery = itemQuery.eq("is_public", true); }
  const [{ data: groups, error: groupError }, { data: items, error: itemError }] = await Promise.all([groupQuery, itemQuery]);
  if (groupError || itemError) throw groupError ?? itemError;
  return (groups ?? []).map((row) => ({ ...mapGroup(row), items: (items ?? []).filter((item) => item.group_id === row.id).map(mapBookmark) }));
}, ["bookmarks"], { tags: ["bookmarks"], revalidate: 300 });

const loadStars = unstable_cache(async (includePrivate = false): Promise<GithubGroup[]> => {
  const db = getSupabaseAdmin();
  let groupQuery = db.from("groups").select("*").eq("kind", "github").order("sort_order");
  let itemQuery = db.from("github_stars").select("*").eq("is_active", true).order("sort_order");
  if (!includePrivate) { groupQuery = groupQuery.eq("is_public", true); itemQuery = itemQuery.eq("is_public", true); }
  const [{ data: groups, error: groupError }, { data: items, error: itemError }] = await Promise.all([groupQuery, itemQuery]);
  if (groupError || itemError) throw groupError ?? itemError;
  const mappedGroups = (groups ?? []).map((row) => ({ ...mapGroup(row), items: (items ?? []).filter((item) => item.group_id === row.id).map(mapStar) }));
  const ungrouped = (items ?? []).filter((item) => !item.group_id).map(mapStar);
  if (ungrouped.length || includePrivate) mappedGroups.push({ id: "ungrouped", kind: "github", name: "未分组", sortOrder: 9999, isPublic: true, items: ungrouped });
  return mappedGroups;
}, ["github-stars-v2"], { tags: ["github-stars"], revalidate: 300 });

export async function getBookmarkGroups(includePrivate = false) {
  if (!hasDatabaseConfig()) return demoBookmarkGroups;
  return loadBookmarks(includePrivate);
}

export async function getGithubGroups(includePrivate = false) {
  if (!hasDatabaseConfig()) return demoGithubGroups;
  return loadStars(includePrivate);
}
