"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Bookmark, Globe2, Search } from "lucide-react";
import { BookmarkFavicon } from "@/components/bookmark-favicon";

type Engine = "bing" | "google";
type LocalItem = { title: string; url: string; group: string; tags: string[] };
type Suggestion = { id: string; label: string; type: "local" | "provider" | "action"; url?: string };

const engineUrls: Record<Engine, string> = {
  bing: "https://www.bing.com/search?q=",
  google: "https://www.google.com/search?q="
};

// 与书签卡片共用图标代理；Bing 网页声明的图标是放大镜，指定 favicon.ico 才是「b」字标
const engines = ([
  { id: "bing", name: "Bing", site: "https://www.bing.com/", favicon: "https://www.bing.com/favicon.ico" },
  { id: "google", name: "Google", site: "https://www.google.com/", favicon: null }
] as const).map(({ favicon, ...engine }) => {
  const params = new URLSearchParams({ type: "bookmark", site: engine.site });
  if (favicon) params.set("url", favicon);
  return { ...engine, icon: `/api/icon?${params}` };
});

function directUrl(raw: string) {
  const value = raw.trim();
  if (/^https?:\/\//i.test(value)) return value;
  if (/^(localhost|([a-z0-9-]+\.)+[a-z]{2,})(:\d+)?(\/[^\s]*)?$/i.test(value)) return `https://${value}`;
  return null;
}

function parseQuery(raw: string, current: Engine) {
  const matched = raw.trim().match(/^([gb])\s+(.+)$/i);
  if (!matched) return { engine: current, query: raw.trim() };
  return { engine: matched[1].toLowerCase() === "g" ? "google" as const : "bing" as const, query: matched[2].trim() };
}

export function SmartSearch({ bookmarks: bookmarkSource }: { bookmarks: Promise<LocalItem[] | null> }) {
  const [bookmarks, setBookmarks] = useState<LocalItem[]>([]);
  const [engine, setEngine] = useState<Engine>("bing");
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  // 首次读取本地偏好时直接定位滑块，只有用户切换时才播放滑动动画
  const [engineAnimated, setEngineAnimated] = useState(false);
  const [active, setActive] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // 搜索框不等待数据库：书签到达后再加入本地匹配，读取失败时保留已有结果
    let active = true;
    bookmarkSource.then((items) => { if (active && items) setBookmarks(items); }, () => {});
    return () => { active = false; };
  }, [bookmarkSource]);

  useEffect(() => {
    const saved = localStorage.getItem("start-page-search-engine");
    if (saved === "google" || saved === "bing") window.setTimeout(() => setEngine(saved), 0);
  }, []);

  useEffect(() => {
    const parsed = parseQuery(query, engine);
    if (parsed.query.length < 2 || directUrl(parsed.query)) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/search/suggestions?engine=${parsed.engine}&q=${encodeURIComponent(parsed.query)}`, { signal: controller.signal });
        if (response.ok) setRemote((await response.json()).suggestions ?? []);
      } catch (error) {
        if ((error as Error).name !== "AbortError") setRemote([]);
      }
    }, 180);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, engine]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  const suggestions = useMemo<Suggestion[]>(() => {
    const parsed = parseQuery(query, engine);
    const term = parsed.query.toLowerCase();
    if (!term) return [];
    const local = bookmarks.filter((item) => `${item.title} ${item.url} ${item.group} ${item.tags.join(" ")}`.toLowerCase().includes(term)).slice(0, 4).map((item) => ({ id: `local-${item.url}`, label: item.title, type: "local" as const, url: item.url }));
    const providerItems = term.length >= 2 && !directUrl(term) ? remote : [];
    const providers = providerItems.filter((label) => !local.some((item) => item.label.toLowerCase() === label.toLowerCase())).slice(0, 6).map((label) => ({ id: `provider-${label}`, label, type: "provider" as const }));
    return [...local, ...providers, { id: "search-action", label: `搜索“${parsed.query}”`, type: "action" as const }];
  }, [bookmarks, engine, query, remote]);

  function navigate(value: string, targetEngine = engine, newTab = false) {
    const parsed = parseQuery(value, targetEngine);
    const destination = directUrl(parsed.query) ?? `${engineUrls[parsed.engine]}${encodeURIComponent(parsed.query)}`;
    if (newTab) window.open(destination, "_blank", "noopener,noreferrer"); else window.location.assign(destination);
  }

  function choose(item: Suggestion, newTab = false) {
    if (item.type === "local" && item.url) {
      if (newTab) window.open(item.url, "_blank", "noopener,noreferrer"); else window.location.assign(item.url);
    } else navigate(item.type === "action" ? parseQuery(query, engine).query : item.label, parseQuery(query, engine).engine, newTab);
    setOpen(false);
  }

  function chooseEngine(value: Engine, focusInput = true) {
    setEngineAnimated(true);
    if (value !== engine) {
      setEngine(value);
      setRemote([]);
      localStorage.setItem("start-page-search-engine", value);
    }
    if (focusInput) { setOpen(true); inputRef.current?.focus(); }
  }

  // 单选组键盘约定：方向键切换引擎并把焦点留在切换器上
  function moveEngine(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const step = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
    const index = engines.findIndex((item) => item.id === engine);
    const next = engines[(index + step + engines.length) % engines.length].id;
    chooseEngine(next, false);
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-engine="${next}"]`)?.focus();
  }

  return (
    <div className={`search-wrap ${open ? "search-active" : ""}`} ref={rootRef}>
      <form className="search-box glass" role="search" onSubmit={(event) => { event.preventDefault(); if (query.trim()) navigate(query, engine); }}>
        <div className={`engine-switch ${engineAnimated ? "is-animated" : ""}`} data-engine={engine} role="radiogroup" aria-label="搜索引擎" onKeyDown={moveEngine}>
          <span className="engine-switch-thumb" aria-hidden="true" />
          {engines.map((item) => <button key={item.id} type="button" role="radio" className="engine-option" data-engine={item.id} aria-checked={engine === item.id} aria-label={item.name} title={engine === item.id ? `正在使用 ${item.name}` : `切换到 ${item.name}`} tabIndex={engine === item.id ? 0 : -1} onClick={() => chooseEngine(item.id)}>
            <BookmarkFavicon className="engine-icon" src={item.icon} title={item.name} />
          </button>)}
        </div>
        <label className="sr-only" htmlFor="search-query">搜索或输入网址</label>
        <input ref={inputRef} id="search-query" className="search-input" autoComplete="off" value={query} placeholder="搜索或输入网址" onFocus={() => setOpen(true)} onChange={(event) => { setQuery(event.target.value); setRemote([]); setOpen(true); setActive(-1); }} onKeyDown={(event) => {
          if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); setActive((value) => Math.min(value + 1, suggestions.length - 1)); }
          if (event.key === "ArrowUp") { event.preventDefault(); setActive((value) => Math.max(value - 1, -1)); }
          if (event.key === "Escape") { setOpen(false); setActive(-1); }
          if (event.key === "Enter" && active >= 0) { event.preventDefault(); choose(suggestions[active], event.shiftKey); }
          else if (event.key === "Enter" && event.shiftKey && query.trim()) { event.preventDefault(); navigate(query, engine, true); }
        }} />
        <button className="search-submit" type="submit" aria-label="搜索"><Search size={21} aria-hidden="true" /></button>
      </form>
      {open && suggestions.length > 0 && <div className="suggestions glass" role="listbox" aria-label="搜索建议">
        {suggestions.map((item, index) => {
          const firstLocal = item.type === "local" && (index === 0 || suggestions[index - 1]?.type !== "local");
          const firstRemote = item.type === "provider" && (index === 0 || suggestions[index - 1]?.type !== "provider");
          return <div key={item.id}>
            {firstLocal && <div className="suggestion-label">我的书签</div>}
            {firstRemote && <div className="suggestion-label">{parseQuery(query, engine).engine === "google" ? "Google" : "Bing"} 建议</div>}
            <button type="button" role="option" aria-selected={active === index} className={`suggestion-item ${active === index ? "selected" : ""}`} onPointerMove={() => setActive(index)} onClick={() => choose(item)}>
              {item.type === "local" ? <Bookmark size={17} aria-hidden="true" /> : item.type === "action" ? <Search size={17} aria-hidden="true" /> : <Globe2 size={17} aria-hidden="true" />}
              <span>{item.label}</span>
              <span className="suggestion-source">{item.type === "local" ? "书签" : item.type === "action" ? "Enter" : "建议"}</span>
            </button>
          </div>;
        })}
      </div>}
    </div>
  );
}
