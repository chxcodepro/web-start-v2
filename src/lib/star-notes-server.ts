import { AiRequestError, requestAiJson, resolveAiConfig } from "@/lib/ai";
import { fetchReadme } from "@/lib/github";
import { NOTE_BATCH_SIZE, analyzeSchema, buildAnalyzePrompt, buildTranslatePrompt, needsChineseNote, parseAnalyzeResult, parseTranslateResult, readmeExcerpt, translateSchema, type NoteSource } from "@/lib/star-notes";
import { getSupabaseAdmin } from "@/lib/supabase";

// 服务端：读写数据库、调用 AI 的部分。提示词和解析在 star-notes.ts

export type NoteTranslation = { translated: number; pending: number; skipped?: string; error?: string };

const CONCURRENCY = 3;
// 剩余时间不够一次完整请求时不再开新批次，留给下一次
const MIN_BATCH_TIME = 15_000;

type StarRow = { id: string; full_name: string; description: string | null; note: string | null; topics?: string[] | null; language: string | null };

function toSource(row: StarRow): NoteSource {
  return { id: String(row.id), fullName: String(row.full_name), description: row.description, note: row.note, topics: Array.isArray(row.topics) ? row.topics.map(String) : [], language: row.language };
}

function chunk<T>(list: T[], size: number) {
  return Array.from({ length: Math.ceil(list.length / size) }, (_, index) => list.slice(index * size, index * size + size));
}

// 只覆盖读取时的旧值：翻译期间用户刚好改了备注，就保留用户写的
async function saveNotes(batch: NoteSource[], notes: Map<string, string>) {
  const db = getSupabaseAdmin();
  const results = await Promise.all(batch.map(async (star) => {
    const text = notes.get(star.id);
    if (!text) return 0;
    const update = db.from("github_stars").update({ note: text }).eq("id", star.id);
    const { data, error } = await (star.note === null ? update.is("note", null) : update.eq("note", star.note)).select("id");
    return !error && data?.length ? 1 : 0;
  }));
  return results.reduce<number>((sum, value) => sum + value, 0);
}

// 在时间预算内把还没有中文备注的 Star 分批翻译；没做完的留给下一次同步或手动继续
export async function translateStarNotes({ budgetMs }: { budgetMs: number }): Promise<NoteTranslation> {
  const deadline = Date.now() + budgetMs;
  const { data, error } = await getSupabaseAdmin().from("github_stars").select("*").eq("is_active", true);
  if (error) throw error;
  const candidates = ((data ?? []) as StarRow[]).map(toSource).filter(needsChineseNote);
  if (!candidates.length) return { translated: 0, pending: 0 };
  const resolved = resolveAiConfig();
  if ("error" in resolved) return { translated: 0, pending: candidates.length, skipped: resolved.error };
  const { config } = resolved;

  const queue = chunk(candidates, NOTE_BATCH_SIZE);
  let translated = 0;
  let lastError = "";
  let stopped = false;
  const worker = async () => {
    while (queue.length && !stopped) {
      const remaining = deadline - Date.now();
      if (remaining < MIN_BATCH_TIME) return;
      const batch = queue.shift();
      if (!batch) return;
      try {
        const prompt = buildTranslatePrompt(batch);
        const raw = await requestAiJson(config, prompt.messages, { maxTokens: 4000, timeoutMs: Math.min(40_000, remaining - 3000), schema: translateSchema });
        translated += await saveNotes(batch, parseTranslateResult(raw, prompt));
      } catch (cause) {
        lastError = cause instanceof Error ? cause.message : "翻译备注失败";
        // 密钥、权限、余额这类错误再试也没用，后面的批次直接不发
        if (cause instanceof AiRequestError && !cause.retryable && !cause.code) stopped = true;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
  return { translated, pending: candidates.length - translated, ...(lastError ? { error: lastError } : {}) };
}

// 带 HTTP 状态码的业务错误，路由按它返回
export class NoteError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// 编辑弹窗的「AI 分析」：结合 README 生成一条备注，只返回结果，不写数据库，由用户确认后保存
export async function analyzeStarNote(id: string) {
  const resolved = resolveAiConfig();
  if ("error" in resolved) throw new NoteError(resolved.error, 503);
  const { config } = resolved;
  const { data, error } = await getSupabaseAdmin().from("github_stars").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw new NoteError("没有找到这个项目，请刷新页面后再试", 404);
  const star = toSource(data as StarRow);
  const readme = readmeExcerpt(await fetchReadme(star.fullName));
  const raw = await requestAiJson(config, buildAnalyzePrompt(star, readme), { maxTokens: 1500, timeoutMs: 45_000, schema: analyzeSchema });
  return { note: parseAnalyzeResult(raw), usedReadme: Boolean(readme), engine: { provider: config.label, model: config.model } };
}
