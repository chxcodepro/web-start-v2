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
    id: number; full_name: string; html_url: string; description: string | null; language: string | null; topics?: string[];
    stargazers_count: number; updated_at: string; pushed_at: string | null; owner: { avatar_url: string | null };
  };
};

// 「AI 分析」备注时作为资料；没有 README、仓库名不合法或请求失败时返回空字符串
export async function fetchReadme(fullName: string) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fullName)) return "";
  const token = process.env.GITHUB_TOKEN;
  try {
    const response = await fetch(`${apiBase}/repos/${fullName}/readme`, {
      headers: { Accept: "application/vnd.github.raw+json", "X-GitHub-Api-Version": "2022-11-28", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      cache: "no-store",
      signal: AbortSignal.timeout(8000)
    });
    return response.ok ? (await response.text()).slice(0, 60_000) : "";
  } catch {
    return "";
  }
}

// 数据库还没执行 003_star_topics.sql 时 PostgREST 会报缺列
function isMissingTopicsColumn(error: { code?: string; message?: string }) {
  return (error.code === "PGRST204" || error.code === "42703") && /topics/i.test(error.message ?? "");
}

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
    const baseRows = all.map(({ starred_at, repo }) => ({
      github_repo_id: repo.id,
      full_name: repo.full_name,
      html_url: repo.html_url,
      description: repo.description,
      language: repo.language,
      stars_count: repo.stargazers_count,
      owner_avatar_url: repo.owner.avatar_url,
      is_active: true,
      starred_at,
      // For a start page, the last code push is more useful than GitHub's generic
      // metadata update time, which can change without repository code changing.
      synced_at: repo.pushed_at ?? repo.updated_at
    }));
    // topics 是给仓库分组最有用的信号，AI 整理会用到
    const rows = baseRows.map((row, index) => ({ ...row, topics: (all[index].repo.topics ?? []).slice(0, 20) }));
    let { error } = await db.from("github_stars").upsert(rows, { onConflict: "github_repo_id", ignoreDuplicates: false });
    if (error && isMissingTopicsColumn(error)) {
      // 迁移未执行时先不写 topics，避免每日同步整体失败
      console.warn("[github] github_stars 缺少 topics 列，请执行 supabase/migrations/003_star_topics.sql");
      ({ error } = await db.from("github_stars").upsert(baseRows, { onConflict: "github_repo_id", ignoreDuplicates: false }));
    }
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
