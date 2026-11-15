"use client";

import { usePathname } from "next/navigation";
import { CollectionSkeleton, SearchSkeleton } from "@/components/collection-skeleton";
import { useSilentRecovery } from "@/components/silent-recovery";

// 数据流中断等意外错误：继续显示加载骨架屏并在后台静默恢复，不展示错误页
export default function PageError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const pathname = usePathname();
  const notice = useSilentRecovery(`page:${pathname}`, retry);

  if (pathname === "/") {
    return <main className="page-shell">
      <SearchSkeleton />
      <CollectionSkeleton kind="bookmark" notice={notice} />
    </main>;
  }
  if (pathname.startsWith("/stars")) {
    return <main className="page-shell">
      <CollectionSkeleton kind="github" notice={notice} />
    </main>;
  }
  return <main className="page-shell page-recovery" role="status" aria-busy="true">
    <p>{notice ?? "正在加载…"}</p>
  </main>;
}
