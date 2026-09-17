import { getSupabaseAdmin } from "@/lib/supabase";

const apiBase = "https://api.github.com";

function headers() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN 尚未配置");
  return { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" };
}

export async function setGithubStar(fullName: string, starred: boolean) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fullName)) throw new Error("仓库名称无效");
  const response = await fetch(`${apiBase}/user/starred/${fullName}`, { method: starred ? "PUT" : "DELETE", headers: headers(), cache: "no-store" });
  if (!response.ok) throw new Error(`GitHub 操作失败（${response.status}）`);
}

type StarredResponse = {
  starred_at: string;
  repo: {
    id: number; full_name: string; html_url: string; description: string | null; language: string | null;
    stargazers_count: number; updated_at: string; owner: { avatar_url: string | null };
  };
};

export async function syncGithubStars() {
  const all: StarredResponse[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const response = await fetch(`${apiBase}/user/starred?per_page=100&page=${page}`, { headers: { ...headers(), Accept: "application/vnd.github.star+json" }, cache: "no-store" });
    if (!response.ok) throw new Error(`GitHub 同步失败（${response.status}）`);
    const batch = await response.json() as StarredResponse[];
    all.push(...batch);
    if (batch.length < 100) break;
  }

  const db = getSupabaseAdmin();
  const now = new Date().toISOString();
  const repoIds = all.map((item) => item.repo.id);
  if (all.length) {
    const rows = all.map(({ starred_at, repo }) => ({
      github_repo_id: repo.id,
      full_name: repo.full_name,
      html_url: repo.html_url,
      description: repo.description,
      language: repo.language,
      stars_count: repo.stargazers_count,
      owner_avatar_url: repo.owner.avatar_url,
      is_active: true,
      starred_at,
      // Keep GitHub's repository update time in the existing metadata timestamp
      // column. The overall synchronization time is still returned by this function.
      synced_at: repo.updated_at
    }));
    const { error } = await db.from("github_stars").upsert(rows, { onConflict: "github_repo_id", ignoreDuplicates: false });
    if (error) throw error;
  }
  const { data: active, error: activeError } = await db.from("github_stars").select("github_repo_id").eq("is_active", true);
  if (activeError) throw activeError;
  const removed = (active ?? []).map((row) => Number(row.github_repo_id)).filter((id) => !repoIds.includes(id));
  if (removed.length) {
    const { error } = await db.from("github_stars").update({ is_active: false, synced_at: now }).in("github_repo_id", removed);
    if (error) throw error;
  }
  return { synced: all.length, archived: removed.length, at: now };
}
