// AI 整理端到端冒烟测试：模拟 Supabase（PostgREST 子集）、DeepSeek 接口和登录会话，在真实浏览器里走完整流程
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { cp, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { encode } from "next-auth/jwt";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = new URL("../", import.meta.url);
const artifactDir = new URL("../artifacts/ai-organize/", import.meta.url);
const artifactPath = (name) => fileURLToPath(new URL(name, artifactDir));
const tempRoot = fileURLToPath(new URL("../artifacts/tmp/", import.meta.url));
await mkdir(tempRoot, { recursive: true });
await mkdir(artifactDir, { recursive: true });
const workspace = await mkdtemp(join(tempRoot, "ai-smoke-"));
for (const name of ["src", "next.config.ts", "tsconfig.json", "package.json", "postcss.config.mjs"]) {
  await cp(new URL(name, root), join(workspace, name), { recursive: true });
}
await symlink(fileURLToPath(new URL("node_modules", root)), join(workspace, "node_modules"), "junction");

// SMOKE_PROVIDER 选择渠道（deepseek、openai、anthropic、gemini），同一套流程检查各渠道的请求格式
const providers = {
  deepseek: { model: "deepseek-flash", label: "DeepSeek · deepseek-flash", env: "" },
  openai: { model: "gpt-6-luna", label: "OpenAI · gpt-6-luna", env: "openai" },
  anthropic: { model: "claude-opus-5-5", label: "Anthropic · claude-opus-5-5", env: "anthropic" },
  gemini: { model: "gemini-3.5-flash-lite", label: "Gemini · gemini-3.5-flash-lite", env: "gemini" }
};
const provider = Object.hasOwn(providers, process.env.SMOKE_PROVIDER ?? "") ? process.env.SMOKE_PROVIDER : "deepseek";
const expected = providers[provider];
const port = Number(process.env.SMOKE_PORT || 3198);
const base = `http://localhost:${port}`;
const secret = "smoke-test-secret-not-a-production-secret";
const timestamp = "2026-11-15T00:00:00.000Z";

// ---------- 测试数据 ----------
const makeGroup = (kind, name, sortOrder) => ({ id: randomUUID(), kind, name, sort_order: sortOrder, is_public: true });
const starGroups = { tools: makeGroup("github", "开发工具", 0), ai: makeGroup("github", "AI 应用", 1), design: makeGroup("github", "设计素材", 2) };
const bookmarkGroups = { daily: makeGroup("bookmark", "日常使用", 0), design: makeGroup("bookmark", "设计", 1), reading: makeGroup("bookmark", "阅读", 2) };
let repoId = 1000;
const makeStar = (fullName, groupId = null, sortOrder = 0) => ({
  id: randomUUID(), github_repo_id: repoId++, group_id: groupId, full_name: fullName, display_name: null,
  html_url: `https://github.com/${fullName}`, description: `${fullName} description`, language: "TypeScript", topics: ["smoke"],
  stars_count: 100, owner_avatar_url: `https://avatars.example.test/${fullName.split("/")[0]}.png`, tags: [], note: null,
  sort_order: sortOrder, is_public: true, is_active: true, starred_at: timestamp, synced_at: timestamp
});
const fillers = Array.from({ length: 24 }, (_, index) => {
  const number = String(index + 1).padStart(2, "0");
  return makeStar(`tool-${number}/cli-${number}`);
});
const specials = ["ollama/ollama", "biomejs/biome", "excalidraw/excalidraw", "home-assistant/core", "someone/mystery", "jellyfin/jellyfin"].map((name) => makeStar(name));
// 共 31 个未分组：esphome 排在第 31 位，和 home-assistant 分在不同批次
const ungroupedStars = [...specials, ...fillers, makeStar("esphome/esphome")];
const makeBookmark = (title, url, groupId, sortOrder) => ({ id: randomUUID(), group_id: groupId, title, url, description: null, favicon_url: null, tags: [], sort_order: sortOrder, is_public: true });
const tables = {
  groups: [...Object.values(starGroups), ...Object.values(bookmarkGroups)],
  github_stars: [
    makeStar("vercel/next.js", starGroups.tools.id, 0), makeStar("vitejs/vite", starGroups.tools.id, 1),
    makeStar("open-webui/open-webui", starGroups.ai.id, 0), makeStar("lucide-icons/lucide", starGroups.design.id, 0),
    ...ungroupedStars
  ],
  bookmarks: [
    makeBookmark("GitHub", "https://github.com/", bookmarkGroups.daily.id, 0),
    makeBookmark("Figma", "https://www.figma.com/", bookmarkGroups.daily.id, 1),
    makeBookmark("Hacker News", "https://news.ycombinator.com/", bookmarkGroups.daily.id, 2),
    makeBookmark("Dribbble", "https://dribbble.com/", bookmarkGroups.design.id, 0),
    makeBookmark("少数派", "https://sspai.com/", bookmarkGroups.reading.id, 0)
  ]
};
const originalUngroupedOrder = ungroupedStars.map((row) => row.id);
const starByName = (name) => tables.github_stars.find((row) => row.full_name === name);
const groupByName = (kind, name) => tables.groups.find((row) => row.kind === kind && row.name === name);

async function readBody(request) {
  let body = "";
  for await (const chunk of request) body += chunk;
  return body;
}

// ---------- 模拟 PostgREST ----------
const dbLog = [];
function rowFilter(params) {
  const checks = [];
  for (const [key, value] of params) {
    if (["select", "order", "limit", "offset", "columns", "on_conflict"].includes(key)) continue;
    const match = value.match(/^(eq|in|is)\.(.*)$/);
    if (!match) throw new Error(`不支持的筛选：${key}=${value}`);
    const [, operator, raw] = match;
    if (operator === "eq") checks.push((row) => String(row[key]) === raw);
    else if (operator === "is") checks.push((row) => raw === "null" ? row[key] === null : String(row[key]) === raw);
    else {
      const values = raw.replace(/^\(|\)$/g, "").split(",").map((entry) => entry.replace(/^"|"$/g, ""));
      checks.push((row) => values.includes(String(row[key])));
    }
  }
  return (row) => checks.every((check) => check(row));
}

const db = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://localhost");
    const table = url.pathname.split("/").at(-1);
    const rows = tables[table];
    const body = await readBody(request);
    const accept = request.headers.accept ?? "";
    const prefer = request.headers.prefer ?? "";
    dbLog.push(`${request.method} ${table}${url.search}`);
    response.setHeader("Content-Type", "application/json");
    if (request.headers.apikey !== "sb_secret_smoke_test" || !rows) {
      response.writeHead(rows ? 401 : 404);
      response.end("{}");
      return;
    }
    const match = rowFilter(url.searchParams);
    const select = url.searchParams.get("select");
    const project = (row) => !select || select === "*" ? { ...row } : Object.fromEntries(select.split(",").map((column) => [column, row[column]]));

    if (request.method === "GET" || request.method === "HEAD") {
      let result = rows.filter(match);
      const order = url.searchParams.get("order");
      if (order) {
        const [column, direction] = order.split(".");
        result = [...result].sort((left, right) => (left[column] - right[column]) * (direction === "desc" ? -1 : 1));
      }
      if (prefer.includes("count=exact")) response.setHeader("Content-Range", `0-${Math.max(result.length - 1, 0)}/${result.length}`);
      if (request.method === "HEAD") { response.writeHead(200); response.end(); return; }
      const projected = result.map(project);
      if (accept.includes("vnd.pgrst.object")) {
        if (projected.length !== 1) { response.writeHead(406); response.end(JSON.stringify({ code: "PGRST116", message: "not one row" })); return; }
        response.end(JSON.stringify(projected[0]));
        return;
      }
      response.end(JSON.stringify(projected));
      return;
    }
    if (request.method === "POST") {
      const input = JSON.parse(body);
      const created = (Array.isArray(input) ? input : [input]).map((row) => ({ id: randomUUID(), sort_order: 0, is_public: true, ...row }));
      rows.push(...created);
      response.writeHead(201);
      const projected = created.map(project);
      response.end(prefer.includes("return=representation") ? JSON.stringify(accept.includes("vnd.pgrst.object") ? projected[0] : projected) : "");
      return;
    }
    if (request.method === "PATCH") {
      const patch = JSON.parse(body);
      for (const row of rows) if (match(row)) Object.assign(row, patch);
      response.writeHead(204);
      response.end();
      return;
    }
    if (request.method === "DELETE") {
      for (let index = rows.length - 1; index >= 0; index -= 1) if (match(rows[index])) rows.splice(index, 1);
      response.writeHead(204);
      response.end();
      return;
    }
    response.writeHead(405);
    response.end("{}");
  } catch (error) {
    response.writeHead(500);
    response.end(JSON.stringify({ message: String(error) }));
  }
});

