"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

export function SyncStarsButton({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [status, setStatus] = useState("");
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);
  async function sync() {
    if (pending) return;
    setPending(true); setFailed(false); setStatus("正在从 GitHub 同步…");
    try {
      const response = await fetch("/api/github/sync", { method: "POST", headers: { Accept: "application/json" } });
      const result = await response.json().catch(() => null) as { synced?: number; archived?: number; error?: string } | null;
      if (!response.ok) throw new Error(response.status === 401 ? "请先登录后同步" : result?.error ?? `同步失败（${response.status}）`);
      setStatus(`已同步 ${result?.synced ?? 0} 个，归档 ${result?.archived ?? 0} 个`);
      window.setTimeout(() => router.refresh(), 900);
    } catch (error) {
      setFailed(true);
      setStatus(error instanceof Error ? error.message : "同步失败，请稍后重试");
    } finally {
      setPending(false);
    }
  }
  return <div className={`inline-action ${compact ? "sync-compact" : ""}`}><button type="button" className={compact ? "star-sync-button" : "primary-button"} onClick={() => void sync()} disabled={pending} aria-busy={pending}><RefreshCw size={17} className={pending ? "spin" : ""} aria-hidden="true" />{pending ? "同步中" : compact ? "同步" : "立即同步"}</button>{status && <span className={`sync-feedback ${failed ? "error" : ""}`} role="status" aria-live="polite">{status}</span>}</div>;
}
