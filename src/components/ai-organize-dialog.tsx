"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Github, LoaderCircle, RotateCcw, Sparkles } from "lucide-react";
import { BookmarkFavicon } from "@/components/bookmark-favicon";
import { ManageDialog } from "@/components/manage-dialog";
import type { ClassifySuggestion, Confidence } from "@/lib/ai-classify";
import { applyItemMoves, moveRequests, UNGROUPED_ID, type BoardGroup, type BoardKind, type ItemMove } from "@/lib/board-model";

type Scope = "selected" | "ungrouped" | "all";
type Phase = "scope" | "running" | "review" | "applying";
// from、target 都是现有分组的 id，两者相同表示保持不动
type Row = { id: string; from: string; target: string; confidence: Confidence; reason: string; checked: boolean };
type JsonResult = Record<string, unknown> & { error?: string; retryable?: boolean; code?: string };

export type AiApplyResult = { moves: ItemMove[]; error?: string };

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

const scopeHints: Record<Scope, string> = {
  selected: "只整理管理模式里勾选的条目",
  ungrouped: "给还没归类的 Star 找到合适的分组",
  all: "逐项检查，放错分组的也会给出建议"
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

function engineLabel(value: unknown) {
  const engine = value as { provider?: unknown; model?: unknown } | null;
  return engine?.provider && engine.model ? `${String(engine.provider)} · ${String(engine.model)}` : "";
}

export function AiOrganizeDialog({ kind, groups, selectedIds, onClose, onApplied }: {
  kind: BoardKind;
  groups: BoardGroup[];
  selectedIds: Set<string>;
  onClose: () => void;
  onApplied: (result: AiApplyResult) => void;
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
  const [phase, setPhase] = useState<Phase>("scope");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [rows, setRows] = useState<Row[]>([]);
  const [failedIds, setFailedIds] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [engine, setEngine] = useState("");
  const controllerRef = useRef<AbortController | null>(null);
  const reviewRef = useRef<HTMLDivElement>(null);
  const phaseRef = useRef<Phase>("scope");

  useEffect(() => {
    phaseRef.current = phase;
    // 进入审阅时把焦点放到结果区，读屏软件会先读出摘要
    if (phase === "review") reviewRef.current?.focus();
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
  // AI 只会把条目放进现有分组，「未分组」不算
  const noGroups = !groups.some((group) => group.id !== UNGROUPED_ID);
  const busy = phase === "applying";
  const groupIds = new Set(groups.map((group) => group.id));

  function toRow(suggestion: ClassifySuggestion): Row[] {
    const entry = entries.get(suggestion.id);
    if (!entry) return [];
    // 目标分组不在当前页面数据里（比如刚被删除）时保持不动
    const target = groupIds.has(suggestion.groupId) ? suggestion.groupId : entry.groupId;
    const moving = target !== entry.groupId;
    return [{ id: suggestion.id, from: entry.groupId, target, confidence: suggestion.confidence, reason: suggestion.reason, checked: moving && suggestion.confidence !== "low" }];
  }

  async function requestBatch(ids: string[], signal: AbortSignal) {
    for (let attempt = 1; ; attempt += 1) {
      let failure = "AI 整理失败";
      let retryable = true;
      try {
        const { response, result } = await sendJson("POST", "/api/manage/ai-classify", { kind, ids }, signal);
        if (response.ok) {
          return { suggestions: Array.isArray(result.suggestions) ? result.suggestions as ClassifySuggestion[] : [], engine: engineLabel(result.engine) };
        }
        // 504 也可能是平台层面的函数超时，同样按批次太大处理
        if (result.code === "timeout" || result.code === "truncated" || response.status === 504) throw new BatchError(result.error || "AI 响应超时", true);
        failure = result.error || failure;
        retryable = Boolean(result.retryable);
      } catch (cause) {
        if (signal.aborted || cause instanceof BatchError) throw cause;
        failure = "网络连接失败";
      }
      // 限流、服务繁忙这类临时错误自动再试一次
      if (attempt >= 2 || !retryable) throw new BatchError(failure);
      await wait(1500, signal);
    }
  }

  async function analyze(ids: string[], retrying: boolean) {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
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
          const result = await requestBatch(batch, controller.signal);
          collected.push(...result.suggestions);
          if (result.engine) lastEngine = result.engine;
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
    const nextRows = collected.flatMap(toRow);
    setRows((current) => retrying ? [...current.filter((row) => !answered.has(row.id)), ...nextRows] : nextRows);
    setFailedIds(ids.filter((id) => !answered.has(id) && entries.has(id)));
    setError(lastError);
    setPhase(!retrying && !nextRows.length ? "scope" : "review");
  }

  function cancelRun() {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setPhase(rows.length ? "review" : "scope");
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
    const planned: ItemMove[] = selection.map((row) => ({ itemId: row.id, from: row.from, to: row.target }));
    const next = applyItemMoves(groups, planned);
    const moves: ItemMove[] = [];
    let failure = "";
    try {
      // 逐个目标分组保存；中途失败时，已完成的部分照常记录，可以整体撤销
      for (const request of moveRequests(kind, next, planned)) {
        const { response, result } = await sendJson("POST", "/api/manage/reorder", request.body);
        if (!response.ok) throw new Error(result.error || "移动失败");
        moves.push(...planned.filter((move) => move.to === request.target));
      }
    } catch (cause) {
      failure = cause instanceof Error ? cause.message : "应用失败";
    }
    onApplied({ moves, error: failure || undefined });
  }

  const moving = rows.filter((row) => row.target !== row.from);
  const keeping = rows.filter((row) => row.target === row.from);
  const sections = groups
    .map((group) => ({ target: group.id, name: group.name, rows: moving.filter((row) => row.target === group.id) }))
    .filter((section) => section.rows.length);
  const chosen = moving.filter((row) => row.checked);
  const hasUnsure = moving.some((row) => row.confidence === "low");

  function renderRow(row: Row) {
    const item = entries.get(row.id)?.item;
    if (!item) return null;
    const isMoving = row.target !== row.from;
    return <li key={row.id} className={`ai-row ${isMoving && !row.checked ? "is-off" : ""}`}>
      {isMoving
        ? <input type="checkbox" className="ai-row-check" checked={row.checked} disabled={busy} onChange={() => toggleRow(row.id)} aria-label={`移动 ${item.title}`} />
        : <span className="ai-row-check" aria-hidden="true" />}
      <BookmarkFavicon className={`ai-row-icon ${kind === "github" ? "is-avatar" : ""}`} src={item.iconUrl ?? null} title={item.title} fallback={kind === "github" ? <Github size={15} /> : undefined} />
      <span className="ai-row-copy">
        <strong title={item.canonicalTitle ?? item.title}>{item.title}</strong>
        <small>
          {row.reason || "没有说明"}
          {isMoving && row.confidence !== "high" && <span className={`ai-confidence ${row.confidence}`}>{row.confidence === "medium" ? "可能" : "不确定"}</span>}
        </small>
      </span>
      <select className="ai-row-target" value={row.target} disabled={busy} aria-label={`${item.title} 的目标分组`} onChange={(event) => retarget(row.id, event.target.value)}>
        {groups.map((group) => <option key={group.id} value={group.id}>{group.name}{group.id === row.from ? "（当前）" : ""}</option>)}
      </select>
    </li>;
  }

  return <ManageDialog
    open
    title="AI 整理"
    description={phase === "review" || phase === "applying" ? "确认后才会移动，可以取消勾选或改成别的分组" : "AI 只在你现有的分组里挑选合适的位置，不会新建分组"}
    onClose={handleClose}
    className="ai-dialog"
  >
    {phase === "scope" && <div className="ai-organize">
      <fieldset className="ai-scopes">
        <legend>整理范围</legend>
        {scopes.map((option) => <label key={option.value} className={`ai-scope-option ${scope === option.value ? "selected" : ""}`}>
          <input type="radio" name="ai-scope" value={option.value} checked={scope === option.value} onChange={() => setScope(option.value)} />
          <span className="ai-scope-copy"><strong>{option.label}</strong><small>{scopeHints[option.value]}</small></span>
        </label>)}
      </fieldset>
      <p className="ai-privacy">会把这些条目的名称、链接、描述和标签发给 AI 分析；结果需要你确认后才会保存。</p>
      {noGroups && <p className="dialog-message" role="alert">还没有分组。AI 只会把条目放进现有分组，请先新建分组。</p>}
      {tooMany && <p className="dialog-message" role="alert">一次最多整理 {MAX_ITEMS} 项，请先选择部分条目。</p>}
      {error && <p className="dialog-message" role="alert">{error}</p>}
      <div className="dialog-actions">
        <button type="button" className="soft-button" onClick={handleClose}>取消</button>
        <button type="button" className="primary-button" data-autofocus disabled={noGroups || tooMany || !activeScope.ids.length} onClick={() => void analyze(activeScope.ids, false)}><Sparkles size={17} aria-hidden="true" />开始分析</button>
      </div>
    </div>}

    {phase === "running" && <div className="ai-running">
      <LoaderCircle className="spin" size={24} aria-hidden="true" />
      <p role="status" aria-live="polite">正在分析 <strong>{progress.done}</strong> / {progress.total} 项</p>
      <div className="ai-progress" aria-hidden="true"><span style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }} /></div>
      <button type="button" className="soft-button" autoFocus onClick={cancelRun}>取消</button>
    </div>}

    {(phase === "review" || phase === "applying") && <div className="ai-review" ref={reviewRef} tabIndex={-1}>
      <p className="ai-summary">
        {moving.length ? `AI 建议移动 ${moving.length} 项。` : "没有需要移动的条目。"}
        {hasUnsure && "把握不大的建议默认不勾选。"}
      </p>
      {engine && <p className="ai-engine">由 {engine} 分析</p>}
      {failedIds.length > 0 && <div className="ai-failed" role="alert">
        <p>{failedIds.length} 项没有拿到建议{error ? `：${error}` : ""}</p>
        <button type="button" className="soft-button" disabled={busy} onClick={() => void analyze(failedIds, true)}><RotateCcw size={15} aria-hidden="true" />重新分析</button>
      </div>}
      {sections.map((section) => {
        const checkedCount = section.rows.filter((row) => row.checked).length;
        const allChecked = checkedCount === section.rows.length;
        return <section className="ai-section" key={section.target} aria-label={`移到 ${section.name}`}>
          <header className="ai-section-heading">
            <h3><span>移到</span>{section.name}</h3>
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
  </ManageDialog>;
}
