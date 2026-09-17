"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type FormEvent, type MouseEvent as ReactMouseEvent } from "react";
import {
  ArrowDown, ArrowDownUp, ArrowLeft, ArrowRight, Check, CheckSquare, ChevronDown, ClipboardPaste, Clock3, Download, Edit3, FileArchive, FolderInput,
  Github, GripVertical, LoaderCircle, MoreHorizontal, Plus, Search, Settings2, Square, Trash2, X
} from "lucide-react";
import { BookmarkFavicon } from "@/components/bookmark-favicon";
import { GroupSidebar } from "@/components/group-sidebar";
import { ManageDialog } from "@/components/manage-dialog";
import { SyncStarsButton } from "@/components/sync-stars-button";
import type { BookmarkGroup, GithubGroup } from "@/lib/types";

type BoardKind = "bookmark" | "github";
type SourceGroups = BookmarkGroup[] | GithubGroup[];
type StarSortMode = "manual" | "updated-desc" | "updated-asc";

type BoardItem = {
  id: string;
  groupId: string | null;
  title: string;
  canonicalTitle?: string;
  href: string;
  description: string;
  note: string;
  tags: string[];
  isPublic: boolean;
  iconUrl?: string | null;
  language?: string | null;
  updatedAt?: string | null;
};

type BoardGroup = {
  id: string;
  name: string;
  isPublic: boolean;
  items: BoardItem[];
};

type GithubDownloadFile = {
  id: string;
  name: string;
  size: number | null;
  contentType: string;
  kind: "asset" | "source";
  downloadUrl: string;
};

type GithubDownloadVersion = {
  id: string;
  name: string;
  tagName: string;
  publishedAt: string | null;
  prerelease: boolean;
  files: GithubDownloadFile[];
};

type GithubDownloadCatalog = {
  repository: string;
  defaultBranch: string;
  hasReleases: boolean;
  versions: GithubDownloadVersion[];
};

type DialogState =
  | { type: "add-group" }
  | { type: "add-bookmark"; groupId: string }
  | { type: "move" }
  | { type: "details"; itemId: string }
  | { type: "download"; itemId: string }
  | null;

const STAR_PAGE_SIZE = 40;
const updateDateFormatter = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });

function AutoLoadMore({ remaining, onLoad }: { remaining: number; onLoad: () => void }) {
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const node = triggerRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      observer.disconnect();
      onLoad();
    }, { rootMargin: "120px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [onLoad]);

  return <button ref={triggerRef} type="button" className="collection-load-more" onClick={onLoad} aria-label={`继续显示，剩余 ${remaining} 个`}><ArrowDown size={16} aria-hidden="true" /><span>向下滚动自动显示</span><small>剩余 {remaining}</small></button>;
}

function bookmarkIcon(url: string, custom: string | null) {
  try {
    const site = new URL(url).toString();
    const params = new URLSearchParams({ type: "bookmark", site });
    if (custom) params.set("url", custom);
    return `/api/icon?${params.toString()}`;
  } catch { return null; }
}

function githubIcon(source: string | null) {
  return source ? `/api/icon?type=github&url=${encodeURIComponent(source)}` : null;
}

function updatedLabel(value: string | null | undefined) {
  if (!value) return "更新时间未知";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "更新时间未知" : `${updateDateFormatter.format(date)} 更新`;
}

function repositoryName(fullName: string) {
  return fullName.split("/").filter(Boolean).at(-1) ?? fullName;
}

function fileSizeLabel(size: number | null) {
  if (size === null) return "大小由 GitHub 生成";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function startTitleScroll(event: ReactMouseEvent<HTMLElement>) {
  const title = event.currentTarget.querySelector<HTMLElement>(".card-title");
  if (!title) return;
  const text = title.firstElementChild as HTMLElement | null;
  if (!text) return;
  const overflow = Math.ceil(text.scrollWidth - title.clientWidth);
  if (overflow <= 1) return;
  title.style.setProperty("--title-overflow", `${overflow}px`);
  title.style.setProperty("--title-scroll-duration", `${Math.max(2.4, overflow / 28).toFixed(2)}s`);
  title.classList.add("is-overflowing");
}

function stopTitleScroll(event: ReactMouseEvent<HTMLElement>) {
  event.currentTarget.querySelector<HTMLElement>(".card-title")?.classList.remove("is-overflowing");
}

function normalize(kind: BoardKind, groups: SourceGroups): BoardGroup[] {
  if (kind === "bookmark") {
    return (groups as BookmarkGroup[]).map((group) => ({
      id: group.id,
      name: group.name,
      isPublic: group.isPublic,
      items: group.items.map((item) => ({
        id: item.id,
        groupId: item.groupId,
        title: item.title,
        href: item.url,
        description: item.description ?? "",
        note: "",
        tags: item.tags,
        isPublic: item.isPublic,
        iconUrl: bookmarkIcon(item.url, item.faviconUrl)
      }))
    }));
  }

  return (groups as GithubGroup[]).map((group) => ({
    id: group.id,
    name: group.name,
    isPublic: group.isPublic,
    items: group.items.map((item) => ({
      id: item.id,
      groupId: item.groupId,
      title: repositoryName(item.fullName),
      canonicalTitle: item.fullName,
      href: item.htmlUrl,
      description: item.description ?? "",
      note: item.note ?? "",
      tags: item.tags,
      isPublic: item.isPublic,
      language: item.language,
      iconUrl: githubIcon(item.ownerAvatarUrl),
      updatedAt: item.repoUpdatedAt
    }))
  }));
}

function tagsFrom(value: FormDataEntryValue | null) {
  return String(value ?? "").split(/[,，]/).map((item) => item.trim()).filter(Boolean).slice(0, 20);
}

function clipboardUrl(value: string) {
  const raw = value.trim().split(/\r?\n/, 1)[0]?.trim() ?? "";
  const candidate = /^https?:\/\//i.test(raw) ? raw : /^[\w.-]+\.[a-z]{2,}(?:[/:?#]|$)/i.test(raw) ? `https://${raw}` : "";
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.toString() : null;
  } catch { return null; }
}

