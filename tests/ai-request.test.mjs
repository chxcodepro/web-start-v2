import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import "./register-alias.mjs";

const { AiRequestError, parseJsonContent, requestAiJson, resolveAiConfig } = await import("../src/lib/ai.ts");

const names = ["AI_PROVIDER", "AI_BASE_URL", "AI_API_KEY", "AI_MODEL", "AI_REASONING_EFFORT"];
const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
afterEach(() => {
  for (const name of names) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

function configure(values) {
  for (const name of names) delete process.env[name];
  Object.assign(process.env, values);
  const resolved = resolveAiConfig();
  return resolved.config ?? resolved;
}

const completion = (content, finish = "stop") => Response.json({ choices: [{ finish_reason: finish, message: { content } }] });
const messages = [{ role: "system", content: "只输出 json" }, { role: "user", content: "条目" }];
const schema = { type: "object", properties: {}, required: [], additionalProperties: false };

function capture(t, responses) {
  const bodies = [];
  let index = 0;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    bodies.push({ url: String(url), headers: new Headers(init.headers), ...JSON.parse(init.body) });
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return typeof next === "function" ? next() : next.clone();
  });
  return bodies;
}

test("DeepSeek is the default channel and placeholders count as missing", () => {
  assert.match(configure({ AI_BASE_URL: "https://ai.example.test", AI_API_KEY: "<YOUR_AI_API_KEY>" }).error, /AI_BASE_URL 和 AI_API_KEY/);
  assert.deepEqual(configure({ AI_BASE_URL: "https://ai.example.test/v1/", AI_API_KEY: "sk-test" }), {
    provider: "deepseek", label: "DeepSeek", endpoint: "https://ai.example.test/v1/chat/completions", apiKey: "sk-test", model: "deepseek-flash", reasoningEffort: ""
  });
  assert.match(configure({ AI_BASE_URL: "不是网址", AI_API_KEY: "sk-test" }).error, /不是有效的网址/);
});

test("OpenAI is detected from its official host and defaults to a high-volume model", () => {
  const config = configure({ AI_BASE_URL: "https://api.openai.com", AI_API_KEY: "sk-test" });
  assert.equal(config.provider, "openai");
  assert.equal(config.endpoint, "https://api.openai.com/v1/chat/completions");
  assert.equal(config.model, "gpt-6-luna");
  assert.equal(configure({ AI_BASE_URL: "https://relay.example.test/v1", AI_API_KEY: "sk-test", AI_PROVIDER: "OpenAI", AI_MODEL: "gpt-6.1-sol" }).provider, "openai");
});

test("other OpenAI-compatible endpoints need a model and accept a full endpoint URL", () => {
  assert.match(configure({ AI_BASE_URL: "https://dashscope.example.test/compatible-mode/v1", AI_API_KEY: "sk-test", AI_PROVIDER: "compatible" }).error, /AI_MODEL/);
  const config = configure({ AI_BASE_URL: "https://relay.example.test/v1/chat/completions?api-version=1", AI_API_KEY: "sk-test", AI_PROVIDER: "qwen", AI_MODEL: "qwen-plus" });
  assert.equal(config.provider, "compatible");
  assert.equal(config.endpoint, "https://relay.example.test/v1/chat/completions?api-version=1");
});

test("DeepSeek requests JSON output with thinking disabled unless an effort is set", async (t) => {
  const bodies = capture(t, [completion('{"results":[]}')]);
  const config = configure({ AI_BASE_URL: "https://api.deepseek.com", AI_API_KEY: "sk-test" });
  assert.deepEqual(await requestAiJson(config, messages, { maxTokens: 512, timeoutMs: 5000, schema }), { results: [] });
  assert.equal(bodies[0].url, "https://api.deepseek.com/chat/completions");
  assert.equal(bodies[0].headers.get("authorization"), "Bearer sk-test");
  assert.deepEqual(bodies[0].thinking, { type: "disabled" });
  assert.deepEqual(bodies[0].response_format, { type: "json_object" });
  assert.equal(bodies[0].temperature, 0.2);
  assert.equal(bodies[0].max_tokens, 512);
  assert.deepEqual(bodies[0].messages, messages);

  const thinking = configure({ AI_BASE_URL: "https://api.deepseek.com", AI_API_KEY: "sk-test", AI_REASONING_EFFORT: "high" });
  await requestAiJson(thinking, messages, { maxTokens: 512, timeoutMs: 5000 });
  assert.deepEqual(bodies[1].thinking, { type: "enabled" });
  assert.equal(bodies[1].reasoning_effort, "high");
  assert.equal(bodies[1].temperature, undefined);
});

