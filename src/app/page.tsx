import { auth } from "@/auth";
import { CollectionBoard } from "@/components/collection-board";
import { SmartSearch } from "@/components/smart-search";
import { getBookmarkGroups } from "@/lib/data";

export default async function HomePage() {
  const authConfigured = Boolean(process.env.AUTH_SECRET && process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET && process.env.GITHUB_OWNER_LOGIN);
  const session = authConfigured ? await auth() : null;
  const canManage = Boolean(session?.user);
  const groups = await getBookmarkGroups(canManage);
  const searchItems = groups.flatMap((group) => group.items.map((item) => ({ title: item.title, url: item.url, group: group.name, tags: item.tags })));
  return <main className="page-shell">
    <section className="hero">
      <SmartSearch bookmarks={searchItems} />
    </section>
    <CollectionBoard key={groups.map((group) => `${group.id}:${group.name}:${group.items.length}`).join("|")} kind="bookmark" groups={groups} canManage={canManage} />
  </main>;
}
