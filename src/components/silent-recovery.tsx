"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CollectionSkeleton } from "@/components/collection-skeleton";

const FIRST_DELAY_MS = 800;
const MAX_DELAY_MS = 15000;
const NOTICE_AFTER_MS = 10000;
// 距离上次失败超过该时长视为新一轮，从最短等待重新开始
const EPISODE_GAP_MS = 60000;

type Episode = { failures: number; since: number; last: number };

// 放在模块级：错误边界重建组件时，退避进度和累计等待时长不会被重置
const episodes = new Map<string, Episode>();

/**
 * 保持加载态并在后台静默重试：指数退避，标签页隐藏或离线时暂停，
 * 恢复可见或联网后继续。返回需要展示给用户的轻量提示（没有则为 undefined）。
 */
export function useSilentRecovery(key: string, retry: () => void) {
  const [isPending, startTransition] = useTransition();
  const [slow, setSlow] = useState(false);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    // 刷新进行中：成功时组件会被真实内容替换，失败时 isPending 回落后再次进入这里
    if (isPending) return;
    const now = Date.now();
    const previous = episodes.get(key);
    const episode = previous && now - previous.last < EPISODE_GAP_MS
      ? { failures: previous.failures + 1, since: previous.since, last: now }
      : { failures: 1, since: now, last: now };
    episodes.set(key, episode);

    let due = false;
    let started = false;
    const attempt = () => {
      if (!due || started || document.visibilityState === "hidden") return;
      if (!navigator.onLine) { setOffline(true); return; }
      started = true;
      setOffline(false);
      startTransition(retry);
    };
    const retryTimer = window.setTimeout(() => { due = true; attempt(); }, Math.min(FIRST_DELAY_MS * 2 ** (episode.failures - 1), MAX_DELAY_MS));
    const noticeTimer = window.setTimeout(() => setSlow(true), Math.max(0, episode.since + NOTICE_AFTER_MS - now));
    const onOnline = () => { setOffline(false); attempt(); };
    const onOffline = () => setOffline(true);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", attempt);
    return () => {
      window.clearTimeout(retryTimer);
      window.clearTimeout(noticeTimer);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", attempt);
    };
  }, [isPending, key, retry]);

  if (offline) return "网络已断开，恢复连接后会自动加载";
  return slow ? "数据加载较慢，请稍候…" : undefined;
}

// 服务端读取失败时渲染：外观与加载骨架屏一致，后台刷新当前路由直到拿到数据
export function CollectionPending({ kind }: { kind: "bookmark" | "github" }) {
  const router = useRouter();
  const refresh = useCallback(() => router.refresh(), [router]);
  const notice = useSilentRecovery(`collection:${kind}`, refresh);
  return <CollectionSkeleton kind={kind} notice={notice} />;
}
