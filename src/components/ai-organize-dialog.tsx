"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Check, FolderPlus, Github, LoaderCircle, Plus, RotateCcw, Sparkles, Trash2, Undo2 } from "lucide-react";
import { BookmarkFavicon } from "@/components/bookmark-favicon";
import { ManageDialog } from "@/components/manage-dialog";
import type { ClassifySuggestion, Confidence } from "@/lib/ai-classify";
import { applyItemMoves, insertGroups, moveRequests, UNGROUPED_ID, type BoardGroup, type BoardItem, type BoardKind, type ItemMove } from "@/lib/board-model";
import { NEW_GROUP_PREFIX, groupNameKey, normalizeGroupName } from "@/lib/group-name";

type Scope = "selected" | "ungrouped" | "all";
type Mode = "existing" | "create";
type Phase = "scope" | "planning" | "plan" | "running" | "review" | "applying" | "done";
// from 是条目当前所在的分组；target 是目标分组 id，这次新建的分组用「new:分组名」；两者相同表示保持不动
type Row = { id: string; from: string; target: string; confidence: Confidence; reason: string; checked: boolean };
type PlanEntry = { key: string; name: string; description: string; count: number };
type NewGroup = { name: string; description: string };
type JsonResult = Record<string, unknown> & { error?: string; retryable?: boolean; code?: string };

export type AiApplyResult = { created: BoardGroup[]; moves: ItemMove[]; error?: string };

// splittable：超时或输出被截断，说明这一批太大，可以拆小重试
class BatchError extends Error {
  readonly splittable: boolean;

  constructor(message: string, splittable = false) {
    super(message);
    this.splittable = splittable;
  }
}

const BATCH_SIZE = 30;
const CONCURRENCY = 3;
// 拆到这么小还超时，就不再继续拆
const MIN_SPLIT = 4;
// 移动接口单次最多处理 500 项
const MAX_ITEMS = 500;
// 和服务端归类接口的上限一致
const MAX_NEW_GROUPS = 8;
const MODE_STORAGE_KEY = "start-page:ai-organize-mode";

const scopeHints: Record<Scope, string> = {
  selected: "只整理管理模式里勾选的条目",
  ungrouped: "给还没归类的 Star 找到合适的分组",
  all: "逐项检查，放错分组的也会给出建议"
};

const modeOptions: Array<{ value: Mode; label: string; hint: string }> = [
  { value: "existing", label: "只用现有分组", hint: "没有合适分组的保持不动" },
  { value: "create", label: "允许新建分组", hint: "AI 先提议新分组，你确认后再归类" }
];

const phaseDescriptions: Record<Phase, string> = {
  scope: "AI 参考你现有的分组，为每一项挑选合适的位置",
  planning: "先确认要新建哪些分组，再开始归类",
  plan: "先确认要新建哪些分组，再开始归类",
  running: "AI 参考你现有的分组，为每一项挑选合适的位置",
  review: "确认后才会移动，可以取消勾选或改成别的分组",
  applying: "确认后才会移动，可以取消勾选或改成别的分组",
  done: "已经保存，每一项放进了哪个分组都列在下面"
};

function chunk<T>(list: T[], size: number) {
  return Array.from({ length: Math.ceil(list.length / size) }, (_, index) => list.slice(index * size, index * size + size));
}

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { window.clearTimeout(timer); reject(new DOMException("已取消", "AbortError")); }, { once: true });
  });
}