test("OpenAI requests use structured outputs and reasoning-model parameters", async (t) => {
  const bodies = capture(t, [completion("{}")]);
  await requestAiJson(configure({ AI_BASE_URL: "https://api.openai.com/v1", AI_API_KEY: "sk-test" }), messages, { maxTokens: 512, timeoutMs: 5000, schema });
  const [body] = bodies;
  assert.equal(body.max_completion_tokens, 512);
  assert.equal(body.reasoning_effort, "low");
  assert.deepEqual(body.response_format, { type: "json_schema", json_schema: { name: "classification", strict: true, schema } });
  for (const key of ["max_tokens", "temperature", "thinking"]) assert.equal(body[key], undefined, key);
});

test("generic endpoints get the most widely supported parameters", async (t) => {
  const bodies = capture(t, [completion("{}")]);
  await requestAiJson(configure({ AI_BASE_URL: "https://relay.example.test/v1", AI_API_KEY: "sk-test", AI_PROVIDER: "compatible", AI_MODEL: "glm-5" }), messages, { maxTokens: 512, timeoutMs: 5000, schema });
  assert.equal(bodies[0].max_tokens, 512);
  assert.equal(bodies[0].temperature, 0.2);
  assert.deepEqual(bodies[0].response_format, { type: "json_object" });
  assert.equal(bodies[0].thinking, undefined);
  assert.equal(bodies[0].reasoning_effort, undefined);
});

test("unsupported parameters are rewritten or dropped and the request is retried", async (t) => {
  const rejected = (message, param = null) => () => Response.json({ error: { message, type: "invalid_request_error", param } }, { status: 400 });
  const bodies = capture(t, [
    rejected("Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.", "max_tokens"),
    rejected("Unrecognized request argument supplied: thinking"),
    rejected("Unsupported value: 'temperature' does not support 0.2 with this model. Only the default (1) value is supported.", "temperature"),
    rejected("response_format json_object is not supported by this model", "response_format"),
    () => completion('{"ok":true}')
  ]);
  const config = configure({ AI_BASE_URL: "https://relay.example.test/v1", AI_API_KEY: "sk-test", AI_PROVIDER: "deepseek" });
  assert.deepEqual(await requestAiJson(config, messages, { maxTokens: 512, timeoutMs: 5000 }), { ok: true });
  assert.equal(bodies.length, 5);
  const last = bodies.at(-1);
  assert.equal(last.max_completion_tokens, 512);
  for (const key of ["max_tokens", "thinking", "temperature", "response_format"]) assert.equal(last[key], undefined, key);
});

test("structured outputs fall back to JSON mode, and token parameters never loop", async (t) => {
  const rejected = (message, param) => () => Response.json({ error: { message, param } }, { status: 400 });
  const bodies = capture(t, [
    rejected("Invalid schema for response_format 'classification'", "response_format"),
    rejected("Unsupported parameter: 'max_completion_tokens'", "max_completion_tokens"),
    rejected("Unsupported parameter: 'max_tokens'", "max_tokens"),
    () => completion("{}")
  ]);
  await requestAiJson(configure({ AI_BASE_URL: "https://api.openai.com/v1", AI_API_KEY: "sk-test" }), messages, { maxTokens: 512, timeoutMs: 5000, schema });
  assert.deepEqual(bodies[1].response_format, { type: "json_object" });
  assert.equal(bodies[2].max_tokens, 512);
  assert.equal(bodies[3].max_tokens, undefined);
  assert.equal(bodies[3].max_completion_tokens, undefined);
});

test("errors that keep naming an already adjusted parameter stop the retries", async (t) => {
  const bodies = capture(t, [() => Response.json({ error: { message: "Unsupported parameter: 'max_completion_tokens'", param: "max_completion_tokens" } }, { status: 400 })]);
  await assert.rejects(requestAiJson(configure({ AI_BASE_URL: "https://api.openai.com/v1", AI_API_KEY: "sk-test" }), messages, { maxTokens: 64, timeoutMs: 5000 }), /AI 请求失败（400）/);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[1].max_tokens, 64);
});

