import assert from "node:assert/strict";
import { test } from "node:test";
import { buildClassifyPrompt, groupNameKey, normalizeGroupName, parseClassifyResult } from "../src/lib/ai-classify.ts";

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
  const prompt = buildClassifyPrompt("github", starGroups(), ["biome", "ollama", "missing"], ["本地 部署", "开发工具", "本地部署"]);
  assert.deepEqual([...prompt.itemIds], [[1, "biome"], [2, "ollama"]]);
  assert.deepEqual([...prompt.groupKeys], [["g1", { id: "tools", name: "开发工具" }], ["g2", { id: "ai", name: "AI 应用" }]]);
  assert.equal(prompt.currentGroups.get("ollama"), "ungrouped");
  // 已有分组同名、重复的提议会被去掉
  assert.deepEqual(prompt.proposedGroups, ["本地 部署"]);
  const payload = userPayload(prompt);
  assert.match(payload, /"repo":"ollama\/ollama"/);
  assert.match(payload, /"topics":\["llm","self-hosted"\]/);
  assert.match(payload, /"current":null/);
  assert.match(payload, /vercel\/next\.js：The React Framework/);
  assert.doesNotMatch(payload, /"id"|ungrouped/);
  assert.match(prompt.messages[0].content, /json/);
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

test("results map keys, names and proposals back to real ids", () => {
  const prompt = buildClassifyPrompt("github", starGroups(), ["ollama", "biome", "next", "vite"], ["本地部署"]);
  const result = parseClassifyResult({ results: [
    { n: 1, group: null, newGroup: "「本地 部署」", confidence: "high", reason: "本地运行大模型" },
    { n: 2, group: "开发工具", newGroup: null, confidence: "medium", reason: "代码格式化" },
    { n: "3", group: "g1", confidence: "certain", reason: "框架" },
    { n: 3, group: "g2", confidence: "high", reason: "重复结果应忽略" },
    { n: 9, group: "g1", confidence: "high", reason: "不存在的编号" },
    { n: 4, group: null, newGroup: "ai应用", confidence: "high", reason: "新分组与已有同名" },
    { group: "g1" }
  ] }, prompt);
  const byId = Object.fromEntries(result.suggestions.map((item) => [item.id, item]));
  assert.deepEqual(byId.ollama, { id: "ollama", groupId: null, newGroup: "本地部署", newGroupKey: "本地部署", confidence: "high", reason: "本地运行大模型" });
  assert.equal(byId.biome.groupId, "tools");
  assert.equal(byId.next.groupId, "tools");
  assert.equal(byId.next.confidence, "low");
  assert.equal(byId.vite.groupId, "ai");
  assert.equal(result.suggestions.length, 4);
  assert.deepEqual(result.missing, []);
});

test("unsure or missing answers keep items where they are", () => {
  const prompt = buildClassifyPrompt("github", starGroups(), ["ollama", "biome"]);
  const result = parseClassifyResult([{ n: 1, group: null, newGroup: null, confidence: "high", reason: "" }], prompt);
  assert.deepEqual(result.suggestions, [{ id: "ollama", groupId: "ungrouped", newGroup: null, newGroupKey: null, confidence: "low", reason: "无法判断" }]);
  assert.deepEqual(result.missing, ["biome"]);
  assert.throws(() => parseClassifyResult({ answer: "好的" }, prompt), /格式不正确/);
});

test("group names are compared without spaces, quotes or case", () => {
  assert.equal(normalizeGroupName("  “AI   工具” "), "AI 工具");
  assert.equal(groupNameKey("AI 工具"), groupNameKey("ai工具"));
  assert.equal(normalizeGroupName("一个非常非常非常非常非常非常长的分组名称超过二十个字"), "一个非常非常非常非常非常非常长的分组名称");
});
