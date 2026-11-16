import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AiRequestError, requestAiJson, resolveAiConfig } from "@/lib/ai";
import { MAX_PLAN_ITEMS, buildPlanPrompt, parsePlanResult, planSchema } from "@/lib/ai-plan";
import { getFreshCollection } from "@/lib/data";
import { requireOwner } from "@/lib/owner";

export const runtime = "nodejs";
// 一次看完这次要整理的全部条目，条目多时需要多一点时间
export const maxDuration = 60;

const schema = z.object({
  kind: z.enum(["bookmark", "github"]),
  ids: z.array(z.string().uuid()).min(1).max(MAX_PLAN_ITEMS)
});

// 「允许新建分组」时先调用：只返回提议的新分组，不写数据库
export async function POST(request: NextRequest) {
  try {
    await requireOwner();
    const body = schema.parse(await request.json());
    const resolved = resolveAiConfig();
    if ("error" in resolved) return NextResponse.json({ error: resolved.error, retryable: false }, { status: 503 });
    const { config } = resolved;
    const prompt = buildPlanPrompt(body.kind, await getFreshCollection(body.kind), body.ids);
    const engine = { provider: config.label, model: config.model };
    if (!prompt.itemCount) return NextResponse.json({ groups: [], engine });
    const raw = await requestAiJson(config, prompt.messages, { maxTokens: 2000, timeoutMs: 50_000, schema: planSchema });
    return NextResponse.json({ groups: parsePlanResult(raw, prompt.existingNames), engine });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "请先登录" }, { status: 401 });
    if (error instanceof z.ZodError) return NextResponse.json({ error: "请求参数不正确" }, { status: 400 });
    if (error instanceof AiRequestError) return NextResponse.json({ error: error.message, retryable: error.retryable, code: error.code }, { status: error.status });
    console.error("[ai-plan]", error);
    return NextResponse.json({ error: "规划新分组失败，请稍后重试", retryable: true }, { status: 500 });
  }
}