test("retries once when JSON mode returns blank content", async (t) => {
  const bodies = capture(t, [completion("   "), completion('{"ok":true}')]);
  const config = configure({ AI_BASE_URL: "https://api.deepseek.com", AI_API_KEY: "sk-test" });
  assert.deepEqual(await requestAiJson(config, [], { maxTokens: 64, timeoutMs: 10_000 }), { ok: true });
  assert.equal(bodies.length, 2);
});

test("maps provider failures to actionable messages and split hints", async (t) => {
  const config = configure({ AI_BASE_URL: "https://api.deepseek.com", AI_API_KEY: "sk-test" });
  const cases = [
    [401, /AI_API_KEY/, false],
    [402, /余额不足/, false],
    [404, /AI_BASE_URL 和 AI_MODEL/, false],
    [429, /太频繁/, true],
    [503, /暂时不可用/, true]
  ];
  for (const [status, message, retryable] of cases) {
    const mock = t.mock.method(globalThis, "fetch", async () => Response.json({ error: { message: "upstream" } }, { status }));
    await assert.rejects(requestAiJson(config, [], { maxTokens: 64, timeoutMs: 5000 }), (error) => {
      assert.ok(error instanceof AiRequestError);
      assert.match(error.message, message);
      assert.equal(error.retryable, retryable);
      return true;
    });
    mock.mock.restore();
  }
  const truncated = t.mock.method(globalThis, "fetch", async () => completion('{"results":[', "length"));
  await assert.rejects(requestAiJson(config, [], { maxTokens: 64, timeoutMs: 5000 }), (error) => error.code === "truncated" && /截断/.test(error.message));
  truncated.mock.restore();
  t.mock.method(globalThis, "fetch", async (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(init.signal.reason));
  }));
  await assert.rejects(requestAiJson(config, [], { maxTokens: 64, timeoutMs: 2100 }), (error) => error.code === "timeout" && error.status === 504 && error.retryable);
});

test("extracts JSON wrapped in reasoning tags, prose or code fences", () => {
  assert.deepEqual(parseJsonContent('```json\n{"results":[{"n":1}]}\n```'), { results: [{ n: 1 }] });
  assert.deepEqual(parseJsonContent('<think>先看看 {这些} 条目</think>\n{"results":[]}'), { results: [] });
  assert.deepEqual(parseJsonContent('结果如下：{"results":[]} 以上'), { results: [] });
  assert.throws(() => parseJsonContent("没有结果"), /不是 JSON/);
});

// ---------- Anthropic 格式（官方 SDK） ----------
const anthropicMessage = (text, stopReason = "end_turn") => () => Response.json({
  id: "msg_test", type: "message", role: "assistant", model: "claude-opus-5-5",
  content: [{ type: "thinking", thinking: "", signature: "sig" }, { type: "text", text }],
  stop_reason: stopReason, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 }
});
const anthropicError = (status, type, message) => () => Response.json({ type: "error", error: { type, message } }, { status });

test("Anthropic is detected from its host or an /anthropic path and defaults to Claude Opus", () => {
  const config = configure({ AI_BASE_URL: "https://api.anthropic.com/v1", AI_API_KEY: "sk-ant-test" });
  assert.equal(config.provider, "anthropic");
  assert.equal(config.endpoint, "https://api.anthropic.com");
  assert.equal(config.model, "claude-opus-5-5");
  const deepseek = configure({ AI_BASE_URL: "https://api.deepseek.com/anthropic", AI_API_KEY: "sk-test", AI_MODEL: "deepseek-flash" });
  assert.equal(deepseek.provider, "anthropic");
  assert.equal(deepseek.endpoint, "https://api.deepseek.com/anthropic");
  assert.equal(configure({ AI_BASE_URL: "https://relay.example.test/v1/messages", AI_API_KEY: "k", AI_PROVIDER: "Claude" }).endpoint, "https://relay.example.test");
});