// ---------- 模拟 AI 接口：按 OpenAI、Anthropic、Gemini 三种格式收发 ----------
const aiProblems = [];
const aiRequests = [];
let failNextStatus = 0;
let transientServed = false;
let jellyfinSeen = 0;
let truncatedServed = false;
function decide(entry, keyOf) {
  const name = entry.repo ?? entry.title;
  if (/^tool-\d+\/cli-\d+$/.test(name)) return { group: keyOf("开发工具"), confidence: "high", reason: "命令行开发工具" };
  switch (name) {
    case "ollama/ollama": return { group: keyOf("AI 应用"), confidence: "high", reason: "本地运行大模型" };
    // 故意写分组名而不是编号
    case "biomejs/biome": return { group: "开发工具", confidence: "high", reason: "代码格式化工具" };
    case "excalidraw/excalidraw": return { group: keyOf("设计素材"), confidence: "medium", reason: "手绘风格白板" };
    case "home-assistant/core": return { group: null, newGroup: "智能家居", confidence: "high", reason: "家庭自动化平台" };
    // 同一个新分组的不同写法，前端应合并
    case "esphome/esphome": return { group: null, newGroup: "智能 家居", confidence: "high", reason: "智能设备固件" };
    case "jellyfin/jellyfin": return jellyfinSeen++ === 0 ? null : { group: null, newGroup: "影音娱乐", confidence: "high", reason: "家庭影音服务器" };
    case "Figma": return { group: keyOf("设计"), confidence: "high", reason: "界面设计工具" };
    case "Hacker News": return { group: keyOf("阅读"), confidence: "high", reason: "技术新闻聚合" };
    default: return { group: null, newGroup: null, confidence: "low", reason: "" };
  }
}

