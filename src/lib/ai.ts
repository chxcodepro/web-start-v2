import { requestAnthropic } from "@/lib/ai-anthropic";
import { requestGemini } from "@/lib/ai-gemini";
import { requestOpenAiFormat } from "@/lib/ai-openai";
import type { AiConfig, AiMessage, AiProvider, AiRequestOptions } from "@/lib/ai-shared";

// AI 渠道配置与请求分发：OpenAI 格式（DeepSeek、OpenAI、其他兼容接口）、Anthropic 格式、Gemini 格式
// 默认渠道为 DeepSeek；密钥只在服务端读取，不会下发到浏览器

export { AiRequestError, parseJsonContent } from "@/lib/ai-shared";
export type { AiConfig, AiMessage, AiProvider } from "@/lib/ai-shared";

const presets: Record<AiProvider, { label: string; defaultModel: string }> = {
  // DeepSeek 已于 2026-07-24 停用 deepseek-chat，当前通用模型是 deepseek-flash
  deepseek: { label: "DeepSeek", defaultModel: "deepseek-flash" },
  // OpenAI 面向大批量、低成本任务的模型
  openai: { label: "OpenAI", defaultModel: "gpt-6-luna" },
  anthropic: { label: "Anthropic", defaultModel: "claude-opus-5-5" },
  // Gemini 面向高吞吐场景、速度最快的模型
  gemini: { label: "Gemini", defaultModel: "gemini-3.5-flash-lite" },
  // 其他 OpenAI 兼容接口（中转、通义、Kimi、OpenRouter 等）模型名各不相同，必须指定
  compatible: { label: "OpenAI 兼容接口", defaultModel: "" }
};

const providerNames: Record<string, AiProvider> = {
  deepseek: "deepseek",
  openai: "openai",
  anthropic: "anthropic",
  claude: "anthropic",
  gemini: "gemini",
  google: "gemini"
};

function readEnv(name: string) {
  const value = process.env[name]?.trim() ?? "";
  // .env.example 里的 <YOUR_...> 占位符视为未填写
  return /^<.*>$/.test(value) ? "" : value;
}

function detectProvider(url: URL): AiProvider {
  const explicit = readEnv("AI_PROVIDER").toLowerCase();
  if (explicit) return providerNames[explicit] ?? "compatible";
  // 没指定时按官方地址判断，其余地址默认按 DeepSeek 渠道处理
  const path = url.pathname.toLowerCase();
  if (url.hostname === "api.openai.com") return "openai";
  if (url.hostname === "api.anthropic.com" || /\/anthropic(\/|$)/.test(path)) return "anthropic";
  if (url.hostname === "generativelanguage.googleapis.com") return path.includes("/openai") ? "compatible" : "gemini";
  return "deepseek";
}

// OpenAI 格式：可以填到 /v1 为止，也可以直接填完整的 /chat/completions 地址
function chatEndpoint(url: URL, path: string) {
  if (/\/chat\/completions$/i.test(path)) return `${url.origin}${path}${url.search}`;
  const base = url.hostname === "api.openai.com" && !path ? "/v1" : path;
  return `${url.origin}${base}/chat/completions${url.search}`;
}

// Anthropic 格式：SDK 会自己拼 /v1/messages，这里去掉用户多填的部分
function anthropicEndpoint(url: URL, path: string) {
  return `${url.origin}${path.replace(/\/v1(\/messages)?$/i, "")}`;
}

// Gemini 格式：可以只填域名、填到 /v1beta，或直接填完整的 :generateContent 地址
function geminiEndpoint(url: URL, path: string, model: string) {
  if (/:generatecontent$/i.test(path)) return `${url.origin}${path}${url.search}`;
  let base = path.replace(/\/models$/i, "");
  if (!/\/v1(beta|alpha)?$/i.test(base)) base = `${base}/v1beta`;
  return `${url.origin}${base}/models/${encodeURIComponent(model.replace(/^models\//, ""))}:generateContent${url.search}`;
}

export function resolveAiConfig(): { config: AiConfig } | { error: string } {
  const baseUrl = readEnv("AI_BASE_URL");
  const apiKey = readEnv("AI_API_KEY");
  if (!baseUrl || !apiKey) return { error: "AI 尚未配置：请设置 AI_BASE_URL 和 AI_API_KEY" };
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return { error: "AI_BASE_URL 不是有效的网址" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { error: "AI_BASE_URL 只支持 http 或 https" };
  const provider = detectProvider(url);
  const preset = presets[provider];
  const model = readEnv("AI_MODEL") || preset.defaultModel;
  if (!model) return { error: `${preset.label}需要设置 AI_MODEL` };
  const path = url.pathname.replace(/\/+$/, "");
  const endpoint = provider === "anthropic" ? anthropicEndpoint(url, path)
    : provider === "gemini" ? geminiEndpoint(url, path, model)
      : chatEndpoint(url, path);
  return { config: { provider, label: preset.label, endpoint, apiKey, model, reasoningEffort: readEnv("AI_REASONING_EFFORT").toLowerCase() } };
}

export function requestAiJson(config: AiConfig, messages: AiMessage[], options: AiRequestOptions) {
  if (config.provider === "anthropic") return requestAnthropic(config, messages, options);
  if (config.provider === "gemini") return requestGemini(config, messages, options);
  return requestOpenAiFormat(config, messages, options);
}
