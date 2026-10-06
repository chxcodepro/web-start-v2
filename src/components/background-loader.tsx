"use client";

import { useEffect } from "react";

const cacheName = "start-page-background-v1";
const endpoint = "/api/background";

export function BackgroundLoader() {
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    let cache: Cache | undefined;
    let loading = false;

    async function display(response: Response) {
      const blob = await response.blob();
      if (!blob.size || !blob.type.startsWith("image/")) throw new Error("Invalid background");
      const url = URL.createObjectURL(blob);
      try {
        const image = new Image();
        image.src = url;
        await image.decode();
        if (controller.signal.aborted) return;
        document.body.style.setProperty("--background-image", `url("${url}")`);
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = url;
      } finally {
        if (objectUrl !== url) URL.revokeObjectURL(url);
      }
    }

    async function refresh() {
      if (loading || controller.signal.aborted || !navigator.onLine) return;
      loading = true;
      try {
        for (let attempt = 0; attempt < 3 && !controller.signal.aborted; attempt += 1) {
          try {
            const response = await fetch(endpoint, {
              signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]),
              cache: attempt ? "reload" : "default"
            });
            if (!response.ok) throw new Error("Background unavailable");
            const saved = response.clone();
            await display(response);
            if (!controller.signal.aborted) await cache?.put(endpoint, saved).catch(() => {});
            return;
          } catch {
            if (attempt < 2 && !controller.signal.aborted) {
              await new Promise<void>((resolve) => {
                const finish = () => {
                  clearTimeout(timer);
                  controller.signal.removeEventListener("abort", finish);
                  resolve();
                };
                const timer = setTimeout(finish, 700 * 2 ** attempt);
                controller.signal.addEventListener("abort", finish, { once: true });
              });
            }
          }
        }
      } finally {
        loading = false;
      }
    }

    async function initialize() {
      try {
        cache = await caches.open(cacheName);
        const saved = await cache.match(endpoint);
        if (saved) await display(saved);
      } catch {
        // Storage is optional, including in private browsing.
      }
      await refresh();
    }

    void initialize();
    const onOnline = () => { void refresh(); };
    window.addEventListener("online", onOnline);
    return () => {
      controller.abort();
      window.removeEventListener("online", onOnline);
      document.body.style.removeProperty("--background-image");
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, []);

  return null;
}
