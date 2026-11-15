import Anthropic from "@anthropic-ai/sdk";
import { AiRequestError, blankError, parseJsonContent, refusalError, remainingTime, splitMessages, statusMessages, timeoutError, truncatedError, type AiConfig, type AiMessage, type AiRequestOptions } from "@/lib/ai-shared";

// Anthropic Messages API，使用官方 SDK；提供 Anthropic 格式的中转（如 DeepSeek 的 /anthropic 地址）也走这里

// 这些模型被安全分类器拒绝时，由服务端自动换模型重试（server-side fallbacks）
const fallbackModels = new Set(["claude-fable-5-2", "claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);
type Effort = "low" | "medium" | "high" | "xhigh" | "max";
const efforts = new Set(["low", "medium", "high", "xhigh", "max"]);
type Feature = "fallbacks" | "effort" | "format";

function errorDetail(error: InstanceType<typeof Anthropic.APIError>) {
  const body = error.error as { error?: { message?: unknown } } | undefined;
  return String(body?.error?.message ?? error.message);
}

// 按状态从具体到宽泛判断；连接超时是连接错误的子类，要先判断
function sdkError(error: unknown) {
  if (error instanceof AiRequestError) return error;
  if (error instanceof Anthropic.AuthenticationError) return new AiRequestError(statusMessages[401]);
  if (error instanceof Anthropic.PermissionDeniedError) return new AiRequestError(statusMessages[403]);
  if (error instanceof Anthropic.NotFoundError) return new AiRequestError(statusMessages[404]);
  if (error instanceof Anthropic.RateLimitError) return new AiRequestError(statusMessages[429], 429);
  if (error instanceof Anthropic.InternalServerError) return new AiRequestError("AI 服务暂时不可用，请稍后再试", 503);
  if (error instanceof Anthropic.APIConnectionTimeoutError) return timeoutError();
  if (error instanceof Anthropic.APIConnectionError) return new AiRequestError("无法连接 AI 接口，请检查 AI_BASE_URL", 503);
  if (error instanceof Anthropic.APIError) {
    // 余额不足（402 billing_error）没有单独的错误类
    if (error.status === 402) return new AiRequestError(statusMessages[402]);
    return new AiRequestError(`AI 请求失败（${error.status ?? "未知状态"}）：${errorDetail(error).replace(/\s+/g, " ").slice(0, 160)}`);
  }
  return new AiRequestError("AI 请求失败");
}

// 中转或旧模型不支持某个可选功能时，按 400 错误里提到的内容关掉它再试，每项只调整一次
function adapt(enabled: Record<Feature, boolean>, error: unknown, adjusted: Set<Feature>) {
  if (!(error instanceof Anthropic.BadRequestError) && !(error instanceof Anthropic.UnprocessableEntityError)) return false;
  const text = errorDetail(error).toLowerCase();
  const suspects: Feature[] = [];
  if (/fallback|beta/.test(text)) suspects.push("fallbacks");
  if (/effort/.test(text)) suspects.push("effort");
  if (/json_schema|format|schema/.test(text)) suspects.push("format");
  if (!suspects.length && text.includes("output_config")) suspects.push("effort", "format");
  const changed = suspects.filter((feature) => enabled[feature] && !adjusted.has(feature));
  for (const feature of changed) {
    enabled[feature] = false;
    adjusted.add(feature);
  }
  return changed.length > 0;
}

export async function requestAnthropic(config: AiConfig, messages: AiMessage[], options: AiRequestOptions) {
  const { system, user } = splitMessages(messages);
  // 重试和超时由这里和前端控制，SDK 不再自动重试
  const client = new Anthropic({ apiKey: config.apiKey, baseURL: config.endpoint, maxRetries: 0 });
  // 当前模型的思考模式关不掉，用 effort 控制思考量；归类任务用 low 就够
  const effort = (efforts.has(config.reasoningEffort) ? config.reasoningEffort : "low") as Effort;
  const enabled: Record<Feature, boolean> = { fallbacks: fallbackModels.has(config.model), effort: true, format: Boolean(options.schema) };
  const adjusted = new Set<Feature>();
  const deadline = Date.now() + options.timeoutMs;
  let blankRetried = false;

  for (;;) {
    const timeout = remainingTime(deadline);
    const outputConfig = {
      ...(enabled.effort ? { effort } : {}),
      ...(enabled.format && options.schema ? { format: { type: "json_schema" as const, schema: options.schema } } : {})
    };
    let message;
    try {
      message = await client.beta.messages.create({
        model: config.model,
        max_tokens: options.maxTokens,
        system,
        messages: [{ role: "user", content: user }],
        ...(Object.keys(outputConfig).length ? { output_config: outputConfig } : {}),
        ...(enabled.fallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {})
      }, { timeout, maxRetries: 0 });
    } catch (error) {
      if (adapt(enabled, error, adjusted)) continue;
      throw sdkError(error);
    }

    // 兜底模型也拒绝时整条链路才会返回 refusal
    if (message.stop_reason === "refusal") throw refusalError();
    if (message.stop_reason === "max_tokens" || message.stop_reason === "model_context_window_exceeded") throw truncatedError();
    // 回复可能以 thinking 块开头，只取文本块
    const text = message.content.flatMap((block) => block.type === "text" ? [block.text] : []).join("").trim();
    if (text) return parseJsonContent(text);
    if (blankRetried) throw blankError();
    blankRetried = true;
  }
}
