import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AiRequestError, requestAiJson, resolveAiConfig } from "@/lib/ai";
import { MAX_BATCH_ITEMS, MAX_NEW_GROUPS, buildClassifyPrompt, classifySchema, parseClassifyResult } from "@/lib/ai-classify";
import { getFreshCollection } from "@/lib/data";
import { requireOwner } from "@/lib/owner";

export const runtime = "nodejs";
// 前端按小批次并发请求，单批留足 AI 响应时间，同时不超过 Vercel 函数时长上限
export const maxDuration = 60;

const schema = z.object({
  kind: z.enum(["bookmark", "github"]),
  ids: z.array(z.string().uuid()).min(1).max(MAX_BATCH_ITEMS),
  // 用户确认要新建的分组；只用现有分组时为空
  newGroups: z.array(z.object({ name: z.string().trim().min(1).max(40), description: z.string().max(120).optional() })).max(MAX_NEW_GROUPS).default([])
});

function errorResponse(error: unknown) {
  if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "请先登录" }, { status: 401 });
  if (error instanceof z.ZodError) return NextResponse.json({ error: "请求参数不正确" }, { status: 400 });
  if (error instanceof AiRequestError) return NextResponse.json({ error: error.message, retryable: error.retryable, code: error.code }, { status: error.status });
  console.error("[ai-classify]", error);
  return NextResponse.json({ error: "AI 整理失败，请稍后重试", retryable: true }, { status: 500 });
}

// 只返回建议，不写数据库；应用和撤销走现有的移动接口
export async function POST(request: NextRequest) {
  try {
    await requireOwner();
    const body = schema.parse(await request.json());
    const resolved = resolveAiConfig();
    if ("error" in resolved) return NextResponse.json({ error: resolved.error, retryable: false }, { status: 503 });
    const { config } = resolved;

    const groups = await getFreshCollection(body.kind);
    const prompt = buildClassifyPrompt(body.kind, groups, body.ids, body.newGroups);
    // AI 只在给定的分组里挑选，一个分组都没有时不必请求
    if (!prompt.groupKeys.size) return NextResponse.json({ error: "还没有分组，请先新建分组再让 AI 整理", retryable: false }, { status: 409 });
    const engine = { provider: config.label, model: config.model };
    if (!prompt.itemIds.size) return NextResponse.json({ suggestions: [], missing: [], engine });

    const raw = await requestAiJson(config, prompt.messages, { maxTokens: 16000, timeoutMs: 50_000, schema: classifySchema });
    return NextResponse.json({ ...parseClassifyResult(raw, prompt), engine });
  } catch (error) {
    return errorResponse(error);
  }
}
