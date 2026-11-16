import assert from "node:assert/strict";
import { test } from "node:test";
import "./register-alias.mjs";

const { buildClassifyPrompt, classifySchema, parseClassifyResult } = await import("../src/lib/ai-classify.ts");
const { groupNameKey, normalizeGroupName } = await import("../src/lib/group-name.ts");

const star = (id, fullName, extra = {}) => ({
  id, githubRepoId: 1, groupId: null, fullName, displayName: null, htmlUrl: `https://github.com/${fullName}`,
  description: null, language: null, topics: [], starsCount: 1, ownerAvatarUrl: null, tags: [], note: null,
  sortOrder: 0, isPublic: true, isActive: true, starredAt: null, syncedAt: null, repoUpdatedAt: null, ...extra
});

const starGroups = () => [
  { id: "tools", kind: "github", name: "开发工具", sortOrder: 0, isPublic: true, items: [
    star("next", "vercel/next.js", { groupId: "tools", description: "The React Framework" }),
    star("vite", "vitejs/vite", { groupId: "tools" })
  ] },
  { id: "ai", kind: "github", name: "AI 应用", sortOrder: 1, isPublic: true, items: [] },
  { id: "ungrouped", kind: "github", name: "未分组", sortOrder: 9999, isPublic: true, items: [
    star("ollama", "ollama/ollama", { description: "Run LLMs locally", language: "Go", topics: ["llm", "self-hosted"] }),
    star("biome", "biomejs/biome", { language: "Rust" })
  ] }
];

const userPayload = (prompt) => prompt.messages[1].content;

test("prompt numbers items in request order and exposes only short group keys", () => {
  const prompt = buildClassifyPrompt("github", starGroups(), ["biome", "ollama", "missing"]);
  assert.deepEqual([...prompt.itemIds], [[1, "biome"], [2, "ollama"]]);
  assert.deepEqual([...prompt.groupKeys], [["g1", { id: "tools", name: "开发工具" }], ["g2", { id: "ai", name: "AI 应用" }]]);
  assert.equal(prompt.currentGroups.get("ollama"), "ungrouped");
  const payload = userPayload(prompt);
  assert.match(payload, /"repo":"ollama\/ollama"/);
  assert.match(payload, /"topics":\["llm","self-hosted"\]/);
  assert.match(payload, /"current":null/);
  assert.match(payload, /vercel\/next\.js：The React Framework/);
  assert.doesNotMatch(payload, /"id"|ungrouped/);
  assert.match(prompt.messages[0].content, /json/);
});

test("prompt only offers existing groups, including empty ones", () => {
  const [system, payload] = buildClassifyPrompt("github", starGroups(), ["ollama"]).messages.map((message) => message.content);
  assert.match(system, /只能从分组列表里选/);
  assert.match(system, /不要新建分组/);
  assert.doesNotMatch(system + payload, /newGroup|已提议/);
  // 空分组也列出来：用户可以先建好分组，再让 AI 把条目放进去
  const catalog = JSON.parse(payload.split("\n")[1]);
  assert.deepEqual(catalog[1], { key: "g2", name: "AI 应用", count: 0, examples: [] });
  const fields = classifySchema.properties.results.items;
  assert.deepEqual(fields.required, ["n", "group", "confidence", "reason"]);
  assert.equal("newGroup" in fields.properties, false);
});

test("examples skip items that are being classified", () => {
  const prompt = buildClassifyPrompt("github", starGroups(), ["next"]);
  const catalog = JSON.parse(userPayload(prompt).split("\n")[1]);
  assert.deepEqual(catalog[0].examples, ["vitejs/vite"]);
  assert.equal(catalog[0].count, 2);
});

test("bookmark prompts describe the site instead of the full URL noise", () => {
  const groups = [{ id: "daily", kind: "bookmark", name: "日常使用", sortOrder: 0, isPublic: true, items: [
    { id: "gh", groupId: "daily", title: "GitHub", url: "https://www.github.com/", description: "代码托管", faviconUrl: null, tags: ["开发"], sortOrder: 0, isPublic: true },
    { id: "docs", groupId: "daily", title: "MDN", url: "https://developer.mozilla.org/zh-CN/docs/Web", description: null, faviconUrl: null, tags: [], sortOrder: 1, isPublic: true }
  ] }];
  const payload = userPayload(buildClassifyPrompt("bookmark", groups, ["docs"]));
  assert.match(payload, /"site":"developer\.mozilla\.org\/zh-CN\/docs\/Web"/);
  assert.match(payload, /GitHub（github\.com）/);
  assert.match(payload, /"current":"g1"/);
});

