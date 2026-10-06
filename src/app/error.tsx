"use client";

import { useEffect, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { usePathname } from "next/navigation";

export default function PageError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const key = `page-recovery:${pathname}`;
    let recovered = false;
    function recover() {
      if (recovered || !navigator.onLine) return;
      try {
        const lastAttempt = Number(sessionStorage.getItem(key));
        if (Date.now() - lastAttempt < 60000) return;
        sessionStorage.setItem(key, String(Date.now()));
      } catch {
        // Without persistent attempt tracking, keep retries user initiated.
        return;
      }
      recovered = true;
      startTransition(retry);
    }
    const timer = window.setTimeout(recover, 1500);
    window.addEventListener("online", recover);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("online", recover);
    };
  }, [pathname, retry]);

  return <main className="page-shell page-recovery" aria-busy={isPending}>
    <h1>暂时无法加载页面</h1>
    <p role="status">{isPending ? "正在重新连接…" : "连接暂时中断，请稍后重试。"}</p>
    <button className="soft-button" type="button" disabled={isPending} onClick={() => startTransition(retry)}>
      <RefreshCw size={18} aria-hidden="true" />{isPending ? "正在重试" : "重新加载"}
    </button>
  </main>;
}
