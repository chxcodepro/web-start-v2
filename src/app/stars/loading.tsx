import { CollectionSkeleton } from "@/components/collection-skeleton";

export default function Loading() {
  return <main className="page-shell">
    <CollectionSkeleton kind="github" />
  </main>;
}