export function CollectionBoard({ kind, groups: sourceGroups, canManage }: {
  kind: BoardKind;
  groups: SourceGroups;
  canManage: boolean;
}) {
  const [groups, setGroups] = useState(() => normalize(kind, sourceGroups));
  const [query, setQuery] = useState("");
  const [starSort, setStarSort] = useState<StarSortMode>("manual");
  const deferredQuery = useDeferredValue(query);
  const [visibleLimits, setVisibleLimits] = useState<Record<string, number>>({});
  const [managing, setManaging] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<DialogState>(null);
  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  const [groupDraft, setGroupDraft] = useState("");
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [itemDraft, setItemDraft] = useState({ title: "", href: "" });
  const [detailsGroupId, setDetailsGroupId] = useState("");
  const [detailsCreatingGroup, setDetailsCreatingGroup] = useState(false);
  const [detailsGroupDraft, setDetailsGroupDraft] = useState("");
  const [bookmarkDraft, setBookmarkDraft] = useState({ title: "", url: "", faviconUrl: "" });
  const [bookmarkLookup, setBookmarkLookup] = useState(false);
  const [downloadCatalog, setDownloadCatalog] = useState<GithubDownloadCatalog | null>(null);
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const [downloadVersionId, setDownloadVersionId] = useState("");
  const [downloadFileId, setDownloadFileId] = useState("");
  const [draggedItem, setDraggedItem] = useState<{ ids: string[]; sourceGroupIds: string[] } | null>(null);
  const [draggedGroup, setDraggedGroup] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const cardNodes = useRef(new Map<string, HTMLElement>());
  const metadataRequest = useRef(0);
  const downloadRequest = useRef(0);

  const closeDialog = useCallback(() => { metadataRequest.current += 1; downloadRequest.current += 1; setDialog(null); setMessage(""); setBookmarkLookup(false); setDownloadLoading(false); }, []);

  const visibleGroups = useMemo(() => {
    const term = deferredQuery.trim().toLowerCase();
    return groups.map((group) => {
      let items = term ? group.items.filter((item) => `${item.title} ${item.canonicalTitle ?? ""} ${item.description} ${item.note} ${item.language ?? ""} ${item.tags.join(" ")}`.toLowerCase().includes(term)) : group.items;
      if (kind === "github" && starSort !== "manual") {
        items = [...items].sort((left, right) => {
          const leftTime = left.updatedAt ? Date.parse(left.updatedAt) : Number.NaN;
          const rightTime = right.updatedAt ? Date.parse(right.updatedAt) : Number.NaN;
          if (Number.isNaN(leftTime)) return Number.isNaN(rightTime) ? 0 : 1;
          if (Number.isNaN(rightTime)) return -1;
          return starSort === "updated-desc" ? rightTime - leftTime : leftTime - rightTime;
        });
      }
      return { ...group, items };
    }).filter((group) => !term || group.items.length > 0);
  }, [groups, deferredQuery, kind, starSort]);

  async function api(method: string, body: unknown, endpoint = "/api/manage/collection") {
    const response = await fetch(endpoint, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error ?? "保存失败");
    return result;
  }

  async function fillBookmarkFromClipboard() {
    const requestId = ++metadataRequest.current;
    setBookmarkLookup(true); setMessage("正在读取剪贴板…");
    try {
      if (!navigator.clipboard?.readText) throw new Error("当前浏览器不支持读取剪贴板");
      const value = clipboardUrl(await navigator.clipboard.readText());
      if (!value) throw new Error("剪贴板中没有可用链接，请手动填写");
      const fallbackTitle = new URL(value).hostname.replace(/^www\./i, "");
      setBookmarkDraft({ title: fallbackTitle, url: value, faviconUrl: "" });
      setMessage("正在获取网站名称和图标…");
      const result = await api("POST", { url: value }, "/api/bookmark/metadata");
      if (metadataRequest.current !== requestId) return;
      setBookmarkDraft((current) => current.url === value ? {
        ...current,
        title: !current.title || current.title === fallbackTitle ? String(result.title || fallbackTitle) : current.title,
        faviconUrl: result.iconUrl ? String(result.iconUrl) : ""
      } : current);
      setMessage(result.title ? "已自动填入链接和网站名称" : "已填入链接，请确认名称");
    } catch (error) {
      if (metadataRequest.current === requestId) setMessage(error instanceof Error ? error.message : "读取剪贴板失败，请手动填写");
    } finally {
      if (metadataRequest.current === requestId) setBookmarkLookup(false);
    }
  }

  function openBookmarkDialog(groupId: string) {
    setBookmarkDraft({ title: "", url: "", faviconUrl: "" });
    setDialog({ type: "add-bookmark", groupId });
    setMessage("");
    void fillBookmarkFromClipboard();
  }

  function findItem(id: string) {
    for (const group of groups) {
      const item = group.items.find((candidate) => candidate.id === id);
      if (item) return item;
    }
    return null;
  }

  function updateItem(id: string, update: (item: BoardItem) => BoardItem) {
    setGroups((current) => current.map((group) => ({ ...group, items: group.items.map((item) => item.id === id ? update(item) : item) })));
  }

  function setGroupsWithMotion(nextGroups: BoardGroup[]) {
    const previousPositions = new Map<string, DOMRect>();
    cardNodes.current.forEach((node, id) => previousPositions.set(id, node.getBoundingClientRect()));
    setGroups(nextGroups);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    window.requestAnimationFrame(() => {
      cardNodes.current.forEach((node, id) => {
        const previous = previousPositions.get(id);
        if (!previous) return;
        const current = node.getBoundingClientRect();
        const x = previous.left - current.left;
        const y = previous.top - current.top;
        if (Math.abs(x) < 1 && Math.abs(y) < 1) return;
        node.animate([
          { transform: `translate(${x}px, ${y}px)`, opacity: 0.76 },
          { transform: "translate(0, 0)", opacity: 1 }
        ], { duration: 240, easing: "cubic-bezier(.2,.8,.2,1)" });
      });
    });
  }

  function beginItemEdit(item: BoardItem) {
    setEditingItem(item.id);
    setItemDraft({ title: item.title, href: item.href });
    setMessage("");
  }

  function openDetails(item: BoardItem) {
    setDetailsGroupId(item.groupId ?? "ungrouped");
    setDetailsCreatingGroup(false);
    setDetailsGroupDraft("");
    setDialog({ type: "details", itemId: item.id });
    setMessage("");
  }

  async function loadGithubDownloads(item: BoardItem) {
    const repository = item.canonicalTitle;
    if (!repository) { setDownloadError("缺少 GitHub 仓库名称"); return; }
    const requestId = ++downloadRequest.current;
    setDownloadLoading(true);
    setDownloadError("");
    try {
      const response = await fetch(`/api/github/releases?repo=${encodeURIComponent(repository)}`, { cache: "no-store" });
      const result = await response.json() as GithubDownloadCatalog & { error?: string };
      if (!response.ok) throw new Error(result.error || "获取 Release 失败");
      if (downloadRequest.current !== requestId) return;
      const firstVersion = result.versions[0];
      setDownloadCatalog(result);
      setDownloadVersionId(firstVersion?.id ?? "");
      setDownloadFileId(firstVersion?.files[0]?.id ?? "");
    } catch (error) {
      if (downloadRequest.current === requestId) setDownloadError(error instanceof Error ? error.message : "获取 Release 失败");
    } finally {
      if (downloadRequest.current === requestId) setDownloadLoading(false);
    }
  }

  function openDownload(item: BoardItem) {
    setDownloadCatalog(null);
    setDownloadVersionId("");
    setDownloadFileId("");
    setDownloadError("");
    setDialog({ type: "download", itemId: item.id });
    void loadGithubDownloads(item);
  }

  async function createDetailsGroup() {
    if (busy) return;
    const nextName = detailsGroupDraft.trim();
    if (!nextName) { setMessage("分组名称不能为空"); return; }
    setBusy(true); setMessage("正在创建分组…");
    try {
      const result = await api("POST", { entity: "group", kind, name: nextName });
      const created: BoardGroup = { id: String(result.group.id), name: String(result.group.name), isPublic: Boolean(result.group.isPublic), items: [] };
      setGroups((current) => {
        const ungroupedIndex = current.findIndex((group) => group.id === "ungrouped");
        if (ungroupedIndex < 0) return [...current, created];
        const next = [...current];
        next.splice(ungroupedIndex, 0, created);
        return next;
      });
      setDetailsGroupId(created.id);
      setDetailsCreatingGroup(false);
      setDetailsGroupDraft("");
      setMessage(`已创建并选中「${created.name}」`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "创建分组失败"); }
    finally { setBusy(false); }
  }

  async function saveInlineItem(item: BoardItem) {
    if (kind !== "bookmark") return;
    const title = itemDraft.title.trim();
    const href = itemDraft.href.trim();
    if (!title) { setMessage("名称不能为空"); return; }
    if (!/^https?:\/\//i.test(href)) { setMessage("请输入完整的 http 或 https 网址"); return; }
    setBusy(true); setMessage("保存中…");
    try {
      await api("PATCH", { entity: "bookmark", id: item.id, groupId: item.groupId, title, url: href, faviconUrl: href === item.href ? undefined : null, description: item.description, tags: item.tags, isPublic: item.isPublic });
      updateItem(item.id, (current) => ({ ...current, title, href, iconUrl: bookmarkIcon(href, null) }));
      setEditingItem(null); setMessage("已保存");
    } catch (error) { setMessage(error instanceof Error ? error.message : "保存失败"); }
    finally { setBusy(false); }
  }

  function beginGroupEdit(group: BoardGroup) {
    setEditingGroup(group.id);
    setGroupDraft(group.name);
    setMessage("");
  }

  async function saveGroup(group: BoardGroup) {
    const nextName = groupDraft.trim();
    if (!nextName) { setMessage("分组名称不能为空"); return; }
    setBusy(true); setMessage("保存中…");
    try {
      await api("PATCH", { entity: "group", id: group.id, kind, name: nextName });
      setGroups((current) => current.map((candidate) => candidate.id === group.id ? { ...candidate, name: nextName } : candidate));
      setEditingGroup(null); setMessage("已保存");
    } catch (error) { setMessage(error instanceof Error ? error.message : "保存失败"); }
    finally { setBusy(false); }
  }

  async function saveOrder(entity: "groups" | "bookmarks" | "github_stars", ids: string[]) {
    if (ids.length < 2) return;
    await api("POST", { entity, ids }, "/api/manage/reorder");
  }

  async function dropGroup(targetId: string) {
    if (!draggedGroup || draggedGroup === targetId || targetId === "ungrouped") return;
    const movable = groups.filter((group) => group.id !== "ungrouped");
    const from = movable.findIndex((group) => group.id === draggedGroup);
    const to = movable.findIndex((group) => group.id === targetId);
    if (from < 0 || to < 0) return;
    const nextMovable = [...movable];
    const [moved] = nextMovable.splice(from, 1); nextMovable.splice(to, 0, moved);
    const ungrouped = groups.find((group) => group.id === "ungrouped");
    const previous = groups;
    setGroups(ungrouped ? [...nextMovable, ungrouped] : nextMovable); setDraggedGroup(null);
    try { await saveOrder("groups", nextMovable.map((group) => group.id)); setMessage("顺序已保存"); }
    catch { setGroups(previous); setMessage("分组排序保存失败"); }
  }

  async function moveItemByOffset(groupId: string, itemId: string, offset: number) {
    const group = groups.find((candidate) => candidate.id === groupId);
    if (!group) return;
    const from = group.items.findIndex((item) => item.id === itemId);
    const to = Math.max(0, Math.min(group.items.length - 1, from + offset));
    if (from < 0 || from === to) return;
    const nextItems = [...group.items];
    const [moved] = nextItems.splice(from, 1); nextItems.splice(to, 0, moved);
    setGroups((current) => current.map((candidate) => candidate.id === groupId ? { ...candidate, items: nextItems } : candidate));
    try { await saveOrder(kind === "bookmark" ? "bookmarks" : "github_stars", nextItems.map((item) => item.id)); setMessage("顺序已保存"); }
    catch { setGroups(groups); setMessage("排序保存失败"); }
  }

  async function dropItem(targetGroupId: string, targetId?: string) {
    if (!draggedItem || query.trim()) return;
    const movedIds = new Set(draggedItem.ids);
    if (targetId && movedIds.has(targetId)) { setDraggedItem(null); return; }
    const previous = groups;
    const moved = groups.flatMap((group) => group.items.filter((item) => movedIds.has(item.id)));
    if (!moved.length) return;
    const next = groups.map((group) => ({ ...group, items: group.items.filter((item) => !movedIds.has(item.id)) }));
    const target = next.find((group) => group.id === targetGroupId);
    if (!target) return;
    const insertAt = targetId ? Math.max(0, target.items.findIndex((item) => item.id === targetId)) : target.items.length;
    const databaseGroupId = targetGroupId === "ungrouped" ? null : targetGroupId;
    target.items.splice(insertAt, 0, ...moved.map((item) => ({ ...item, groupId: databaseGroupId })));
    setGroupsWithMotion(next); setDraggedItem(null);
    setMessage("正在后台保存…");
    try {
      const affectedIds = new Set([...draggedItem.sourceGroupIds, targetGroupId]);
      await api("POST", {
        entity: "move",
        kind,
        itemIds: moved.map((item) => item.id),
        groupId: databaseGroupId,
        orders: next.filter((group) => affectedIds.has(group.id)).map((group) => ({ groupId: group.id === "ungrouped" ? null : group.id, ids: group.items.map((item) => item.id) }))
      }, "/api/manage/reorder");
      setMessage(moved.length > 1 ? `已移动 ${moved.length} 项` : "已保存");
    } catch (error) { setGroupsWithMotion(previous); setMessage(error instanceof Error ? error.message : "排序保存失败"); }
  }

  function beginItemDrag(event: ReactDragEvent<HTMLElement>, item: BoardItem, groupId: string) {
    const ids = selected.has(item.id) && selected.size > 1
      ? groups.flatMap((group) => group.items.filter((candidate) => selected.has(candidate.id)).map((candidate) => candidate.id))
      : [item.id];
    const idSet = new Set(ids);
    const sourceGroupIds = groups.filter((group) => group.items.some((candidate) => idSet.has(candidate.id))).map((group) => group.id);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", ids.join(","));
    const source = event.currentTarget;
    const preview = source.cloneNode(true) as HTMLElement;
    const bounds = source.getBoundingClientRect();
    preview.classList.remove("dragging", "selected");
    preview.classList.add("collection-drag-preview");
    if (ids.length > 1) {
      preview.classList.add("multi-drag-preview");
      const count = document.createElement("span");
      count.className = "drag-preview-count";
      count.textContent = `${ids.length} 项`;
      preview.appendChild(count);
    }
    preview.style.width = `${bounds.width}px`;
    document.body.appendChild(preview);
    event.dataTransfer.setDragImage(preview, Math.min(34, bounds.width / 3), Math.min(34, bounds.height / 2));
    window.setTimeout(() => preview.remove(), 0);
    setDraggedItem({ ids, sourceGroupIds: sourceGroupIds.length ? sourceGroupIds : [groupId] });
  }

  function toggleSelected(id: string) {
    setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("保存中…");
    const data = new FormData(event.currentTarget);
    try {
      if (dialog?.type === "add-group") {
        const result = await api("POST", { entity: "group", kind, name: String(data.get("name") ?? "") });
        const created: BoardGroup = { id: String(result.group.id), name: String(result.group.name), isPublic: Boolean(result.group.isPublic), items: [] };
        setGroups((current) => {
          const ungroupedIndex = current.findIndex((group) => group.id === "ungrouped");
          if (ungroupedIndex < 0) return [...current, created];
          const next = [...current];
          next.splice(ungroupedIndex, 0, created);
          return next;
        });
      } else if (dialog?.type === "add-bookmark") {
        const result = await api("POST", { entity: "bookmark", groupId: dialog.groupId, title: String(data.get("title") ?? ""), url: String(data.get("url") ?? ""), faviconUrl: bookmarkDraft.faviconUrl || null, description: String(data.get("description") ?? ""), tags: tagsFrom(data.get("tags")), isPublic: data.get("isPublic") === "on" });
        const created = result.bookmark;
        const item: BoardItem = {
          id: String(created.id),
          groupId: String(created.groupId),
          title: String(created.title),
          href: String(created.url),
          description: created.description ? String(created.description) : "",
          note: "",
          tags: Array.isArray(created.tags) ? created.tags.map(String) : [],
          isPublic: Boolean(created.isPublic),
          iconUrl: bookmarkIcon(String(created.url), created.faviconUrl ? String(created.faviconUrl) : null)
        };
        setGroups((current) => current.map((group) => group.id === dialog.groupId ? { ...group, items: [...group.items, item] } : group));
      }
      setDialog(null); setMessage("已添加");
    } catch (error) { setMessage(error instanceof Error ? error.message : "保存失败"); }
    finally { setBusy(false); }
  }

  async function submitMove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("移动中…");
    const data = new FormData(event.currentTarget);
    const selectedGroup = String(data.get("groupId") ?? "");
    const groupId = selectedGroup === "ungrouped" ? null : selectedGroup;
    try {
      await api("PATCH", { entity: "bulk", kind, ids: [...selected], groupId });
      const moving = groups.flatMap((group) => group.items.filter((item) => selected.has(item.id)));
      setGroups((current) => current.map((group) => {
        const kept = group.items.filter((item) => !selected.has(item.id));
        if (group.id === selectedGroup) return { ...group, items: [...kept, ...moving.map((item) => ({ ...item, groupId }))] };
        return { ...group, items: kept };
      }));
      setSelected(new Set()); setDialog(null); setMessage("已移动");
    } catch (error) { setMessage(error instanceof Error ? error.message : "移动失败"); }
    finally { setBusy(false); }
  }

  async function submitDetails(event: FormEvent<HTMLFormElement>, item: BoardItem) {
    event.preventDefault(); setBusy(true); setMessage("保存中…");
    const data = new FormData(event.currentTarget);
    const selectedGroup = String(data.get("groupId") ?? "");
    const groupId = selectedGroup === "ungrouped" ? null : selectedGroup;
    const title = String(data.get("title") ?? item.title).trim();
    const href = String(data.get("url") ?? item.href).trim();
    const description = String(data.get("description") ?? "").trim();
    const note = String(data.get("note") ?? "").trim();
    const nextTags = tagsFrom(data.get("tags"));
    const isPublic = data.get("isPublic") === "on";
    try {
      if (kind === "bookmark") await api("PATCH", { entity: "bookmark", id: item.id, groupId, title, url: href, faviconUrl: href === item.href ? undefined : null, description, tags: nextTags, isPublic });
      else await api("PATCH", { entity: "star", id: item.id, groupId, displayName: "", note, tags: nextTags, isPublic });
      const targetGroup = selectedGroup;
      const resolvedTitle = kind === "github" ? repositoryName(item.canonicalTitle ?? item.title) : title;
      setGroups((current) => {
        const without = current.map((group) => ({ ...group, items: group.items.filter((candidate) => candidate.id !== item.id) }));
        return without.map((group) => group.id === targetGroup ? { ...group, items: [...group.items, { ...item, groupId, title: resolvedTitle, href, description, note, tags: nextTags, isPublic, iconUrl: kind === "bookmark" && href !== item.href ? bookmarkIcon(href, null) : item.iconUrl }] } : group);
      });
      setDialog(null); setMessage("已保存");
    } catch (error) { setMessage(error instanceof Error ? error.message : "保存失败"); }
    finally { setBusy(false); }
  }

  async function removeItem(item: BoardItem) {
    setBusy(true); setMessage(kind === "bookmark" ? "删除中…" : "正在取消 Star…");
    try {
      if (kind === "bookmark") await api("DELETE", { entity: "bookmark", id: item.id });
      else await api("POST", { id: item.id, fullName: item.canonicalTitle ?? item.title, starred: false }, "/api/github/star");
      setGroups((current) => current.map((group) => ({ ...group, items: group.items.filter((candidate) => candidate.id !== item.id) })));
      setSelected((current) => { const next = new Set(current); next.delete(item.id); return next; });
      setDialog(null); setMessage(kind === "bookmark" ? "已删除" : "已取消 Star");
    } catch (error) { setMessage(error instanceof Error ? error.message : "操作失败"); }
    finally { setBusy(false); }
  }

  async function removeEmptyGroup(group: BoardGroup) {
    if (group.items.length || group.id === "ungrouped") return;
    setBusy(true);
    try {
      await api("DELETE", { entity: "group", id: group.id, kind });
      setGroups((current) => current.filter((candidate) => candidate.id !== group.id));
      setMessage("分组已删除");
    } catch (error) { setMessage(error instanceof Error ? error.message : "删除失败"); }
    finally { setBusy(false); }
  }

  const detailsItem = dialog?.type === "details" ? findItem(dialog.itemId) : null;
  const downloadItem = dialog?.type === "download" ? findItem(dialog.itemId) : null;
  const downloadVersion = downloadCatalog?.versions.find((version) => version.id === downloadVersionId) ?? downloadCatalog?.versions[0] ?? null;
  const downloadFile = downloadVersion?.files.find((file) => file.id === downloadFileId) ?? downloadVersion?.files[0] ?? null;
  const allVisibleIds = visibleGroups.flatMap((group) => group.items.map((item) => item.id));
  const allVisibleSelected = allVisibleIds.length > 0 && allVisibleIds.every((id) => selected.has(id));

  return <>
    {kind === "github" && <section className="star-toolbar" aria-label="GitHub Star 工具栏">
      <label className="star-search glass"><Search size={18} aria-hidden="true" /><span className="sr-only">搜索 GitHub Star</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索 GitHub Star" autoComplete="off" /></label>
      <label className="star-sort glass"><ArrowDownUp size={16} aria-hidden="true" /><span className="sr-only">GitHub Star 排序方式</span><select value={starSort} disabled={managing} onChange={(event) => setStarSort(event.target.value as StarSortMode)} aria-label="GitHub Star 排序方式"><option value="manual">自定义排序</option><option value="updated-desc">最近更新</option><option value="updated-asc">最早更新</option></select><ChevronDown size={15} aria-hidden="true" /></label>
      {canManage && <SyncStarsButton compact />}
    </section>}

    {canManage && <div className={`collection-toolbar ${managing ? "active" : ""}`}>
      <button type="button" className="toolbar-main" aria-pressed={managing} onClick={() => { if (!managing) setStarSort("manual"); setManaging((value) => !value); setSelected(new Set()); setEditingItem(null); setEditingGroup(null); }}><Settings2 size={17} aria-hidden="true" />{managing ? "完成管理" : "管理"}</button>
      {managing && <>
        <button type="button" onClick={() => setDialog({ type: "add-group" })}><Plus size={16} aria-hidden="true" />分组</button>
        <button type="button" onClick={() => setSelected(allVisibleSelected ? new Set() : new Set(allVisibleIds))}>{allVisibleSelected ? <CheckSquare size={16} /> : <Square size={16} />}{allVisibleSelected ? "取消全选" : "全选"}</button>
        <button type="button" disabled={!selected.size} onClick={() => setDialog({ type: "move" })}><FolderInput size={16} aria-hidden="true" />移动{selected.size ? ` ${selected.size}` : ""}</button>
      </>}
      <span className={message.includes("失败") || message.includes("不能") || message.includes("请") ? "toolbar-message error" : "toolbar-message"} role="status">{message}</span>
    </div>}

    {visibleGroups.length ? <div className={`home-layout collection-board ${managing ? "is-managing" : ""} ${canManage ? "can-drag" : ""}`}>
      <GroupSidebar groups={visibleGroups.map(({ id, name }) => ({ id, name }))} canDropItems={Boolean(draggedItem)} onItemDrop={(groupId) => void dropItem(groupId)} />
      <div className="group-content">{visibleGroups.map((group) => {
        const limitKey = `${group.id}:${deferredQuery.trim().toLowerCase()}`;
        const visibleLimit = kind === "github" ? visibleLimits[limitKey] ?? STAR_PAGE_SIZE : group.items.length;
        const renderedItems = group.items.slice(0, visibleLimit);
        const remainingItems = Math.max(0, group.items.length - renderedItems.length);
        return <section
        className={`section editable-section ${draggedGroup === group.id ? "dragging" : ""}`}
        id={`group-${group.id}`}
        key={group.id}
        onDragOver={(event) => { if (canManage) event.preventDefault(); }}
        onDrop={(event) => { event.preventDefault(); if (draggedGroup) void dropGroup(group.id); else void dropItem(group.id); }}
      >
        <div className="section-heading editable-heading">
          {managing && group.id !== "ungrouped" && <span className="group-drag-controls">
            <button type="button" className="drag-handle" draggable onDragStart={() => setDraggedGroup(group.id)} onDragEnd={() => setDraggedGroup(null)} aria-label={`拖动分组 ${group.name}`}><GripVertical size={17} /></button>
          </span>}
          {editingGroup === group.id ? <div className="inline-group-editor">
            <input autoFocus value={groupDraft} maxLength={40} aria-label="分组名称" onChange={(event) => setGroupDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void saveGroup(group); if (event.key === "Escape") setEditingGroup(null); }} />
            <button type="button" aria-label="保存分组名称" disabled={busy} onClick={() => void saveGroup(group)}><Check size={17} /></button>
            <button type="button" aria-label="取消修改" onClick={() => setEditingGroup(null)}><X size={17} /></button>
          </div> : <>
            {managing ? <button type="button" className="editable-title-button" onClick={() => beginGroupEdit(group)}>{group.name}</button> : <h2>{group.name}</h2>}
            {managing && group.id !== "ungrouped" && <button type="button" className="heading-action" aria-label={`修改分组 ${group.name}`} onClick={() => beginGroupEdit(group)}><Edit3 size={15} /></button>}
            {managing && group.id !== "ungrouped" && group.items.length === 0 && <button type="button" className="heading-action danger" aria-label={`删除空分组 ${group.name}`} disabled={busy} onClick={() => void removeEmptyGroup(group)}><Trash2 size={15} /></button>}
          </>}
          <span className="section-count">{group.items.length}</span>
        </div>

        {(group.items.length || (kind === "bookmark" && managing)) ? <div className={kind === "bookmark" ? "bookmark-grid" : "star-grid"}>{renderedItems.map((item, itemIndex) => <article
	          className={`collection-card ${kind === "bookmark" ? "bookmark-card" : "star-card"} ${selected.has(item.id) ? "selected" : ""} ${draggedItem?.ids.includes(item.id) ? "dragging" : ""}`}
	          key={item.id}
	          ref={(node) => { if (node) cardNodes.current.set(item.id, node); else cardNodes.current.delete(item.id); }}
          draggable={canManage && editingItem !== item.id && !query.trim()}
	          onDragStart={(event) => beginItemDrag(event, item, group.id)}
	          onDragEnd={() => setDraggedItem(null)}
	          onMouseEnter={kind === "bookmark" ? startTitleScroll : undefined}
	          onMouseLeave={kind === "bookmark" ? stopTitleScroll : undefined}
	          onDragOver={(event) => { if (canManage && draggedItem) event.preventDefault(); }}
          onDrop={(event) => { event.stopPropagation(); event.preventDefault(); void dropItem(group.id, item.id); }}
        >
          {managing && <label className="card-select" onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={selected.has(item.id)} onChange={() => toggleSelected(item.id)} /><span className="sr-only">选择 {item.title}</span></label>}

          {editingItem === item.id ? <div className="inline-item-editor">
            <input autoFocus value={itemDraft.title} maxLength={80} aria-label={kind === "bookmark" ? "书签名称" : "项目名称"} onChange={(event) => setItemDraft((draft) => ({ ...draft, title: event.target.value }))} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing && !event.repeat) { event.preventDefault(); void saveInlineItem(item); } }} />
            {kind === "bookmark" && <input value={itemDraft.href} type="url" aria-label="书签网址" onChange={(event) => setItemDraft((draft) => ({ ...draft, href: event.target.value }))} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing && !event.repeat) { event.preventDefault(); void saveInlineItem(item); } }} />}
            <span className="inline-editor-actions"><button type="button" aria-label="保存" disabled={busy} onClick={() => void saveInlineItem(item)}><Check size={17} /></button><button type="button" aria-label="取消" onClick={() => setEditingItem(null)}><X size={17} /></button></span>
          </div> : <>
            <a className="collection-card-link" href={item.href} target="_blank" rel="noreferrer" title={item.note || item.description || item.title} onClick={(event) => { if (managing) { event.preventDefault(); openDetails(item); } }}>
	              {kind === "bookmark" ? <BookmarkFavicon key={item.iconUrl ?? item.id} src={item.iconUrl ?? null} title={item.title} /> : <BookmarkFavicon key={item.iconUrl ?? item.id} className="star-avatar" src={item.iconUrl ?? null} title={item.title} fallback={<Github size={20} />} />}
              <span className={kind === "bookmark" ? "card-copy" : "star-card-copy"}>
	                <strong className={kind === "bookmark" ? "card-title" : "repo-name"}>{kind === "bookmark" ? <span className="card-title-text">{item.title}</span> : item.title}</strong>
                {kind === "github" && <>
                  <span className="star-card-description">{item.note || item.description || item.canonicalTitle || "暂无项目说明"}</span>
	                  <span className="star-inline-meta"><span><Clock3 size={12} aria-hidden="true" />{updatedLabel(item.updatedAt)}</span></span>
                </>}
              </span>
            </a>
            {managing && <div className="card-manage-actions">
              {kind === "bookmark" ? <>
                <button type="button" aria-label={`编辑 ${item.title}`} onClick={() => beginItemEdit(item)}><Edit3 size={15} /></button>
                <button type="button" aria-label={`${item.title} 更多设置`} onClick={() => openDetails(item)}><MoreHorizontal size={16} /></button>
              </> : <button type="button" aria-label={`下载 ${item.title} 的 Release`} title="下载 Release" onClick={() => openDownload(item)}><Download size={16} /></button>}
              <button type="button" aria-label={`前移 ${item.title}`} disabled={itemIndex === 0} onClick={() => void moveItemByOffset(group.id, item.id, -1)}><ArrowLeft size={14} /></button>
              <button type="button" aria-label={`后移 ${item.title}`} disabled={itemIndex === group.items.length - 1} onClick={() => void moveItemByOffset(group.id, item.id, 1)}><ArrowRight size={14} /></button>
            </div>}
          </>}
        </article>)}
          {kind === "github" && remainingItems > 0 && <AutoLoadMore remaining={remainingItems} onLoad={() => setVisibleLimits((current) => ({ ...current, [limitKey]: Math.min((current[limitKey] ?? STAR_PAGE_SIZE) + STAR_PAGE_SIZE, group.items.length) }))} />}
          {kind === "bookmark" && managing && group.id !== "ungrouped" && <button type="button" className="add-bookmark-card" onClick={() => openBookmarkDialog(group.id)}><ClipboardPaste size={20} aria-hidden="true" /><span>点击添加书签</span></button>}
        </div> : <div className="empty-state">{managing ? "空分组，可将内容拖到这里" : kind === "bookmark" ? "暂无书签" : "暂无项目"}</div>}
      </section>; })}</div>
    </div> : <div className="empty-state">{query ? "没有找到匹配的 GitHub Star。" : kind === "bookmark" ? "暂无书签" : "暂无 GitHub Star，登录后点击同步。"}</div>}

    <ManageDialog open={dialog?.type === "add-group"} title="新建分组" description={`添加到${kind === "bookmark" ? "书签" : "GitHub Star"}页面`} onClose={closeDialog}>
      <form className="dialog-form" onSubmit={submitCreate}><label>分组名称<input data-autofocus name="name" required maxLength={40} placeholder="例如：常用工具" /></label><div className="dialog-actions"><button type="button" className="soft-button" onClick={closeDialog}>取消</button><button type="submit" className="primary-button" disabled={busy}><Check size={17} />创建</button></div>{message && <p className="dialog-message" role="status">{message}</p>}</form>
    </ManageDialog>

    <ManageDialog open={dialog?.type === "add-bookmark"} title="添加书签" description={dialog?.type === "add-bookmark" ? `保存后会出现在「${groups.find((group) => group.id === dialog.groupId)?.name ?? "当前分组"}」末尾` : ""} onClose={closeDialog}>
      <form className="dialog-form" onSubmit={submitCreate}>
        <button type="button" className="clipboard-fill-button" disabled={bookmarkLookup} onClick={() => void fillBookmarkFromClipboard()}>{bookmarkLookup ? <LoaderCircle className="spin" size={17} aria-hidden="true" /> : <ClipboardPaste size={17} aria-hidden="true" />}{bookmarkLookup ? "正在读取网站信息" : "从剪贴板读取链接"}</button>
        <label>名称<input data-autofocus name="title" required maxLength={80} value={bookmarkDraft.title} onChange={(event) => setBookmarkDraft((current) => ({ ...current, title: event.target.value }))} /></label><label>网址<input name="url" type="url" required placeholder="https://" value={bookmarkDraft.url} onChange={(event) => setBookmarkDraft((current) => ({ ...current, url: event.target.value, faviconUrl: "" }))} /></label><label>描述<input name="description" maxLength={300} /></label><label>标签<input name="tags" placeholder="工具, 设计" /></label><label className="dialog-check"><input type="checkbox" name="isPublic" defaultChecked />公开显示</label>
        <div className="dialog-actions"><button type="button" className="soft-button" onClick={closeDialog}>取消</button><button type="submit" className="primary-button" disabled={busy}><Check size={17} />添加</button></div>{message && <p className="dialog-message" role="status">{message}</p>}
      </form>
    </ManageDialog>

    <ManageDialog open={dialog?.type === "move"} title={`移动 ${selected.size} 项`} description="选择新的分组，所选项目会一起移动" onClose={closeDialog}>
      <form className="dialog-form" onSubmit={submitMove}><label>目标分组<select data-autofocus name="groupId" required>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label><div className="dialog-actions"><button type="button" className="soft-button" onClick={closeDialog}>取消</button><button type="submit" className="primary-button" disabled={busy || !selected.size}><FolderInput size={17} />移动</button></div>{message && <p className="dialog-message" role="status">{message}</p>}</form>
    </ManageDialog>

    {detailsItem && <ManageDialog
      open
      title={kind === "bookmark" ? "书签设置" : "项目备注与设置"}
      description={kind === "github"
        ? <a className="dialog-heading-link" href={detailsItem.href} target="_blank" rel="noreferrer">{detailsItem.canonicalTitle || detailsItem.href}</a>
        : detailsItem.canonicalTitle || detailsItem.href}
      onClose={closeDialog}
    >
      <form className="dialog-form" onSubmit={(event) => void submitDetails(event, detailsItem)}>
        {kind === "bookmark" && <><label>名称<input data-autofocus name="title" required maxLength={80} defaultValue={detailsItem.title} /></label><label>网址<input name="url" type="url" required defaultValue={detailsItem.href} /></label><label>描述<input name="description" maxLength={300} defaultValue={detailsItem.description} /></label></>}
        {kind === "github" && <label>备注<textarea data-autofocus name="note" maxLength={500} defaultValue={detailsItem.note || detailsItem.description} rows={4} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); if (!detailsCreatingGroup && !busy) event.currentTarget.form?.requestSubmit(); } }} /></label>}
        <div className="dialog-group-field">
          {detailsCreatingGroup
            ? <div className="dialog-group-create"><label>新分组<input autoFocus aria-label="新分组名称" value={detailsGroupDraft} maxLength={40} placeholder="输入名称后按回车" onChange={(event) => setDetailsGroupDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); void createDetailsGroup(); } if (event.key === "Escape") { event.preventDefault(); setDetailsCreatingGroup(false); setDetailsGroupDraft(""); } }} /></label><button type="button" className="dialog-group-confirm" disabled={busy || !detailsGroupDraft.trim()} onClick={() => void createDetailsGroup()}><Check size={16} aria-hidden="true" />确认</button><button type="button" className="dialog-group-add" disabled={busy} onClick={() => { setDetailsCreatingGroup(false); setDetailsGroupDraft(""); setMessage(""); }}><X size={16} aria-hidden="true" />取消</button></div>
            : <><label>分组<select name="groupId" value={detailsGroupId || detailsItem.groupId || "ungrouped"} onChange={(event) => setDetailsGroupId(event.target.value)}>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>{kind === "github" && <button type="button" className="dialog-group-add" disabled={busy} onClick={() => { setDetailsCreatingGroup(true); setDetailsGroupDraft(""); setMessage(""); }}><Plus size={16} aria-hidden="true" />新建分组</button>}</>}
        </div>
        <label>标签<input name="tags" defaultValue={detailsItem.tags.join(", ")} /></label><label className="dialog-check"><input type="checkbox" name="isPublic" defaultChecked={detailsItem.isPublic} />公开显示</label>
        <div className="dialog-actions split"><button type="button" className="danger-button" disabled={busy} onClick={() => void removeItem(detailsItem)}><Trash2 size={16} />{kind === "bookmark" ? "删除" : "取消 Star"}</button><span /><button type="button" className="soft-button" onClick={closeDialog}>取消</button><button type="submit" className="primary-button" disabled={busy || detailsCreatingGroup}><Check size={17} />保存</button></div>{message && <p className="dialog-message" role="status">{message}</p>}
      </form>
    </ManageDialog>}

    {downloadItem && <ManageDialog
      open
      title={`下载 ${downloadItem.title}`}
      description={<a className="dialog-heading-link" href={downloadItem.href} target="_blank" rel="noreferrer">{downloadItem.canonicalTitle || downloadItem.href}</a>}
      onClose={closeDialog}
    >
      <div className="download-dialog">
        {downloadLoading && <div className="download-loading" role="status"><LoaderCircle className="spin" size={22} aria-hidden="true" /><span>正在读取 GitHub Releases…</span></div>}
        {!downloadLoading && downloadError && <div className="download-error" role="alert"><p>{downloadError}</p><button type="button" className="soft-button" onClick={() => void loadGithubDownloads(downloadItem)}>重试</button></div>}
        {!downloadLoading && downloadCatalog && <>
          {!downloadCatalog.hasReleases && <p className="download-notice">此仓库没有 Release，已提供默认分支 <strong>{downloadCatalog.defaultBranch}</strong> 的源代码。</p>}
          <label className="download-version-field">发布版本<select data-autofocus value={downloadVersion?.id ?? ""} onChange={(event) => { const next = downloadCatalog.versions.find((version) => version.id === event.target.value); setDownloadVersionId(event.target.value); setDownloadFileId(next?.files[0]?.id ?? ""); }}>{downloadCatalog.versions.map((version) => <option key={version.id} value={version.id}>{version.name} · {version.tagName}{version.prerelease ? "（预发布）" : ""}</option>)}</select></label>
          {downloadVersion && <fieldset className="download-files"><legend>选择下载文件</legend>{downloadVersion.files.map((file) => <label key={file.id} className={`download-file-option ${downloadFile?.id === file.id ? "selected" : ""}`}><input type="radio" name="downloadFile" value={file.id} checked={downloadFile?.id === file.id} onChange={() => setDownloadFileId(file.id)} /><span className="download-file-icon"><FileArchive size={18} aria-hidden="true" /></span><span className="download-file-copy"><strong>{file.name}</strong><small>{file.kind === "source" ? "源码包" : file.contentType || "Release 文件"} · {fileSizeLabel(file.size)}</small></span></label>)}</fieldset>}
          <div className="dialog-actions"><button type="button" className="soft-button" onClick={closeDialog}>取消</button>{downloadFile && <a className="primary-button" href={downloadFile.downloadUrl} target="_blank" rel="noreferrer"><Download size={17} aria-hidden="true" />开始下载</a>}</div>
        </>}
      </div>
    </ManageDialog>}
  </>;
}