test("Anthropic requests use effort, structured output and server-side fallbacks", async (t) => {
  const bodies = capture(t, [anthropicMessage("{\"results\":[]}")]);
  const config = configure({ AI_BASE_URL: "https://api.anthropic.com", AI_API_KEY: "sk-ant-test" });
  assert.deepEqual(await requestAiJson(config, messages, { maxTokens: 16000, timeoutMs: 5000, schema }), { results: [] });
  const [request] = bodies;
  assert.match(request.url, /^https:\/\/api\.anthropic\.com\/v1\/messages/);
  // SDK 1.x 用 Bearer 方式传 API key
  assert.equal(request.headers.get("authorization"), "Bearer sk-ant-test");
  assert.match(request.headers.get("anthropic-beta"), /server-side-fallback-2026-07-01/);
  assert.equal(request.fallbacks, "default");
  assert.equal(request.model, "claude-opus-5-5");
  assert.equal(request.max_tokens, 16000);
  assert.equal(request.system, "只输出 json");
  assert.deepEqual(request.messages, [{ role: "user", content: "条目" }]);
  assert.deepEqual(request.output_config, { effort: "low", format: { type: "json_schema", schema } });
  for (const key of ["temperature", "thinking", "betas"]) assert.equal(request[key], undefined, key);
});

test("models without server-side fallbacks skip the beta, and AI_REASONING_EFFORT maps to effort", async (t) => {
  const bodies = capture(t, [anthropicMessage("{}")]);
  const config = configure({ AI_BASE_URL: "https://api.anthropic.com", AI_API_KEY: "k", AI_MODEL: "claude-haiku-5-5", AI_REASONING_EFFORT: "medium" });
  await requestAiJson(config, messages, { maxTokens: 16000, timeoutMs: 5000 });
  assert.equal(bodies[0].fallbacks, undefined);
  assert.equal(bodies[0].headers.get("anthropic-beta"), null);
  assert.deepEqual(bodies[0].output_config, { effort: "medium" });
});

test("Anthropic-format relays drop unsupported features one at a time", async (t) => {
  const bodies = capture(t, [
    anthropicError(400, "invalid_request_error", "fallbacks: Extra inputs are not permitted"),
    anthropicError(400, "invalid_request_error", "output_config.format: json_schema output is not supported"),
    anthropicMessage("{\"ok\":true}")
  ]);
  const config = configure({ AI_BASE_URL: "https://relay.example.test", AI_API_KEY: "k", AI_PROVIDER: "anthropic" });
  assert.deepEqual(await requestAiJson(config, messages, { maxTokens: 16000, timeoutMs: 5000, schema }), { ok: true });
  assert.equal(bodies.length, 3);
  assert.equal(bodies[1].fallbacks, undefined);
  assert.equal(bodies[1].headers.get("anthropic-beta"), null);
  assert.deepEqual(bodies[2].output_config, { effort: "low" });
});

test("Anthropic refusals, truncation and HTTP errors map to the shared messages", async (t) => {
  const config = configure({ AI_BASE_URL: "https://api.anthropic.com", AI_API_KEY: "k" });
  const cases = [
    [anthropicMessage("", "refusal"), (error) => /拒绝/.test(error.message)],
    [anthropicMessage("{\"results\":[", "max_tokens"), (error) => error.code === "truncated"],
    [anthropicError(401, "authentication_error", "invalid x-api-key"), (error) => /AI_API_KEY/.test(error.message) && !error.retryable],
    [anthropicError(402, "billing_error", "credit balance too low"), (error) => /余额不足/.test(error.message)],
    [anthropicError(429, "rate_limit_error", "slow down"), (error) => error.status === 429 && error.retryable],
    [anthropicError(529, "overloaded_error", "Overloaded"), (error) => error.status === 503 && error.retryable]
  ];
  for (const [response, check] of cases) {
    const mock = t.mock.method(globalThis, "fetch", async () => response());
    await assert.rejects(requestAiJson(config, messages, { maxTokens: 64, timeoutMs: 5000 }), (error) => error instanceof AiRequestError && check(error));
    mock.mock.restore();
  }
});

// ---------- Gemini 原生格式 ----------
const geminiResponse = (text, finishReason = "STOP", extra = {}) => () => Response.json({
  candidates: [{ content: { role: "model", parts: [{ text: "先想一想", thought: true }, { text }] }, finishReason }], ...extra
});
const geminiError = (status, message, state = "INVALID_ARGUMENT") => () => Response.json({ error: { code: status, message, status: state } }, { status });