// 从三种请求格式里取出系统提示词和用户内容
function readPrompt(path, body) {
  if (path.startsWith("/v1/messages")) {
    const content = body.messages[0].content;
    return { format: "anthropic", system: String(body.system ?? ""), user: typeof content === "string" ? content : content.map((block) => block.text).join("") };
  }
  if (path.includes(":generateContent")) {
    return { format: "gemini", system: body.systemInstruction.parts.map((part) => part.text).join(""), user: body.contents[0].parts.map((part) => part.text).join("") };
  }
  return { format: "openai", system: body.messages.find((message) => message.role === "system").content, user: body.messages.find((message) => message.role === "user").content };
}

function checkRequest(headers, path, body) {
  const problem = (message) => aiProblems.push(message);
  if (provider === "anthropic") {
    if (!path.startsWith("/v1/messages")) problem(`路径不对：${path}`);
    if (headers.authorization !== "Bearer sk-smoke-test") problem("密钥请求头不对");
    if (!String(headers["anthropic-beta"] ?? "").includes("server-side-fallback-2026-07-01") || body.fallbacks !== "default") problem("没有启用服务端兜底");
    if (body.output_config?.effort !== "low") problem("effort 应为 low");
    if (body.output_config?.format?.type !== "json_schema" || !body.output_config.format.schema?.properties?.results) problem("没有使用结构化输出");
    if (body.max_tokens !== 16000 || "temperature" in body || "thinking" in body) problem("max_tokens、temperature 或 thinking 不对");
  } else if (provider === "gemini") {
    if (path !== `/v1beta/models/${expected.model}:generateContent`) problem(`路径不对：${path}`);
    if (headers["x-goog-api-key"] !== "sk-smoke-test") problem("密钥请求头不对");
    const config = body.generationConfig ?? {};
    if (config.responseMimeType !== "application/json" || !config.responseJsonSchema?.properties?.results) problem("没有使用 JSON Schema 输出");
    if (config.thinkingConfig?.thinkingLevel !== "LOW" || config.maxOutputTokens !== 16000) problem("thinkingLevel 或 maxOutputTokens 不对");
  } else {
    if (path !== "/chat/completions") problem(`路径不对：${path}`);
    if (headers.authorization !== "Bearer sk-smoke-test") problem("密钥请求头不对");
    if (provider === "deepseek") {
      if (body.thinking?.type !== "disabled") problem("没有关闭思考模式");
      if (body.response_format?.type !== "json_object") problem("没有开启 JSON 输出");
      if (body.temperature !== 0.2 || body.max_tokens !== 16000) problem("temperature 或 max_tokens 不对");
    } else {
      const format = body.response_format;
      if (format?.type !== "json_schema" || format.json_schema?.strict !== true || !format.json_schema?.schema?.properties?.results) problem("没有使用结构化输出");
      if (body.max_completion_tokens !== 16000 || "max_tokens" in body) problem("应使用 max_completion_tokens");
      if (body.reasoning_effort !== "low") problem("推理强度应为 low");
      if ("thinking" in body || "temperature" in body) problem("不应发送 thinking 或 temperature");
    }
  }
  if (provider !== "gemini" && body.model !== expected.model) problem(`模型不对：${body.model}`);
}

