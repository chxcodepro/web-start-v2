import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAnalyzePrompt, buildTranslatePrompt, cleanNote, isMostlyChinese, needsChineseNote, parseAnalyzeResult, parseTranslateResult, readmeExcerpt } from "../src/lib/star-notes.ts";

test("only untouched English descriptions get a Chinese note", () => {
  assert.equal(needsChineseNote({ description: "The React Framework", note: null }), true);
  assert.equal(needsChineseNote({ description: "The React Framework", note: "" }), true);
  // 旧版编辑框会把简介原样存成备注，这种也算没写过
  assert.equal(needsChineseNote({ description: "The React Framework", note: " The React Framework " }), true);
  assert.equal(needsChineseNote({ description: "The React Framework", note: "我自己写的备注" }), false);
  assert.equal(needsChineseNote({ description: "基于 React 的框架", note: null }), false);
  assert.equal(needsChineseNote({ description: null, note: null }), false);
  assert.equal(isMostlyChinese("A fast bundler for 前端"), false);
  assert.equal(isMostlyChinese("基于 React 的静态站点生成器"), true);
});

test("translate prompt numbers repositories and results map back to ids", () => {
  const prompt = buildTranslatePrompt([
    { id: "a", fullName: "vercel/next.js", description: "The React Framework", note: null, topics: ["react", "nextjs"] },
    { id: "b", fullName: "biomejs/biome", description: "A toolchain for web projects", note: null }
  ]);
  assert.deepEqual([...prompt.itemIds], [[1, "a"], [2, "b"]]);
  assert.match(prompt.messages[0].content, /json/);
  assert.match(prompt.messages[1].content, /"repo":"vercel\/next.js","description":"The React Framework","topics":\["react","nextjs"\]/);
  const notes = parseTranslateResult({ results: [
    { n: 1, text: "「基于 React 的全栈 Web 框架」" },
    { n: 1, text: "重复的应忽略" },
    { n: 2, text: "   " },
    { n: 9, text: "不存在的编号" }
  ] }, prompt);
  assert.deepEqual([...notes], [["a", "基于 React 的全栈 Web 框架"]]);
  assert.throws(() => parseTranslateResult({ answer: "好的" }, prompt), /格式不正确/);
});

test("analyze prompt uses a cleaned README excerpt and returns a cleaned note", () => {
  const readme = readmeExcerpt([
    "# Biome",
    "",
    "![badge](https://img.shields.io/x)",
    "[![CI](https://x/badge.svg)](https://x)",
    "",
    "Biome is a [toolchain](https://biomejs.dev) for web projects.",
    "",
    "```bash",
    "npm i -D @biomejs/biome",
    "```",
    '<p align="center">Fast</p>'
  ].join("\n"));
  assert.equal(readme, "# Biome\nBiome is a toolchain for web projects.\nFast");
  const messages = buildAnalyzePrompt({ id: "b", fullName: "biomejs/biome", description: "A toolchain for web projects", note: null, topics: ["linter"], language: "Rust" }, readme);
  assert.match(messages[0].content, /不超过 60 个字/);
  assert.match(messages[1].content, /^仓库：biomejs\/biome\nGitHub 简介：A toolchain for web projects\n主要语言：Rust\ntopics：linter\n\nREADME 摘录：\n# Biome/);
  assert.equal(parseAnalyzeResult({ note: " “一站式的 Web 项目格式化和检查工具” " }), "一站式的 Web 项目格式化和检查工具");
  assert.throws(() => parseAnalyzeResult({ note: "" }), /没有给出备注/);
  assert.equal(cleanNote("x".repeat(100)).length, 80);
});
