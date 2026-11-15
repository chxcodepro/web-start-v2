import { CollectionSkeleton, SearchSkeleton } from "@/components/collection-skeleton";

export default function Loading() {
  return <main className="page-shell">
    <SearchSkeleton />
    <CollectionSkeleton kind="bookmark" />
  </main>;
}