function errorBody(format, status, message) {
  if (format === "anthropic") return { type: "error", error: { type: status === 401 ? "authentication_error" : "overloaded_error", message } };
  if (format === "gemini") return { error: { code: status, message, status: status === 401 ? "UNAUTHENTICATED" : "UNAVAILABLE" } };
  return { error: { message } };
}

function replyBody(format, text, truncated) {
  if (format === "anthropic") {
    return { id: "msg_smoke", type: "message", role: "assistant", model: expected.model, content: [{ type: "text", text }], stop_reason: truncated ? "max_tokens" : "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
  }
  if (format === "gemini") return { candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: truncated ? "MAX_TOKENS" : "STOP" }] };
  return { id: "chatcmpl-smoke", object: "chat.completion", model: expected.model, choices: [{ index: 0, finish_reason: truncated ? "length" : "stop", message: { role: "assistant", content: text } }] };
}

const ai = createServer(async (request, response) => {
  const raw = await readBody(request);
  response.setHeader("Content-Type", "application/json");
  try {
    const path = new URL(request.url, "http://localhost").pathname;
    const body = JSON.parse(raw);
    const prompt = readPrompt(path, body);
    const lines = prompt.user.split("\n");
    const groups = JSON.parse(lines[1]);
    const items = JSON.parse(lines.at(-1));
    aiRequests.push({ proposed: lines[3], names: items.map((item) => item.repo ?? item.title) });
    checkRequest(request.headers, path, body);
    if (!/json/.test(prompt.system)) aiProblems.push("系统提示词缺少 json 字样");

    if (failNextStatus) {
      const status = failNextStatus;
      failNextStatus = 0;
      response.writeHead(status);
      response.end(JSON.stringify(errorBody(prompt.format, status, "Authentication Fails")));
      return;
    }
    // 第一批第一次请求返回 503，验证前端自动重试
    if (!transientServed && items.some((item) => item.repo === "ollama/ollama")) {
      transientServed = true;
      response.writeHead(503);
      response.end(JSON.stringify(errorBody(prompt.format, 503, "Server overloaded")));
      return;
    }
    // 第一次遇到超过 20 项的批次时返回被截断的输出，验证前端拆批重试
    if (!truncatedServed && items.length > 20) {
      truncatedServed = true;
      response.end(JSON.stringify(replyBody(prompt.format, '{"results":[{"n":1', true)));
      return;
    }
    // 让只有 esphome 的那批晚一点返回，新分组名以第一批的写法为准
    if (items.some((item) => item.repo === "esphome/esphome")) await delay(4000);
    const keyOf = (name) => groups.find((group) => group.name === name)?.key ?? null;
    const results = items.flatMap((item) => {
      const decision = decide(item, keyOf);
      return decision ? [{ n: item.n, ...decision }] : [];
    });
    results.push({ n: 999, group: "g1", confidence: "high", reason: "不存在的编号" });
    response.end(JSON.stringify(replyBody(prompt.format, JSON.stringify({ results }), false)));
  } catch (error) {
    aiProblems.push(`模拟接口异常：${error}`);
    response.writeHead(500);
    response.end("{}");
  }
});

