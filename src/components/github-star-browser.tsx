import { CollectionBoard } from "@/components/collection-board";
import type { GithubGroup } from "@/lib/types";

export function GithubStarBrowser({ groups, canManage }: { groups: GithubGroup[]; canManage: boolean }) {
  return <CollectionBoard key={groups.map((group) => `${group.id}:${group.name}:${group.items.length}`).join("|")} kind="github" groups={groups} canManage={canManage} />;
}
