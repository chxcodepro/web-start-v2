// AI 调用的公共部分：配置与错误类型、状态码提示和 JSON 解析，各接口格式的实现共用

export type AiProvider = "deepseek" | "openai" | "compatible" | "anthropic" | "gemini";

export type AiConfig = {
  provider: AiProvider;
  label: string;
  // OpenAI 格式为 /chat/completions 完整地址；Anthropic 为 SDK 的 baseURL；Gemini 为 generateContent 完整地址
  endpoint: string;
  apiKey: string;
  model: string;
  reasoningEffort: string;
};

export type AiMessage = { role: "system" | "user"; content: string };

export type AiRequestOptions = { maxTokens: number; timeoutMs: number; schema?: Record<string, unknown> };

// timeout / truncated 表示这一批太大，前端会拆成两半重试
export type AiErrorCode = "timeout" | "truncated";

export class AiRequestError extends Error {
  readonly status: number;
  readonly code?: AiErrorCode;

  constructor(message: string, status = 502, code?: AiErrorCode) {
    super(message);
    this.status = status;
    this.code = code;
  }

  // 限流、超时和服务繁忙值得重试；密钥、余额、参数错误重试也没用
  get retryable() {
    return this.status === 429 || this.status === 503 || this.status === 504;
  }
}

export const statusMessages: Record<number, string> = {
  401: "AI 接口密钥无效，请检查 AI_API_KEY",
  402: "AI 账户余额不足",
  403: "AI 接口拒绝访问，请检查密钥权限",
  404: "AI 接口地址或模型名不正确，请检查 AI_BASE_URL 和 AI_MODEL",
  429: "AI 接口请求太频繁或额度已用完，请稍后再试"
};

export function statusError(status: number, detail: string) {
  const known = statusMessages[status];
  if (known) return new AiRequestError(known, status === 429 ? 429 : 502);
  if (status >= 500) return new AiRequestError("AI 服务暂时不可用，请稍后再试", 503);
  const message = detail.replace(/\s+/g, " ").trim().slice(0, 160);
  return new AiRequestError(`AI 请求失败（${status}）${message ? `：${message}` : ""}`, 502);
}

export const timeoutError = () => new AiRequestError("AI 响应超时，请稍后重试", 504, "timeout");
export const truncatedError = () => new AiRequestError("AI 输出被截断，这一批条目太多", 502, "truncated");
export const refusalError = () => new AiRequestError("AI 拒绝了这次整理请求", 502);
export const blankError = () => new AiRequestError("AI 返回了空结果，请稍后重试", 503);

export function transportError(error: unknown) {
  if (error instanceof AiRequestError) return error;
  const name = error instanceof Error ? error.name : "";
  if (name === "TimeoutError" || name === "AbortError") return timeoutError();
  return new AiRequestError("无法连接 AI 接口，请检查 AI_BASE_URL", 503);
}

// 剩余时间不够再发一次请求时直接按超时处理，避免超过函数时长上限
export function remainingTime(deadline: number) {
  const left = deadline - Date.now();
  if (left < 2000) throw timeoutError();
  return left;
}

// Anthropic 和 Gemini 把系统提示词单独传，这里把消息拆成两段
export function splitMessages(messages: AiMessage[]) {
  const join = (role: AiMessage["role"]) => messages.filter((message) => message.role === role).map((message) => message.content).join("\n\n");
  return { system: join("system"), user: join("user") };
}

// 兼容把 JSON 包在代码块里、或在前面输出 <think> 推理内容的端点
export function parseJsonContent(content: string): unknown {
  const text = content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new AiRequestError("AI 返回的内容不是 JSON");
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new AiRequestError("AI 返回的 JSON 无法解析");
  }
}
