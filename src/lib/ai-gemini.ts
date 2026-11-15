import { AiRequestError, blankError, parseJsonContent, refusalError, remainingTime, splitMessages, statusError, statusMessages, transportError, truncatedError, type AiConfig, type AiMessage, type AiRequestOptions } from "@/lib/ai-shared";

// Gemini 原生 generateContent 接口；提供 Gemini 格式的中转也走这里

// AI_REASONING_EFFORT 映射到 thinkingLevel；不同模型支持的档位不同，low 覆盖面最广
const thinkingLevels: Record<string, string> = { none: "MINIMAL", minimal: "MINIMAL", low: "LOW", medium: "MEDIUM", high: "HIGH", xhigh: "XHIGH", max: "XHIGH" };
// 这些结束原因表示内容被安全策略拦下
const blockedReasons = new Set(["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "LANGUAGE"]);

type GeminiResponse = {
  promptFeedback?: { blockReason?: string };
  candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
};

// Gemini 字段在错误信息里可能是驼峰也可能是下划线写法
const adjustable: Array<[string, RegExp]> = [
  ["thinkingConfig", /thinking/i],
  ["responseJsonSchema", /schema/i],
  ["responseMimeType", /response_?mime_?type/i],
  ["maxOutputTokens", /max_?output_?tokens/i]
];

export async function requestGemini(config: AiConfig, messages: AiMessage[], options: AiRequestOptions) {
  const { system, user } = splitMessages(messages);
  const generationConfig: Record<string, unknown> = {
    responseMimeType: "application/json",
    maxOutputTokens: options.maxTokens,
    thinkingConfig: { thinkingLevel: thinkingLevels[config.reasoningEffort] ?? "LOW" }
  };
  if (options.schema) generationConfig.responseJsonSchema = options.schema;
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: user }] }],
    generationConfig
  };
  const deadline = Date.now() + options.timeoutMs;
  let blankRetried = false;

  for (;;) {
    const timeout = remainingTime(deadline);
    let payload: GeminiResponse;
    try {
      const response = await fetch(config.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": config.apiKey },
        body: JSON.stringify(body),
        cache: "no-store",
        signal: AbortSignal.timeout(timeout)
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        let message = text;
        try { message = String((JSON.parse(text) as { error?: { message?: unknown } }).error?.message ?? text); } catch {}
        // 密钥无效时 Gemini 返回的是 400 而不是 401
        if (/api key not valid|api_key_invalid/i.test(text)) throw new AiRequestError(statusMessages[401]);
        if (response.status === 400) {
          // 旧模型或中转不支持某个生成参数时，去掉它再试
          const match = adjustable.find(([field, pattern]) => field in generationConfig && pattern.test(message));
          if (match) {
            delete generationConfig[match[0]];
            continue;
          }
        }
        throw statusError(response.status, message);
      }
      payload = await response.json() as GeminiResponse;
    } catch (error) {
      throw transportError(error);
    }

    if (payload.promptFeedback?.blockReason) throw refusalError();
    const candidate = payload.candidates?.[0];
    if (candidate?.finishReason === "MAX_TOKENS") throw truncatedError();
    if (candidate?.finishReason && blockedReasons.has(candidate.finishReason)) throw refusalError();
    // 跳过思考内容，只拼接正文
    const text = (candidate?.content?.parts ?? []).filter((part) => !part.thought && part.text).map((part) => part.text).join("").trim();
    if (text) return parseJsonContent(text);
    if (blankRetried) throw blankError();
    blankRetried = true;
  }
}
