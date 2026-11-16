"use client";

import { useId, useState } from "react";
import { LoaderCircle, RotateCcw, Sparkles } from "lucide-react";
import type { BoardItem } from "@/lib/board-model";

// 项目备注：可以手写，也可以让 AI 结合简介和 README 分析出一条中文备注；结果只填进输入框，保存后才生效
export function StarNoteField({ item, canSubmit }: { item: BoardItem; canSubmit: boolean }) {
  const id = useId();
  const [value, setValue] = useState(item.note || item.description);
  // 第一次 AI 分析前的内容，用来「恢复原来的备注」
  const [previous, setPrevious] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const original = item.description.trim();

  async function analyze() {
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/manage/ai-note", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: item.id }) });
      const result = await response.json().catch(() => ({})) as { note?: unknown; error?: unknown };
      if (!response.ok || typeof result.note !== "string") throw new Error(typeof result.error === "string" ? result.error : "AI 分析失败，请稍后重试");
      const note = result.note;
      setPrevious((current) => current ?? value);
      setValue(note);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "AI 分析失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  return <div className="note-field">
    <div className="field-head">
      <label htmlFor={id}>备注</label>
      <button type="button" className="ai-note-button" disabled={loading} aria-busy={loading} onClick={() => void analyze()}>
        {loading ? <LoaderCircle className="spin" size={14} aria-hidden="true" /> : <Sparkles size={14} aria-hidden="true" />}
        {loading ? "分析中…" : "AI 分析"}
      </button>
    </div>
    <textarea
      id={id}
      data-autofocus
      name="note"
      maxLength={500}
      rows={3}
      value={value}
      readOnly={loading}
      aria-busy={loading}
      placeholder="写下这个项目是做什么的，或者点「AI 分析」"
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        // Enter 保存，Shift + Enter 换行
        if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
        event.preventDefault();
        if (canSubmit && !loading) event.currentTarget.form?.requestSubmit();
      }}
    />
    {original && value.trim() !== original && <p className="field-hint"><span>GitHub 简介</span>{original}</p>}
    {previous !== null && !loading && <button type="button" className="field-link" onClick={() => { setValue(previous); setPrevious(null); }}><RotateCcw size={13} aria-hidden="true" />恢复原来的备注</button>}
    {error && <p className="field-error" role="alert">{error}</p>}
  </div>;
}