test("Gemini is detected from its host and calls generateContent with a JSON schema", async (t) => {
  const config = configure({ AI_BASE_URL: "https://generativelanguage.googleapis.com", AI_API_KEY: "gm-test" });
  assert.equal(config.provider, "gemini");
  assert.equal(config.endpoint, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent");
  const bodies = capture(t, [geminiResponse("{\"results\":[]}")]);
  assert.deepEqual(await requestAiJson(config, messages, { maxTokens: 16000, timeoutMs: 5000, schema }), { results: [] });
  const [request] = bodies;
  assert.equal(request.headers.get("x-goog-api-key"), "gm-test");
  assert.equal(request.headers.get("authorization"), null);
  assert.deepEqual(request.systemInstruction, { parts: [{ text: "只输出 json" }] });
  assert.deepEqual(request.contents, [{ role: "user", parts: [{ text: "条目" }] }]);
  assert.deepEqual(request.generationConfig, { responseMimeType: "application/json", maxOutputTokens: 16000, thinkingConfig: { thinkingLevel: "LOW" }, responseJsonSchema: schema });
});

test("Gemini endpoints can be relays, full URLs or the OpenAI-compatible path", () => {
  assert.equal(configure({ AI_BASE_URL: "https://relay.example.test/gemini", AI_API_KEY: "k", AI_PROVIDER: "google", AI_MODEL: "models/gemini-4-argon" }).endpoint, "https://relay.example.test/gemini/v1beta/models/gemini-4-argon:generateContent");
  assert.equal(configure({ AI_BASE_URL: "https://relay.example.test/v1beta/models/gemini-3.8-flash:generateContent", AI_API_KEY: "k", AI_PROVIDER: "gemini" }).endpoint, "https://relay.example.test/v1beta/models/gemini-3.8-flash:generateContent");
  assert.equal(configure({ AI_BASE_URL: "https://generativelanguage.googleapis.com/v1beta/openai", AI_API_KEY: "k", AI_MODEL: "gemini-3.5-flash-lite" }).provider, "compatible");
});

test("Gemini drops generation settings an older model rejects", async (t) => {
  const bodies = capture(t, [
    geminiError(400, "Invalid JSON payload received. Unknown name \"thinkingLevel\" at 'generation_config.thinking_config': Cannot find field."),
    geminiResponse("{\"ok\":true}")
  ]);
  const config = configure({ AI_BASE_URL: "https://generativelanguage.googleapis.com", AI_API_KEY: "k", AI_MODEL: "gemini-2.5-flash", AI_REASONING_EFFORT: "high" });
  assert.deepEqual(await requestAiJson(config, messages, { maxTokens: 64, timeoutMs: 5000 }), { ok: true });
  assert.deepEqual(bodies[0].generationConfig.thinkingConfig, { thinkingLevel: "HIGH" });
  assert.equal(bodies[1].generationConfig.thinkingConfig, undefined);
  assert.equal(bodies[1].generationConfig.responseMimeType, "application/json");
});

test("Gemini blocks, truncation and invalid keys map to the shared messages", async (t) => {
  const config = configure({ AI_BASE_URL: "https://generativelanguage.googleapis.com", AI_API_KEY: "k" });
  const cases = [
    [geminiError(400, "API key not valid. Please pass a valid API key."), (error) => /AI_API_KEY/.test(error.message)],
    [geminiResponse("{\"results\":[", "MAX_TOKENS"), (error) => error.code === "truncated"],
    [geminiResponse("", "SAFETY"), (error) => /拒绝/.test(error.message)],
    [() => Response.json({ promptFeedback: { blockReason: "PROHIBITED_CONTENT" } }), (error) => /拒绝/.test(error.message)],
    [geminiError(429, "Resource has been exhausted", "RESOURCE_EXHAUSTED"), (error) => error.status === 429 && error.retryable]
  ];
  for (const [response, check] of cases) {
    const mock = t.mock.method(globalThis, "fetch", async () => response());
    await assert.rejects(requestAiJson(config, messages, { maxTokens: 64, timeoutMs: 5000 }), (error) => error instanceof AiRequestError && check(error));
    mock.mock.restore();
  }
});