await Promise.all([db, ai].map((server) => new Promise((done) => server.listen(0, "127.0.0.1", done))));

let logs = "";
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--port", String(port)], {
  cwd: workspace,
  windowsHide: true,
  env: {
    ...process.env,
    SUPABASE_URL: `http://127.0.0.1:${db.address().port}`,
    SUPABASE_SERVICE_ROLE_KEY: "sb_secret_smoke_test",
    AUTH_SECRET: secret,
    AUTH_GITHUB_ID: "smoke-test",
    AUTH_GITHUB_SECRET: "smoke-test",
    GITHUB_OWNER_LOGIN: "smoke-test",
    AI_BASE_URL: `http://127.0.0.1:${ai.address().port}`,
    AI_API_KEY: "sk-smoke-test",
    AI_PROVIDER: expected.env,
    AI_MODEL: ""
  },
  stdio: ["ignore", "pipe", "pipe"]
});
server.stdout.on("data", (chunk) => { logs += chunk; });
server.stderr.on("data", (chunk) => { logs += chunk; });

const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
let browser;
let page;
const browserErrors = [];
const sectionCount = (name) => page.locator(".editable-section").filter({ has: page.locator(".editable-title-button", { hasText: new RegExp(`^${name}$`) }) }).locator(".section-count");

