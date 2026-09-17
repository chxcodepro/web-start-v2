"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

export function BookmarkFavicon({ src, title, className = "favicon", fallback }: { src: string | null; title: string; className?: string; fallback?: ReactNode }) {
  const imageRef = useRef<HTMLImageElement>(null);
  const [status, setStatus] = useState<{ src: string | null; state: "loading" | "loaded" | "failed" }>({ src, state: src ? "loading" : "failed" });
  const imageState = status.src === src ? status.state : src ? "loading" : "failed";
  const fallbackContent = fallback ?? (title.trim().slice(0, 1).toUpperCase() || "·");

  useEffect(() => {
    const image = imageRef.current;
    if (!src || !image?.complete) return;
    setStatus({ src, state: image.naturalWidth > 0 ? "loaded" : "failed" });
  }, [src]);

  return <span className={className} aria-hidden="true">
    {imageState === "failed" && <span className="bookmark-favicon-fallback">{fallbackContent}</span>}
    {src && imageState !== "failed" && <img ref={imageRef} className={`bookmark-favicon-image ${imageState === "loaded" ? "is-loaded" : ""}`} src={src} alt="" width="44" height="44" draggable={false} onLoad={() => setStatus({ src, state: "loaded" })} onError={() => setStatus({ src, state: "failed" })} />}{/* eslint-disable-line @next/next/no-img-element */}
  </span>;
}