test("results map group keys and names back to real ids", () => {
  const prompt = buildClassifyPrompt("github", starGroups(), ["ollama", "biome", "next", "vite"]);
  const result = parseClassifyResult({ results: [
    { n: 1, group: "g2", confidence: "high", reason: "本地运行大模型" },
    { n: 2, group: "开发工具", confidence: "medium", reason: "代码格式化" },
    { n: "3", group: "g1", confidence: "certain", reason: "框架" },
    { n: 3, group: "g2", confidence: "high", reason: "重复结果应忽略" },
    { n: 9, group: "g1", confidence: "high", reason: "不存在的编号" },
    { n: 4, group: "「ai应用」", confidence: "high", reason: "分组名写法不同" },
    { group: "g1" }
  ] }, prompt);
  const byId = Object.fromEntries(result.suggestions.map((item) => [item.id, item]));
  assert.deepEqual(byId.ollama, { id: "ollama", groupId: "ai", confidence: "high", reason: "本地运行大模型" });
  assert.equal(byId.biome.groupId, "tools");
  assert.equal(byId.next.groupId, "tools");
  assert.equal(byId.next.confidence, "low");
  assert.equal(byId.vite.groupId, "ai");
  assert.equal(result.suggestions.length, 4);
  assert.deepEqual(result.missing, []);
});

test("made-up groups, unsure or missing answers keep items where they are", () => {
  const prompt = buildClassifyPrompt("github", starGroups(), ["ollama", "biome", "next"]);
  const result = parseClassifyResult([
    // 模型编造了分组名，还带着旧格式的 newGroup 字段
    { n: 1, group: "本地部署", newGroup: "本地部署", confidence: "high", reason: "本地运行大模型" },
    { n: 3, group: null, confidence: "high", reason: "" }
  ], prompt);
  assert.deepEqual(result.suggestions, [
    { id: "ollama", groupId: "ungrouped", confidence: "low", reason: "本地运行大模型" },
    { id: "next", groupId: "tools", confidence: "low", reason: "没有合适的分组" }
  ]);
  assert.deepEqual(result.missing, ["biome"]);
  assert.throws(() => parseClassifyResult({ answer: "好的" }, prompt), /格式不正确/);
});

test("confirmed new groups join the closed list and map to new: ids", () => {
  const prompt = buildClassifyPrompt("github", starGroups(), ["ollama", "biome"], [
    { name: "「本地 部署」", description: "本地运行的大模型工具" },
    { name: "开发工具" },
    { name: "本地部署" }
  ]);
  // 和现有分组重名、彼此重复的新分组被去掉
  assert.deepEqual([...prompt.groupKeys].slice(2), [["n1", { id: "new:本地 部署", name: "本地 部署" }]]);
  const [system, payload] = prompt.messages.map((message) => message.content);
  assert.match(system, /new 为 true/);
  const catalog = JSON.parse(payload.split("\n")[1]);
  assert.deepEqual(catalog.at(-1), { key: "n1", name: "本地 部署", new: true, description: "本地运行的大模型工具", count: 0, examples: [] });
  const result = parseClassifyResult({ results: [
    { n: 1, group: "n1", confidence: "high", reason: "本地运行大模型" },
    { n: 2, group: "本地部署", confidence: "medium", reason: "按名称也能识别" }
  ] }, prompt);
  assert.deepEqual(result.suggestions.map((item) => item.groupId), ["new:本地 部署", "new:本地 部署"]);
});

test("group names are compared without spaces, quotes or case", () => {
  assert.equal(normalizeGroupName("  “AI   工具” "), "AI 工具");
  assert.equal(groupNameKey("  “AI   工具” "), "ai工具");
  assert.equal(groupNameKey("「AI 工具」"), groupNameKey("ai工具"));
  assert.notEqual(groupNameKey("AI 工具"), groupNameKey("AI 应用"));
});