try {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      const response = await fetch(`${base}/login`, { signal: AbortSignal.timeout(2000) });
      if (response.status < 500) break;
    } catch {}
    if (attempt === 89) throw new Error("开发服务没有启动");
    await delay(500);
  }

  browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || "chrome" });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const token = await encode({ token: { name: "Smoke", sub: "1", login: "smoke-test" }, secret, salt: "authjs.session-token" });
  await context.addCookies([{ name: "authjs.session-token", value: token, url: base }]);
  await context.route("**/api/background", (route) => route.fulfill({ status: 200, contentType: "image/png", body: pixel }));
  await context.route("**/api/icon**", (route) => route.fulfill({ status: 200, contentType: "image/png", body: pixel }));
  await context.route("**/api/search/suggestions**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: '{"suggestions":[]}' }));
  page = await context.newPage();
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error" && !/Failed to load resource/.test(message.text())) browserErrors.push(message.text()); });

  // ---------- Star：整理未分组 ----------
  await page.goto(`${base}/stars`);
  await page.getByRole("button", { name: "管理", exact: true }).click({ timeout: 60000 });
  await page.getByRole("button", { name: "AI 整理" }).click();
  const dialog = page.getByRole("dialog", { name: "AI 整理" });
  await dialog.waitFor();
  assert.ok(await dialog.getByRole("radio", { name: /未分组的 31 项/ }).isChecked(), "默认应选择未分组");
  assert.ok(await dialog.getByRole("radio", { name: /全部 35 项/ }).isVisible());
  await page.screenshot({ path: artifactPath("scope-desktop.png") });
  await dialog.getByRole("button", { name: "开始分析" }).click();
  const applyButton = dialog.getByRole("button", { name: /^应用 \d+ 项$/ });
  await applyButton.waitFor({ timeout: 90000 });
  assert.ok(aiRequests.some((entry) => entry.names.length === 15), "输出被截断的 30 项批次应拆成两半");
  assert.ok(await dialog.getByText(`由 ${expected.label} 分析`, { exact: true }).isVisible());
  console.log("PASS: 第一次 503 自动重试；输出被截断的批次自动拆成两半；审阅区显示所用渠道和模型");

  const smartHome = dialog.getByRole("region", { name: "移到 智能家居" });
  assert.equal(await smartHome.locator(".ai-row").count(), 2, "不同批次的「智能家居」「智能 家居」应合并");
  assert.ok(await smartHome.getByText("新建", { exact: true }).isVisible());
  assert.equal(await dialog.getByRole("region", { name: "移到 开发工具" }).locator(".ai-row").count(), 25);
  assert.equal(await dialog.getByRole("region", { name: "移到 AI 应用" }).locator(".ai-row").count(), 1);
  const designRow = dialog.getByRole("region", { name: "移到 设计素材" }).locator(".ai-row");
  assert.ok(await designRow.getByText("可能", { exact: true }).isVisible(), "中等把握应显示「可能」");
  assert.ok(await dialog.getByRole("checkbox", { name: "移动 excalidraw" }).isChecked());
  assert.match(await dialog.getByRole("alert").innerText(), /1 项没有拿到建议/);
  assert.match(await dialog.locator(".ai-keep summary").innerText(), /保持不动\s*1/);
  console.log("PASS: 分组编号和分组名都能映射；同名新分组合并；拿不准的保持不动；漏掉的条目单独列出");

  await dialog.getByRole("button", { name: "重新分析" }).click();
  await dialog.getByRole("region", { name: "移到 影音娱乐" }).waitFor({ timeout: 30000 });
  assert.equal(await dialog.getByRole("alert").count(), 0);
  assert.match(aiRequests.at(-1).proposed, /智能家居/, "重新分析时应带上已提议的新分组");
  assert.match(await dialog.locator(".ai-summary").innerText(), /其中 2 个是新分组/);
  console.log("PASS: 重新分析只请求失败的条目，并带上已提议的新分组名");

  await dialog.getByRole("checkbox", { name: "移动 cli-03" }).uncheck();
  await dialog.locator(".ai-keep summary").click();
  await dialog.getByRole("combobox", { name: "mystery 的目标分组" }).selectOption({ label: "开发工具" });
  assert.equal(await dialog.getByRole("region", { name: "移到 开发工具" }).locator(".ai-row").count(), 26);
  assert.equal(await applyButton.innerText(), "应用 30 项");
  assert.equal(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth), true);
  await page.screenshot({ path: artifactPath("review-desktop.png") });
  await applyButton.click();
  await page.locator(".manage-toast.visible", { hasText: "已整理 30 项" }).waitFor({ timeout: 30000 });
  assert.equal(await dialog.count(), 0);

  const smartHomeGroup = groupByName("github", "智能家居");
  const mediaGroup = groupByName("github", "影音娱乐");
  assert.ok(smartHomeGroup && mediaGroup, "应新建两个分组");
  assert.equal(starByName("home-assistant/core").group_id, smartHomeGroup.id);
  assert.equal(starByName("esphome/esphome").group_id, smartHomeGroup.id);
  assert.equal(starByName("jellyfin/jellyfin").group_id, mediaGroup.id);
  assert.equal(starByName("ollama/ollama").group_id, starGroups.ai.id);
  assert.equal(starByName("excalidraw/excalidraw").group_id, starGroups.design.id);
  assert.equal(starByName("someone/mystery").group_id, starGroups.tools.id);
  assert.equal(starByName("tool-03/cli-03").group_id, null);
  const toolOrders = tables.github_stars.filter((row) => row.group_id === starGroups.tools.id).map((row) => row.sort_order).sort((a, b) => a - b);
  assert.deepEqual(toolOrders, toolOrders.map((_, index) => index), "目标分组的排序应连续");
  assert.equal(await sectionCount("智能家居").innerText(), "2");
  assert.equal(await sectionCount("未分组").innerText(), "1");
  await page.screenshot({ path: artifactPath("applied-desktop.png") });
  console.log("PASS: 应用时新建分组并批量移动，页面与数据库一致，未勾选的保持原样");

  await page.getByRole("button", { name: "撤销" }).click();
  await page.locator(".manage-toast.visible", { hasText: "已撤销" }).waitFor({ timeout: 30000 });
  assert.equal(groupByName("github", "智能家居"), undefined, "撤销后应删除 AI 新建的空分组");
  assert.equal(groupByName("github", "影音娱乐"), undefined);
  assert.ok(ungroupedStars.every((row) => row.group_id === null), "撤销后条目应回到未分组");
  const restoredOrder = [...ungroupedStars].sort((left, right) => left.sort_order - right.sort_order).map((row) => row.id);
  assert.deepEqual(restoredOrder, originalUngroupedOrder);
  assert.equal(await sectionCount("未分组").innerText(), "31");
  const uiOrder = await page.locator("#group-ungrouped .repo-name").allInnerTexts();
  assert.deepEqual(uiOrder.slice(0, 6), ["ollama", "biome", "excalidraw", "core", "mystery", "jellyfin"]);
  console.log("PASS: 撤销把条目放回原分组和原顺序，并删除 AI 新建的分组");

  // ---------- 手机宽度下的审阅布局 ----------
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "AI 整理" }).click();
  await dialog.getByRole("button", { name: "开始分析" }).click();
  await applyButton.waitFor({ timeout: 90000 });
  assert.equal(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth), true);
  const select = await dialog.locator(".ai-row-target").first().boundingBox();
  assert.ok(select && select.width > 200, "手机上目标分组选择框应换到第二行并占满宽度");
  await page.screenshot({ path: artifactPath("review-mobile.png") });
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  console.log("PASS: 手机宽度下审阅列表没有横向溢出");

  // ---------- 书签：接口报错与勾选范围 ----------
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(base);
  await page.getByRole("button", { name: "管理", exact: true }).click({ timeout: 60000 });
  await page.getByRole("button", { name: "AI 整理" }).click();
  assert.ok(await dialog.getByRole("radio", { name: /全部 5 项/ }).isChecked());
  failNextStatus = 401;
  await dialog.getByRole("button", { name: "开始分析" }).click();
  await dialog.getByRole("alert").filter({ hasText: "AI 接口密钥无效，请检查 AI_API_KEY" }).waitFor({ timeout: 60000 });
  assert.ok(await dialog.getByRole("button", { name: "开始分析" }).isVisible());
  await page.keyboard.press("Escape");
  console.log("PASS: 密钥错误不重试，直接提示需要检查的配置");

  for (const title of ["Figma", "Hacker News"]) {
    await page.locator(".bookmark-card", { hasText: title }).locator(".card-select input").check();
  }
  await page.getByRole("button", { name: "AI 整理" }).click();
  assert.ok(await dialog.getByRole("radio", { name: /已选的 2 项/ }).isChecked());
  await dialog.getByRole("button", { name: "开始分析" }).click();
  await applyButton.waitFor({ timeout: 60000 });
  assert.equal(await applyButton.innerText(), "应用 2 项");
  await page.screenshot({ path: artifactPath("bookmarks-review.png") });
  await applyButton.click();
  await page.locator(".manage-toast.visible", { hasText: "已整理 2 项" }).waitFor({ timeout: 30000 });
  const figma = tables.bookmarks.find((row) => row.title === "Figma");
  const news = tables.bookmarks.find((row) => row.title === "Hacker News");
  assert.equal(figma.group_id, bookmarkGroups.design.id);
  assert.equal(news.group_id, bookmarkGroups.reading.id);
  console.log("PASS: 书签按勾选范围整理并保存");

  assert.deepEqual(aiProblems, []);
  assert.deepEqual(browserErrors, []);
  console.log(`PASS: 共 ${aiRequests.length} 次 AI 请求，参数均符合 ${expected.label.split(" · ")[0]} 渠道要求，浏览器无报错`);
} catch (error) {
  console.error(error.stack || error.message);
  if (page) console.error("Browser text:", (await page.locator("body").innerText().catch(() => "")).slice(0, 2400));
  console.error("Browser errors:", browserErrors.slice(-10));
  console.error("AI problems:", aiProblems);
  console.error("Database log:", dbLog.slice(-25));
  console.error(logs.split("\n").slice(-40).join("\n"));
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (process.platform === "win32" && server.exitCode === null) {
    spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  } else {
    server.kill();
  }
  await new Promise((done) => {
    if (server.exitCode !== null) done();
    else server.once("exit", done);
  });
  for (const fake of [db, ai]) {
    fake.closeAllConnections();
    await new Promise((done) => fake.close(done));
  }
  const target = resolve(workspace);
  const within = relative(resolve(tempRoot), target);
  if (!within.startsWith("..") && !within.includes(":") && basename(target).startsWith("ai-smoke-")) {
    await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}
