import { blankError, parseJsonContent, refusalError, remainingTime, statusError, transportError, truncatedError, type AiConfig, type AiMessage, type AiRequestOptions } from "@/lib/ai-shared";

// OpenAI 格式的 Chat Completions 接口：DeepSeek、OpenAI 和其他兼容接口共用，按渠道预设调整参数

function buildBody(config: AiConfig, messages: AiMessage[], options: AiRequestOptions) {
  const body: Record<string, unknown> = { model: config.model, messages, stream: false };
  const effort = config.reasoningEffort;
  if (config.provider === "deepseek") {
    body.max_tokens = options.maxTokens;
    if (effort && effort !== "none") {
      body.thinking = { type: "enabled" };
      body.reasoning_effort = effort;
    } else {
      // 归类用不上思维链：默认关闭思考模式，更快也更省，关闭后 temperature 才生效
      body.thinking = { type: "disabled" };
      body.temperature = 0.2;
    }
    body.response_format = { type: "json_object" };
  } else if (config.provider === "openai") {
    // GPT-5 之后的推理模型不接受 max_tokens 和自定义 temperature
    body.max_completion_tokens = options.maxTokens;
    body.reasoning_effort = effort || "low";
    body.response_format = options.schema
      ? { type: "json_schema", json_schema: { name: "classification", strict: true, schema: options.schema } }
      : { type: "json_object" };
  } else {
    body.max_tokens = options.maxTokens;
    body.temperature = 0.2;
    if (effort) body.reasoning_effort = effort;
    body.response_format = { type: "json_object" };
  }
  return body;
}

type ErrorDetail = { message: string; param: string };

async function readErrorDetail(response: Response): Promise<ErrorDetail> {
  const text = await response.text().catch(() => "");
  try {
    const error = (JSON.parse(text) as { error?: { message?: unknown; param?: unknown } }).error;
    return { message: String(error?.message ?? text), param: String(error?.param ?? "") };
  } catch {
    return { message: text, param: "" };
  }
}

const adjustableParams = ["response_format", "reasoning_effort", "thinking", "temperature", "max_completion_tokens", "max_tokens"];

// 不同端点支持的可选参数不一样：400 明确指出某个参数不支持时，改写或去掉它再试
export function adaptToUnsupported(body: Record<string, unknown>, status: number, detail: ErrorDetail, adjusted: Set<string>) {
  if (status !== 400 && status !== 422) return false;
  const text = `${detail.param} ${detail.message}`.toLowerCase();
  const param = adjustableParams.find((name) => name in body && text.includes(name));
  if (!param) return false;
  const attempt = `${param}:${JSON.stringify(body[param])}`;
  if (adjusted.has(attempt)) return false;
  adjusted.add(attempt);
  const swap = param === "max_tokens" ? "max_completion_tokens" : param === "max_completion_tokens" ? "max_tokens" : "";
  if (swap && !adjusted.has(`${swap}:${JSON.stringify(body[param])}`)) {
    body[swap] = body[param];
  } else if (param === "response_format" && (body.response_format as { type?: string }).type === "json_schema") {
    // 不支持结构化输出时退回 JSON Output，再不支持就只靠提示词约束
    body.response_format = { type: "json_object" };
    return true;
  }
  delete body[param];
  return true;
}

type ChatCompletion = {
  choices?: Array<{ finish_reason?: string | null; message?: { content?: string | null; refusal?: string | null } }>;
};

export async function requestOpenAiFormat(config: AiConfig, messages: AiMessage[], options: AiRequestOptions) {
  const body = buildBody(config, messages, options);
  const deadline = Date.now() + options.timeoutMs;
  const adjusted = new Set<string>();
  let blankRetried = false;

  for (;;) {
    const timeout = remainingTime(deadline);
    let payload: ChatCompletion;
    try {
      const response = await fetch(config.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify(body),
        cache: "no-store",
        signal: AbortSignal.timeout(timeout)
      });
      if (!response.ok) {
        const detail = await readErrorDetail(response);
        if (adaptToUnsupported(body, response.status, detail, adjusted)) continue;
        throw statusError(response.status, detail.message);
      }
      payload = await response.json() as ChatCompletion;
    } catch (error) {
      throw transportError(error);
    }

    const choice = payload.choices?.[0];
    if (choice?.finish_reason === "length") throw truncatedError();
    if (choice?.message?.refusal) throw refusalError();
    const content = choice?.message?.content?.trim() ?? "";
    if (content) return parseJsonContent(content);
    // JSON Output 偶尔只返回空白（非 JSON 内容会被替换成空格），文档建议兜底重试一次
    if (blankRetried) throw blankError();
    blankRetried = true;
  }
}
