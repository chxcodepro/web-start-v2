import { Suspense } from "react";
import { connection } from "next/server";
import { CollectionBoard } from "@/components/collection-board";
import { CollectionSkeleton } from "@/components/collection-skeleton";
import { CollectionPending } from "@/components/silent-recovery";
import { SmartSearch } from "@/components/smart-search";
import { loadBookmarkCollection, type CollectionResult } from "@/lib/data";
import { viewerCanManage } from "@/lib/owner";
import type { BookmarkGroup } from "@/lib/types";

export default async function HomePage() {
  // 始终按请求渲染，避免构建时把数据库失败的加载态固化成静态页面
  await connection();
  const canManage = await viewerCanManage();
  // 不在这里等待数据：搜索框先可用，书签区域在数据就绪前保持骨架屏
  const collection = loadBookmarkCollection(canManage);
  const searchItems = collection.then((result) => result.status === "ready"
    ? result.groups.flatMap((group) => group.items.map((item) => ({ title: item.title, url: item.url, group: group.name, tags: item.tags })))
    : null);
  return <main className="page-shell">
    <section className="hero">
      <SmartSearch bookmarks={searchItems} />
    </section>
    <Suspense fallback={<CollectionSkeleton kind="bookmark" />}>
      <BookmarkCollection collection={collection} canManage={canManage} />
    </Suspense>
  </main>;
}

async function BookmarkCollection({ collection, canManage }: { collection: Promise<CollectionResult<BookmarkGroup>>; canManage: boolean }) {
  const result = await collection;
  if (result.status === "unavailable") return <CollectionPending kind="bookmark" />;
  const groups = result.groups;
  return <CollectionBoard key={groups.map((group) => `${group.id}:${group.name}:${group.items.length}`).join("|")} kind="bookmark" groups={groups} canManage={canManage} />;
}
