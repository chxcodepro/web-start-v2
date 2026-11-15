import type { Metadata } from "next";
import { connection } from "next/server";
import { GithubStarBrowser } from "@/components/github-star-browser";
import { CollectionPending } from "@/components/silent-recovery";
import { loadStarCollection } from "@/lib/data";
import { viewerCanManage } from "@/lib/owner";

export const metadata: Metadata = { title: "GitHub Star" };

export default async function StarsPage() {
  // 始终按请求渲染，避免构建时把数据库失败的加载态固化成静态页面
  await connection();
  const canManage = await viewerCanManage();
  const result = await loadStarCollection(canManage);
  return <main className="page-shell">
    {result.status === "ready"
      ? <GithubStarBrowser groups={result.groups} canManage={canManage} />
      : <CollectionPending kind="github" />}
  </main>;
}