async function sendJson(method: string, endpoint: string, body: unknown, signal?: AbortSignal) {
  const response = await fetch(endpoint, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  const result = await response.json().catch(() => ({})) as JsonResult;
  return { response, result };
}

// 限流、服务繁忙这类临时错误自动再试一次；超时或输出被截断时抛出可拆分的错误
async function requestWithRetry(endpoint: string, body: unknown, signal: AbortSignal) {
  for (let attempt = 1; ; attempt += 1) {
    let failure = "AI 整理失败";
    let retryable = true;
    try {
      const { response, result } = await sendJson("POST", endpoint, body, signal);
      if (response.ok) return result;
      // 504 也可能是平台层面的函数超时，同样按请求太大处理
      if (result.code === "timeout" || result.code === "truncated" || response.status === 504) throw new BatchError(result.error || "AI 响应超时", true);
      failure = result.error || failure;
      retryable = Boolean(result.retryable);
    } catch (cause) {
      if (signal.aborted || cause instanceof BatchError) throw cause;
      failure = "网络连接失败";
    }
    if (attempt >= 2 || !retryable) throw new BatchError(failure);
    await wait(1500, signal);
  }
}

function engineLabel(value: unknown) {
  const engine = value as { provider?: unknown; model?: unknown } | null;
  return engine?.provider && engine.model ? `${String(engine.provider)} · ${String(engine.model)}` : "";
}

function siteHost(href: string) {
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// 每一项标题下面的说明：Star 用备注（中文简介）或 GitHub 简介，书签用描述或网址，方便判断放得对不对
function itemSummary(kind: BoardKind, item: BoardItem) {
  return kind === "github" ? item.note || item.description : item.description || siteHost(item.href);
}

function readMode(kind: BoardKind): Mode {
  try {
    return window.localStorage.getItem(`${MODE_STORAGE_KEY}:${kind}`) === "create" ? "create" : "existing";
  } catch {
    return "existing";
  }
}

export function AiOrganizeDialog({ kind, groups, selectedIds, onClose, onApplied, onUndo }: {
  kind: BoardKind;
  groups: BoardGroup[];
  selectedIds: Set<string>;
  onClose: () => void;
  onApplied: (result: AiApplyResult) => void;
  onUndo: () => void;
}) {
  const entries = useMemo(() => new Map(groups.flatMap((group) => group.items.map((item) => [item.id, { item, groupId: group.id }] as const))), [groups]);
  const scopes = useMemo(() => {
    const options: Array<{ value: Scope; label: string; ids: string[] }> = [];
    const selected = [...entries.keys()].filter((id) => selectedIds.has(id));
    if (selected.length) options.push({ value: "selected", label: `已选的 ${selected.length} 项`, ids: selected });
    const ungrouped = groups.find((group) => group.id === UNGROUPED_ID)?.items.map((item) => item.id) ?? [];
    if (kind === "github" && ungrouped.length) options.push({ value: "ungrouped", label: `未分组的 ${ungrouped.length} 项`, ids: ungrouped });
    options.push({ value: "all", label: `全部 ${entries.size} 项`, ids: [...entries.keys()] });
    return options;
  }, [entries, groups, kind, selectedIds]);

  const [scope, setScope] = useState<Scope>(() => scopes[0].value);
  const [mode, setMode] = useState<Mode>(() => readMode(kind));
  const [phase, setPhase] = useState<Phase>("scope");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [runIds, setRunIds] = useState<string[]>([]);
  const [plan, setPlan] = useState<PlanEntry[]>([]);
  const [planDraft, setPlanDraft] = useState("");
  const [planError, setPlanError] = useState("");
  const [newGroups, setNewGroups] = useState<NewGroup[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [failedIds, setFailedIds] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [engine, setEngine] = useState("");
  const [result, setResult] = useState<AiApplyResult | null>(null);
  const [undoing, setUndoing] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const focusRef = useRef<HTMLDivElement>(null);
  const phaseRef = useRef<Phase>("scope");

  useEffect(() => {
    phaseRef.current = phase;
    // 切换到规划、审阅、结果时把焦点放到内容区，读屏软件会先读出摘要
    if (phase === "plan" || phase === "review" || phase === "done") focusRef.current?.focus();
  }, [phase]);
  useEffect(() => () => controllerRef.current?.abort(), []);

  // 对话框的 onClose 必须保持稳定，否则焦点会在每次进度刷新时被重置
  const handleClose = useCallback(() => {
    if (phaseRef.current === "applying") return;
    controllerRef.current?.abort();
    onClose();
  }, [onClose]);

  const activeScope = scopes.find((option) => option.value === scope) ?? scopes[0];
  const tooMany = activeScope.ids.length > MAX_ITEMS;
  const realGroups = groups.filter((group) => group.id !== UNGROUPED_ID);
  const noGroups = !realGroups.length;
  const busy = phase === "applying";
  const groupIds = new Set(groups.map((group) => group.id));
  const groupNames = new Map(groups.map((group) => [group.id, group.name]));

  function chooseMode(next: Mode) {
    setMode(next);
    try { window.localStorage.setItem(`${MODE_STORAGE_KEY}:${kind}`, next); } catch {}
  }

  function toRow(suggestion: ClassifySuggestion, allowedNew: Set<string>): Row[] {
    const entry = entries.get(suggestion.id);
    if (!entry) return [];
    // 目标分组不在当前页面数据里（比如刚被删除），也不是这次确认的新分组时，保持不动
    const target = groupIds.has(suggestion.groupId) || allowedNew.has(suggestion.groupId) ? suggestion.groupId : entry.groupId;
    const moving = target !== entry.groupId;
    // 未分组的条目把握不太小就默认勾选；已经分好组的只有把握大才默认勾选，免得打乱手动整理的结果
    const confident = entry.groupId === UNGROUPED_ID ? suggestion.confidence !== "low" : suggestion.confidence === "high";
    return [{ id: suggestion.id, from: entry.groupId, target, confidence: suggestion.confidence, reason: suggestion.reason, checked: moving && confident }];
  }

  async function analyze(ids: string[], retrying: boolean, groupsForRun: NewGroup[]) {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const allowedNew = new Set(groupsForRun.map((group) => `${NEW_GROUP_PREFIX}${group.name}`));
    const collected: ClassifySuggestion[] = [];
    const queue = chunk(ids, BATCH_SIZE);
    let done = 0;
    let lastError = "";
    let lastEngine = "";
    setError("");
    setProgress({ done: 0, total: ids.length });
    setPhase("running");

    // 小批次并发，单批失败不影响其他批次
    const worker = async () => {
      while (queue.length && !controller.signal.aborted) {
        const batch = queue.shift();
        if (!batch) return;
        try {
          const response = await requestWithRetry("/api/manage/ai-classify", { kind, ids: batch, newGroups: groupsForRun }, controller.signal);
          collected.push(...(Array.isArray(response.suggestions) ? response.suggestions as ClassifySuggestion[] : []));
          const label = engineLabel(response.engine);
          if (label) lastEngine = label;
        } catch (cause) {
          if (controller.signal.aborted) return;
          // 慢一些的模型处理不完一整批时，拆成两半放回队列，进度保持不变
          if (cause instanceof BatchError && cause.splittable && batch.length > MIN_SPLIT) {
            const middle = Math.ceil(batch.length / 2);
            queue.push(batch.slice(0, middle), batch.slice(middle));
            continue;
          }
          lastError = cause instanceof Error ? cause.message : "AI 整理失败";
        }
        done += batch.length;
        setProgress({ done, total: ids.length });
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
    if (controller.signal.aborted) return;
    controllerRef.current = null;
    if (lastEngine) setEngine(lastEngine);

    const answered = new Set(collected.map((suggestion) => suggestion.id));
    const nextRows = collected.flatMap((suggestion) => toRow(suggestion, allowedNew));
    setRows((current) => retrying ? [...current.filter((row) => !answered.has(row.id)), ...nextRows] : nextRows);
    setFailedIds(ids.filter((id) => !answered.has(id) && entries.has(id)));
    setError(lastError);
    // 第一次分析一项都没拿到时退回上一步；允许新建分组时退回确认新分组，不用重新规划
    setPhase(!retrying && !nextRows.length ? (mode === "create" ? "plan" : "scope") : "review");
  }

  async function requestPlan(ids: string[]) {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setError("");
    setPlanError("");
    setPhase("planning");
    try {
      const response = await requestWithRetry("/api/manage/ai-plan", { kind, ids }, controller.signal);
      const proposed = Array.isArray(response.groups) ? response.groups as Array<Record<string, unknown>> : [];
      setPlan(proposed.map((group, index) => ({ key: `ai-${index}`, name: String(group.name ?? ""), description: String(group.description ?? ""), count: Number(group.count) || 0 })));
      const label = engineLabel(response.engine);
      if (label) setEngine(label);
      setPhase("plan");
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : "规划新分组失败");
      setPhase("scope");
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }

  function start() {
    const ids = activeScope.ids;
    setRunIds(ids);
    setRows([]);
    setFailedIds([]);
    setResult(null);
    if (mode === "create") {
      setPlan([]);
      void requestPlan(ids);
    } else {
      setNewGroups([]);
      void analyze(ids, false, []);
    }
  }

  function cancelRun() {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setPhase(phase === "planning" ? "scope" : rows.length ? "review" : mode === "create" ? "plan" : "scope");
  }

  function updatePlanName(key: string, name: string) {
    setPlan((current) => current.map((entry) => entry.key === key ? { ...entry, name } : entry));
    setPlanError("");
  }

  function removePlanEntry(key: string) {
    setPlan((current) => current.filter((entry) => entry.key !== key));
    setPlanError("");
  }

  function addPlanEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = normalizeGroupName(planDraft);
    if (!name || plan.length >= MAX_NEW_GROUPS) return;
    setPlan((current) => [...current, { key: `user-${Date.now()}`, name, description: "", count: 0 }]);
    setPlanDraft("");
    setPlanError("");
  }

  // 确认新分组：名称规范化后不能和现有分组或彼此重名，再带着它们开始归类
  function confirmPlan() {
    const taken = new Set([...realGroups.map((group) => group.name), "未分组"].map(groupNameKey));
    const confirmed: NewGroup[] = [];
    for (const entry of plan) {
      const name = normalizeGroupName(entry.name);
      if (!name) continue;
      const key = groupNameKey(name);
      if (taken.has(key)) { setPlanError(`「${name}」和现有分组或其他新分组重名，请换个名字`); return; }
      taken.add(key);
      confirmed.push({ name, description: entry.description });
    }
    if (!confirmed.length && noGroups) { setPlanError("还没有任何分组，至少保留一个新分组"); return; }
    setNewGroups(confirmed);
    void analyze(runIds, false, confirmed);
  }

  function toggleRow(id: string) {
    setRows((current) => current.map((row) => row.id === id ? { ...row, checked: !row.checked } : row));
  }

  function setSection(target: string, checked: boolean) {
    setRows((current) => current.map((row) => row.target === target && row.target !== row.from ? { ...row, checked } : row));
  }

  function retarget(id: string, target: string) {
    setRows((current) => current.map((row) => row.id === id ? { ...row, target, checked: target !== row.from } : row));
  }

  async function apply() {
    const selection = rows.filter((row) => row.checked && row.target !== row.from);
    if (!selection.length) return;
    setPhase("applying");
    setError("");
    const created: BoardGroup[] = [];
    const createdIds = new Map<string, string>();
    const moves: ItemMove[] = [];
    let failure = "";
    try {
      // 只创建实际有条目放进去的新分组
      for (const target of new Set(selection.map((row) => row.target).filter((value) => value.startsWith(NEW_GROUP_PREFIX)))) {
        const name = target.slice(NEW_GROUP_PREFIX.length);
        const { response, result: body } = await sendJson("POST", "/api/manage/collection", { entity: "group", kind, name });
        const group = body.group as { id?: unknown; name?: unknown; isPublic?: unknown } | undefined;
        if (!response.ok || !group?.id) throw new Error(body.error || `创建分组「${name}」失败`);
        created.push({ id: String(group.id), name: String(group.name ?? name), isPublic: group.isPublic !== false, items: [] });
        createdIds.set(target, String(group.id));
      }
      const planned = selection.flatMap((row) => {
        const to = row.target.startsWith(NEW_GROUP_PREFIX) ? createdIds.get(row.target) : row.target;
        return to ? [{ itemId: row.id, from: row.from, to }] : [];
      });
      const next = applyItemMoves(insertGroups(groups, created), planned);
      // 逐个目标分组保存；中途失败时，已完成的部分照常记录，可以整体撤销
      for (const request of moveRequests(kind, next, planned)) {
        const { response, result: body } = await sendJson("POST", "/api/manage/reorder", request.body);
        if (!response.ok) throw new Error(body.error || "移动失败");
        moves.push(...planned.filter((move) => move.to === request.target));
      }
    } catch (cause) {
      failure = cause instanceof Error ? cause.message : "应用失败";
    }
    const outcome: AiApplyResult = { created, moves, error: failure || undefined };
    setResult(outcome);
    setPhase("done");
    onApplied(outcome);
  }

  function undo() {
    setUndoing(true);
    onUndo();
  }

  const moving = rows.filter((row) => row.target !== row.from);
  const keeping = rows.filter((row) => row.target === row.from);
  const sections = [
    ...groups.map((group) => ({ target: group.id, name: group.name, isNew: false })),
    ...newGroups.map((group) => ({ target: `${NEW_GROUP_PREFIX}${group.name}`, name: group.name, isNew: true }))
  ].map((section) => ({ ...section, rows: moving.filter((row) => row.target === section.target) })).filter((section) => section.rows.length);
  const chosen = moving.filter((row) => row.checked);
  const toNewGroups = moving.filter((row) => row.target.startsWith(NEW_GROUP_PREFIX)).length;
  const hasUnchecked = moving.some((row) => !row.checked);
  const options = [
    ...groups.map((group) => ({ value: group.id, label: group.name })),
    ...newGroups.map((group) => ({ value: `${NEW_GROUP_PREFIX}${group.name}`, label: `新建：${group.name}` }))
  ];

  // 结果页：按分组列出这次放进去的条目，没移动的放在最后
  const movedIds = new Set(result?.moves.map((move) => move.itemId) ?? []);
  const createdGroupIds = new Set(result?.created.map((group) => group.id) ?? []);
  const resultSections = result ? groups.map((group) => ({
    id: group.id,
    name: group.name,
    created: createdGroupIds.has(group.id),
    items: result.moves.filter((move) => move.to === group.id).flatMap((move) => entries.get(move.itemId)?.item ?? [])
  })).filter((section) => section.items.length) : [];
  const keptItems = rows.filter((row) => !movedIds.has(row.id)).flatMap((row) => entries.get(row.id)?.item ?? []);
  const resultSummary = !result ? "" : result.moves.length
    ? `已把 ${result.moves.length} 项放进 ${resultSections.length} 个分组${result.created.length ? `，其中 ${result.created.length} 个是新建的` : ""}。${result.error ? `其余没有保存：${result.error}` : ""}`
    : `没有保存成功：${result.error ?? "请稍后重试"}`;

  function renderIcon(item: BoardItem) {
    return <BookmarkFavicon className={`ai-row-icon ${kind === "github" ? "is-avatar" : ""}`} src={item.iconUrl ?? null} title={item.title} fallback={kind === "github" ? <Github size={15} /> : undefined} />;
  }

  function renderCopy(item: BoardItem, extra?: ReactNode) {
    const summary = itemSummary(kind, item);
    return <span className="ai-row-copy">
      <strong title={item.canonicalTitle ?? item.title}>{item.title}</strong>
      {summary && <span className="ai-row-summary" title={summary}>{summary}</span>}
      {extra}
    </span>;
  }

  function renderRow(row: Row) {
    const item = entries.get(row.id)?.item;
    if (!item) return null;
    const isMoving = row.target !== row.from;
    const origin = isMoving && row.from !== UNGROUPED_ID ? groupNames.get(row.from) : "";
    return <li key={row.id} className={`ai-row ${isMoving && !row.checked ? "is-off" : ""}`}>
      {isMoving
        ? <input type="checkbox" className="ai-row-check" checked={row.checked} disabled={busy} onChange={() => toggleRow(row.id)} aria-label={`移动 ${item.title}`} />
        : <span className="ai-row-check" aria-hidden="true" />}
      {renderIcon(item)}
      {renderCopy(item, <small>
        <span className="ai-row-reason">{row.reason || "没有说明"}</span>
        {origin && <span className="ai-row-origin">原来在「{origin}」</span>}
        {isMoving && row.confidence !== "high" && <span className={`ai-confidence ${row.confidence}`}>{row.confidence === "medium" ? "可能" : "不确定"}</span>}
      </small>)}
      <select className="ai-row-target" value={row.target} disabled={busy} aria-label={`${item.title} 的目标分组`} onChange={(event) => retarget(row.id, event.target.value)}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}{option.value === row.from ? "（当前）" : ""}</option>)}
      </select>
    </li>;
  }

  function renderResultItem(item: BoardItem) {
    return <li key={item.id} className="ai-row is-result">{renderIcon(item)}{renderCopy(item)}</li>;
  }

  return <ManageDialog open title={phase === "done" ? "整理结果" : "AI 整理"} description={phaseDescriptions[phase]} onClose={handleClose} className="ai-dialog">
    {phase === "scope" && <div className="ai-organize">
      <fieldset className="ai-scopes">
        <legend>整理范围</legend>
        {scopes.map((option) => <label key={option.value} className={`ai-scope-option ${scope === option.value ? "selected" : ""}`}>
          <input type="radio" name="ai-scope" value={option.value} checked={scope === option.value} onChange={() => setScope(option.value)} />
          <span className="ai-scope-copy"><strong>{option.label}</strong><small>{scopeHints[option.value]}</small></span>
        </label>)}
      </fieldset>
      <fieldset className="ai-scopes">
        <legend>分组方式</legend>
        <div className="ai-mode-grid">
          {modeOptions.map((option) => <label key={option.value} className={`ai-scope-option ${mode === option.value ? "selected" : ""}`}>
            <input type="radio" name="ai-mode" value={option.value} checked={mode === option.value} onChange={() => chooseMode(option.value)} />
            <span className="ai-scope-copy"><strong>{option.label}</strong><small>{option.hint}</small></span>
          </label>)}
        </div>
      </fieldset>
      <p className="ai-privacy">会把这些条目的名称、链接、描述和备注发给 AI 分析；结果需要你确认后才会保存。</p>
      {mode === "existing" && noGroups && <p className="dialog-message" role="alert">还没有分组。可以先新建分组，或者选择「允许新建分组」。</p>}
      {tooMany && <p className="dialog-message" role="alert">一次最多整理 {MAX_ITEMS} 项，请先选择部分条目。</p>}
      {error && <p className="dialog-message" role="alert">{error}</p>}
      <div className="dialog-actions">
        <button type="button" className="soft-button" onClick={handleClose}>取消</button>
        <button type="button" className="primary-button" data-autofocus disabled={tooMany || !activeScope.ids.length || (mode === "existing" && noGroups)} onClick={start}><Sparkles size={17} aria-hidden="true" />{mode === "create" ? "下一步" : "开始分析"}</button>
      </div>
    </div>}

    {(phase === "planning" || phase === "running") && <div className="ai-running">
      <LoaderCircle className="spin" size={24} aria-hidden="true" />
      {phase === "planning"
        ? <p role="status" aria-live="polite">AI 正在看这 <strong>{runIds.length}</strong> 项，规划需要新建的分组</p>
        : <p role="status" aria-live="polite">正在分析 <strong>{progress.done}</strong> / {progress.total} 项</p>}
      {phase === "running" && <div className="ai-progress" aria-hidden="true"><span style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }} /></div>}
      <button type="button" className="soft-button" autoFocus onClick={cancelRun}>取消</button>
    </div>}

    {phase === "plan" && <div className="ai-plan" ref={focusRef} tabIndex={-1}>
      <p className="ai-summary">{plan.length ? `AI 建议新建 ${plan.length} 个分组。可以改名、删掉不要的，也可以自己加；确认后再开始归类。` : "AI 认为现有分组已经够用。也可以自己加一个新分组，再开始归类。"}</p>
      {engine && <p className="ai-engine">由 {engine} 规划</p>}
      {plan.length > 0 && <ul className="ai-plan-list">{plan.map((entry) => <li key={entry.key} className="ai-plan-item">
        <span className="ai-plan-icon" aria-hidden="true"><FolderPlus size={16} /></span>
        <span className="ai-plan-copy">
          <input value={entry.name} maxLength={20} aria-label="新分组名称" onChange={(event) => updatePlanName(entry.key, event.target.value)} />
          {(entry.description || entry.count > 0) && <small>{[entry.description, entry.count > 0 ? `约 ${entry.count} 项` : ""].filter(Boolean).join(" · ")}</small>}
        </span>
        <button type="button" className="ai-plan-remove" aria-label={`不新建「${entry.name}」`} title="不新建这个分组" onClick={() => removePlanEntry(entry.key)}><Trash2 size={15} aria-hidden="true" /></button>
      </li>)}</ul>}
      <form className="ai-plan-add" onSubmit={addPlanEntry}>
        <input value={planDraft} maxLength={20} placeholder="自己加一个新分组" aria-label="要新建的分组名称" onChange={(event) => setPlanDraft(event.target.value)} />
        <button type="submit" className="dialog-group-add" disabled={!planDraft.trim() || plan.length >= MAX_NEW_GROUPS}><Plus size={15} aria-hidden="true" />添加</button>
      </form>
      {(planError || error) && <p className="dialog-message" role="alert">{planError || error}</p>}
      <div className="dialog-actions">
        <button type="button" className="soft-button" onClick={() => { setPhase("scope"); setError(""); }}>上一步</button>
        <button type="button" className="primary-button" onClick={confirmPlan}><Sparkles size={17} aria-hidden="true" />开始归类</button>
      </div>
    </div>}

    {(phase === "review" || phase === "applying") && <div className="ai-review" ref={focusRef} tabIndex={-1}>
      <p className="ai-summary">
        {moving.length ? `AI 建议移动 ${moving.length} 项${toNewGroups ? `，其中 ${toNewGroups} 项放进新分组` : ""}。` : "没有需要移动的条目。"}
        {hasUnchecked && "把握不大的建议默认不勾选。"}
      </p>
      {engine && <p className="ai-engine">由 {engine} 分析</p>}
      {failedIds.length > 0 && <div className="ai-failed" role="alert">
        <p>{failedIds.length} 项没有拿到建议{error ? `：${error}` : ""}</p>
        <button type="button" className="soft-button" disabled={busy} onClick={() => void analyze(failedIds, true, newGroups)}><RotateCcw size={15} aria-hidden="true" />重新分析</button>
      </div>}
      {sections.map((section) => {
        const checkedCount = section.rows.filter((row) => row.checked).length;
        const allChecked = checkedCount === section.rows.length;
        return <section className="ai-section" key={section.target} aria-label={`移到 ${section.name}`}>
          <header className="ai-section-heading">
            <h3><span>移到</span>{section.name}</h3>
            {section.isNew && <span className="ai-badge">新建</span>}
            <span className="ai-section-count">{checkedCount}/{section.rows.length}</span>
            <button type="button" className="ai-section-toggle" disabled={busy} onClick={() => setSection(section.target, !allChecked)}>{allChecked ? "全不选" : "全选"}</button>
          </header>
          <ul className="ai-rows">{section.rows.map(renderRow)}</ul>
        </section>;
      })}
      {keeping.length > 0 && <details className="ai-keep" open={!moving.length}>
        <summary>保持不动 <span>{keeping.length}</span></summary>
        <ul className="ai-rows">{keeping.map(renderRow)}</ul>
      </details>}
      <div className="dialog-actions ai-actions">
        <button type="button" className="soft-button" disabled={busy} onClick={handleClose}>取消</button>
        <button type="button" className="primary-button" disabled={busy || !chosen.length} onClick={() => void apply()}>
          {busy ? <LoaderCircle className="spin" size={17} aria-hidden="true" /> : <Check size={17} aria-hidden="true" />}
          {busy ? "正在应用…" : `应用 ${chosen.length} 项`}
        </button>
      </div>
    </div>}

    {phase === "done" && result && <div className="ai-review ai-result" ref={focusRef} tabIndex={-1}>
      <p className="ai-summary">{resultSummary}</p>
      {resultSections.map((section) => <section className="ai-section" key={section.id} aria-label={`放进 ${section.name}`}>
        <header className="ai-section-heading">
          <h3><span>放进</span>{section.name}</h3>
          {section.created && <span className="ai-badge">新建</span>}
          <span className="ai-section-count">{section.items.length} 项</span>
        </header>
        <ul className="ai-rows">{section.items.map(renderResultItem)}</ul>
      </section>)}
      {keptItems.length > 0 && <details className="ai-keep" open={!result.moves.length}>
        <summary>没有移动 <span>{keptItems.length}</span></summary>
        <ul className="ai-rows">{keptItems.map(renderResultItem)}</ul>
      </details>}
      <div className="dialog-actions ai-actions">
        <button type="button" className="soft-button" disabled={undoing || (!result.moves.length && !result.created.length)} onClick={undo}>
          {undoing ? <LoaderCircle className="spin" size={16} aria-hidden="true" /> : <Undo2 size={16} aria-hidden="true" />}
          {undoing ? "正在撤销…" : "撤销"}
        </button>
        <button type="button" className="primary-button" disabled={undoing} onClick={handleClose}><Check size={17} aria-hidden="true" />完成</button>
      </div>
    </div>}
  </ManageDialog>;
}
