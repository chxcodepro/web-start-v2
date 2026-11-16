"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

type NoteProgress = { translated?: number; pending?: number; skipped?: string; error?: string };

// 每次请求处理一部分，最多连续请求这么多次，防止异常情况下一直循环
const MAX_NOTE_ROUNDS = 30;

export function SyncStarsButton({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [status, setStatus] = useState("");
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);

  // 同步后把还没有中文备注的项目翻译成中文；AI 没配置时安静跳过
  async function translateNotes(summary: string) {
    let translated = 0;
    for (let round = 0; round < MAX_NOTE_ROUNDS; round += 1) {
      const response = await fetch("/api/github/notes", { method: "POST", headers: { Accept: "application/json" } }).catch(() => null);
      const result = await response?.json().catch(() => null) as NoteProgress | null;
      if (!response?.ok || !result || result.skipped) break;
      translated += result.translated ?? 0;
      if (!result.pending || !result.translated) break;
      setStatus(`${summary}，正在翻译备注，还剩 ${result.pending} 个`);
    }
    return translated;
  }

  async function sync() {
    if (pending) return;
    setPending(true); setFailed(false); setStatus("正在从 GitHub 同步…");
    try {
      const response = await fetch("/api/github/sync", { method: "POST", headers: { Accept: "application/json" } });
      const result = await response.json().catch(() => null) as { synced?: number; archived?: number; error?: string } | null;
      if (!response.ok) throw new Error(response.status === 401 ? "请先登录后同步" : result?.error ?? `同步失败（${response.status}）`);
      const summary = `已同步 ${result?.synced ?? 0} 个，归档 ${result?.archived ?? 0} 个`;
      setStatus(summary);
      window.setTimeout(() => router.refresh(), 900);
      const translated = await translateNotes(summary);
      setStatus(translated ? `${summary}，翻译了 ${translated} 条备注` : summary);
      if (translated) window.setTimeout(() => router.refresh(), 900);
    } catch (error) {
      setFailed(true);
      setStatus(error instanceof Error ? error.message : "同步失败，请稍后重试");
    } finally {
      setPending(false);
    }
  }
  return <div className={`inline-action ${compact ? "sync-compact" : ""}`}><button type="button" className={compact ? "star-sync-button" : "primary-button"} onClick={() => void sync()} disabled={pending} aria-busy={pending}><RefreshCw size={17} className={pending ? "spin" : ""} aria-hidden="true" />{pending ? "同步中" : compact ? "同步" : "立即同步"}</button>{status && <span className={`sync-feedback ${failed ? "error" : ""}`} role="status" aria-live="polite">{status}</span>}</div>;
}
