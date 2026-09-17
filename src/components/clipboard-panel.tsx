"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Check, ClipboardCopy, Cloud, CloudDownload, LockKeyhole, Save } from "lucide-react";

const STORAGE_KEY = "start-web:clipboard-token";

type ClipboardPayload = {
  content: string;
  updatedAt: string;
  revision: string;
};

function timeLabel(value: string) {
  if (!value) return "尚未保存";
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value));
}

export function ClipboardPanel() {
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [revision, setRevision] = useState("");
  const [updatedAt, setUpdatedAt] = useState("");
  const [remoteUpdate, setRemoteUpdate] = useState<ClipboardPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const contentRef = useRef(content);
  const savedContentRef = useRef(savedContent);
  const revisionRef = useRef(revision);

  useEffect(() => { contentRef.current = content; }, [content]);
  useEffect(() => { savedContentRef.current = savedContent; }, [savedContent]);
  useEffect(() => { revisionRef.current = revision; }, [revision]);

  const applyRemote = useCallback((payload: ClipboardPayload) => {
    setContent(payload.content);
    setSavedContent(payload.content);
    setRevision(payload.revision);
    setUpdatedAt(payload.updatedAt);
    setRemoteUpdate(null);
  }, []);

  const readRemote = useCallback(async (activeToken: string, initial = false) => {
    const response = await fetch("/api/clipboard", {
      headers: { Authorization: `Bearer ${activeToken}` },
      cache: "no-store"
    });
    const payload = await response.json().catch(() => ({})) as ClipboardPayload & { error?: string };
    if (response.status === 401) {
      localStorage.removeItem(STORAGE_KEY);
      setToken(null);
      setMessage(payload.error ?? "请重新输入密码");
      return;
    }
    if (!response.ok) throw new Error(payload.error ?? "读取失败");

    if (initial || payload.revision !== revisionRef.current) {
      const dirty = contentRef.current !== savedContentRef.current;
      if (!initial && dirty) setRemoteUpdate(payload);
      else applyRemote(payload);
    }
  }, [applyRemote]);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) { queueMicrotask(() => setReady(true)); return; }
    queueMicrotask(() => {
      setToken(stored);
      void readRemote(stored, true).catch((error) => setMessage(error instanceof Error ? error.message : "读取失败")).finally(() => setReady(true));
    });
  }, [readRemote]);

  useEffect(() => {
    if (!token || !ready) return;
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible" && !busy) {
        readRemote(token).catch(() => undefined);
      }
    }, 1400);
    return () => window.clearInterval(poll);
  }, [busy, readRemote, ready, token]);

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setMessage("正在打开…");
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/clipboard/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: String(data.get("password") ?? "") })
      });
      const payload = await response.json().catch(() => ({})) as ClipboardPayload & { token?: string; error?: string };
      if (!response.ok || !payload.token) throw new Error(payload.error ?? "无法打开剪切板");
      localStorage.setItem(STORAGE_KEY, payload.token);
      setToken(payload.token);
      applyRemote(payload);
      setMessage(payload.updatedAt ? "已同步" : "剪切板已打开");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法打开剪切板");
    } finally { setBusy(false); }
  }

  async function save() {
    if (!token) return;
    setBusy(true); setMessage("保存中…");
    try {
      const response = await fetch("/api/clipboard", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ content })
      });
      const payload = await response.json().catch(() => ({})) as ClipboardPayload & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "保存失败");
      applyRemote(payload);
      setMessage("已保存并同步");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
    } finally { setBusy(false); }
  }

  async function copy() {
    try { await navigator.clipboard.writeText(content); setMessage("已复制"); }
    catch { setMessage("浏览器不允许复制，请手动选择内容"); }
  }

  function lock() {
    localStorage.removeItem(STORAGE_KEY);
    setToken(null); setContent(""); setSavedContent(""); setRevision(""); setUpdatedAt(""); setRemoteUpdate(null); setMessage("");
  }

  if (!ready) return <main className="page-shell clipboard-page"><section className="clipboard-card glass clipboard-loading"><Cloud className="spin" aria-hidden="true" /><span>正在同步剪切板…</span></section></main>;

  if (!token) return <main className="page-shell clipboard-page">
    <section className="clipboard-unlock glass">
      <span className="clipboard-icon"><LockKeyhole aria-hidden="true" /></span>
      <h1>打开剪切板</h1>
      <p>在不同设备输入相同密码，即可访问同一份内容。</p>
      <form onSubmit={unlock}>
        <label htmlFor="clipboard-password">剪切板密码</label>
        <div className="clipboard-password-row"><input id="clipboard-password" name="password" type="password" minLength={6} maxLength={128} required autoFocus autoComplete="current-password" placeholder="至少 6 个字符" /><button type="submit" disabled={busy}>{busy ? "打开中…" : "打开"}</button></div>
      </form>
      {message && <p className="clipboard-message error" role="status">{message}</p>}
    </section>
  </main>;

  const dirty = content !== savedContent;
  return <main className="page-shell clipboard-page">
    <section className="clipboard-card glass">
      <header className="clipboard-heading">
        <div><span className="clipboard-kicker"><Cloud size={14} aria-hidden="true" />实时同步</span><h1>剪切板</h1><p>{dirty ? "有尚未保存的更改" : `上次保存 ${timeLabel(updatedAt)}`}</p></div>
        <button type="button" className="clipboard-lock" onClick={lock}><LockKeyhole size={17} aria-hidden="true" />锁定</button>
      </header>

      {remoteUpdate && <div className="clipboard-remote" role="status"><CloudDownload size={18} aria-hidden="true" /><span>另一台设备保存了新内容</span><button type="button" onClick={() => applyRemote(remoteUpdate)}>载入新内容</button></div>}

      <label className="clipboard-editor"><span className="sr-only">剪切板内容</span><textarea value={content} maxLength={100_000} spellCheck="false" placeholder="在这里粘贴或输入内容…" onChange={(event) => setContent(event.target.value)} /></label>

      <footer className="clipboard-actions">
        <span className="clipboard-status" role="status">{message || `${content.length.toLocaleString("zh-CN")} / 100,000`}</span>
        <button type="button" className="clipboard-copy" onClick={() => void copy()}><ClipboardCopy size={17} aria-hidden="true" />复制</button>
        <button type="button" className="clipboard-save" disabled={busy || !dirty} onClick={() => void save()}>{dirty ? <Save size={17} aria-hidden="true" /> : <Check size={17} aria-hidden="true" />}{busy ? "保存中…" : dirty ? "保存并同步" : "已保存"}</button>
      </footer>
    </section>
  </main>;
}
