import assert from "node:assert/strict";
import { test } from "node:test";
import "./register-alias.mjs";

const { buildPlanPrompt, parsePlanResult } = await import("../src/lib/ai-plan.ts");

const star = (id, fullName, extra = {}) => ({
  id, githubRepoId: 1, groupId: null, fullName, displayName: null, htmlUrl: `https://github.com/${fullName}`,
  description: null, language: null, topics: [], starsCount: 1, ownerAvatarUrl: null, tags: [], note: null,
  sortOrder: 0, isPublic: true, isActive: true, starredAt: null, syncedAt: null, repoUpdatedAt: null, ...extra
});

const groups = () => [
  { id: "tools", kind: "github", name: "开发工具", sortOrder: 0, isPublic: true, items: [
    star("vite", "vitejs/vite", { groupId: "tools", description: "Next generation frontend tooling" })
  ] },
  { id: "ungrouped", kind: "github", name: "未分组", sortOrder: 9999, isPublic: true, items: [
    star("ha", "home-assistant/core", { description: "Open source home automation", note: "开源家庭自动化平台", topics: ["iot", "home-automation"] }),
    star("esp", "esphome/esphome", { description: "Control your microcontrollers" })
  ] }
];

test("plan prompt lists existing groups and one compact line per item", () => {
  const prompt = buildPlanPrompt("github", groups(), ["ha", "esp", "missing"]);
  assert.equal(prompt.itemCount, 2);
  assert.deepEqual(prompt.existingNames, ["开发工具"]);
  const [system, user] = prompt.messages.map((message) => message.content);
  assert.match(system, /最多提议 5 个新分组/);
  assert.match(system, /json/);
  // 优先用中文备注描述条目
  assert.match(user, /home-assistant\/core：开源家庭自动化平台 \[iot, home-automation\]/);
  assert.match(user, /esphome\/esphome：Control your microcontrollers/);
  assert.match(user, /"examples":\["vitejs\/vite：Next generation frontend tooling"\]/);
  assert.doesNotMatch(user, /未分组/);
});

test("plan results drop duplicates, existing names and extras", () => {
  const plan = parsePlanResult({ groups: [
    { name: "「智能家居」", description: "家庭自动化和智能设备", count: 2 },
    { name: "智能 家居", description: "重复", count: 1 },
    { name: "开发工具", description: "和现有分组重名", count: 3 },
    { name: "", description: "空名", count: 1 },
    { name: "未分组", description: "保留名称", count: 1 },
    { name: "影音", description: "家庭影音", count: "3" },
    { name: "A", description: "", count: -1 },
    { name: "B", description: "", count: 1 },
    { name: "C", description: "", count: 1 },
    { name: "D", description: "", count: 1 }
  ] }, ["开发工具"]);
  assert.deepEqual(plan.map((group) => group.name), ["智能家居", "影音", "A", "B", "C"]);
  assert.deepEqual(plan[0], { name: "智能家居", description: "家庭自动化和智能设备", count: 2 });
  assert.equal(plan[1].count, 3);
  assert.equal(plan[2].count, 0);
  assert.throws(() => parsePlanResult({ answer: "好的" }, []), /格式不正确/);
});
