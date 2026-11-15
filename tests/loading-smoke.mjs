import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { cp, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = new URL("../", import.meta.url);
const artifactPath = (name) => fileURLToPath(new URL(`../artifacts/loading-recovery/${name}`, import.meta.url));
const tempRoot = fileURLToPath(new URL("../artifacts/tmp/", import.meta.url));
await mkdir(tempRoot, { recursive: true });
const workspace = await mkdtemp(join(tempRoot, "loading-smoke-"));
for (const name of ["src", "next.config.ts", "tsconfig.json", "package.json", "postcss.config.mjs"]) {
  await cp(new URL(name, root), join(workspace, name), { recursive: true });
}
await symlink(fileURLToPath(new URL("node_modules", root)), join(workspace, "node_modules"), "junction");
const port = Number(process.env.SMOKE_PORT || 3197);
const base = `http://localhost:${port}`;
const counts = new Map();
let unavailable = true;
let transientStars = false;
const db = createServer((request, response) => {
  const url = new URL(request.url, "http://localhost");
  const resource = url.pathname.endsWith("/groups")
    ? url.searchParams.get("kind") === "eq.github" ? "star-groups" : "bookmark-groups"
    : url.pathname.split("/").at(-1);
  counts.set(resource, (counts.get(resource) || 0) + 1);
  assert.equal(request.headers.apikey, "sb_secret_smoke_test");
  assert.equal(request.headers.authorization, undefined);
  assert.equal(url.searchParams.get("is_public"), "eq.true");
  response.setHeader("Content-Type", "application/json");
  if (unavailable || transientStars && counts.get(resource) === 1) {
    response.writeHead(503);
    response.end(JSON.stringify({ message: "Injected temporary failure" }));
    return;
  }
  const groupId = resource === "star-groups" ? "star-group" : "bookmark-group";
  const rows = resource.endsWith("groups") ? [{
    id: groupId, kind: resource === "star-groups" ? "github" : "bookmark",
    name: resource === "star-groups" ? "测试 Star" : "测试书签",
    sort_order: 0, is_public: true
  }] : resource === "bookmarks" ? [{
    id: "bookmark", group_id: "bookmark-group", title: "恢复成功",
    url: "https://example.com/", sort_order: 0, is_public: true, tags: []
  }] : [];
  response.end(JSON.stringify(rows));
});
await new Promise((resolve) => db.listen(0, "127.0.0.1", resolve));
let logs = "";
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--port", String(port)], {
  cwd: workspace,
  windowsHide: true,
  env: {
    ...process.env,
    SUPABASE_URL: `http://127.0.0.1:${db.address().port}`,
    SUPABASE_SERVICE_ROLE_KEY: "sb_secret_smoke_test",
    AUTH_SECRET: "smoke-test-secret-not-a-production-secret",
    AUTH_GITHUB_ID: "smoke-test",
    AUTH_GITHUB_SECRET: "smoke-test",
    GITHUB_OWNER_LOGIN: "smoke-test"
  },
  stdio: ["ignore", "pipe", "pipe"]
});
server.stdout.on("data", (chunk) => { logs += chunk; });
server.stderr.on("data", (chunk) => { logs += chunk; });
let browser;
let page;
const browserErrors = [];
try {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${base}/clipboard`, { signal: AbortSignal.timeout(2000) });
      if (response.ok) break;
    } catch {}
    if (attempt === 59) throw new Error("Smoke server did not start");
    await delay(500);
  }
  browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || "chrome" });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await context.newPage();
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("requestfailed", (request) => browserErrors.push(`${request.url()} ${request.failure()?.errorText}`));
  let upstream;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    upstream = await page.request.get(`${base}/api/background`);
    if (upstream.ok()) break;
    assert.equal(upstream.status(), 502);
    assert.equal(upstream.headers()["cache-control"], "no-store");
  }
  const image = upstream.ok() ? await upstream.body()
    : Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
  const imageType = upstream.ok() ? upstream.headers()["content-type"] : "image/png";
  if (upstream.ok()) {
    assert.match(imageType, /^image\//);
    assert.match(upstream.headers()["cache-control"], /stale-if-error/);
    console.log("PASS: real background endpoint follows upstream redirects and returns a cacheable image");
  } else {
    console.log("PASS: upstream outage returns uncached 502; remaining browser scenarios use a PNG fixture");
  }

  let imageRequests = 0;
  await page.route("**/api/background", (route) => {
    imageRequests += 1;
    return imageRequests === 1
      ? route.fulfill({ status: 200, contentType: "image/webp", body: "not an image" })
      : imageRequests === 2
        ? route.fulfill({ status: 502, contentType: "application/json", body: "{}" })
        : route.fulfill({ status: 200, contentType: imageType, body: image });
  });
  // 搜索补全依赖外部服务，测试中固定为空结果
  await page.route("**/api/search/suggestions**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: '{"suggestions":[]}' }));
  await page.goto(base);
  const loadingState = page.locator('.collection-skeleton[aria-busy="true"]');
  await loadingState.waitFor();
  await page.waitForFunction(() => document.body.style.getPropertyValue("--background-image").includes("blob:"));
  assert.equal(imageRequests, 3);
  assert.ok(await page.locator('a[href="/stars"]').isVisible());
  const search = page.locator("#search-query");
  await search.fill("恢复");
  for (let attempt = 0; attempt < 150 && (counts.get("bookmarks") || 0) < 9; attempt += 1) await delay(100);
  assert.ok(counts.get("bookmarks") >= 9, `expected silent refreshes, saw ${counts.get("bookmarks")} bookmark reads`);
  await page.getByText("数据加载较慢，请稍候…").waitFor({ timeout: 15000 });
  assert.ok(await loadingState.isVisible());
  assert.equal(await page.getByText("暂时无法加载页面").count(), 0);
  assert.equal(await page.getByRole("button", { name: /重试|重新加载/ }).count(), 0);
  await mkdir(new URL("../artifacts/loading-recovery/", import.meta.url), { recursive: true });
  await page.screenshot({ path: artifactPath("pending-desktop.png") });
  console.log("PASS: damaged/failed backgrounds retry; database failures keep navigation, a usable search box and a loading skeleton while refreshing silently");

  unavailable = false;
  await page.locator(".bookmark-card .card-title-text", { hasText: "恢复成功" }).waitFor({ timeout: 30000 });
  assert.equal(await loadingState.count(), 0);
  assert.equal(await search.inputValue(), "恢复");
  await page.locator(".suggestion-item", { hasText: "恢复成功" }).waitFor();
  await search.press("Escape");
  const cached = await page.evaluate(async () => {
    const response = await (await caches.open("start-page-background-v1")).match("/api/background");
    return response?.headers.get("content-type");
  });
  assert.equal(cached, imageType);
  console.log("PASS: data renders automatically once available, typed search text survives refreshes, bookmarks join local suggestions, and opaque API key handling and public query filtering are preserved");

  transientStars = true;
  await page.locator('a[href="/stars"]').click();
  await page.waitForFunction(() => document.body.innerText.includes("测试 Star"));
  assert.equal(counts.get("star-groups"), 2);
  assert.equal(counts.get("github_stars"), 2);
  console.log("PASS: transient collection errors recover inside the read transport without an error screen");

  await page.unroute("**/api/background");
  let failedImages = 0;
  await page.route("**/api/background", (route) => {
    failedImages += 1;
    return route.fulfill({ status: 502, body: "{}" });
  });
  await page.reload();
  await page.waitForFunction(() => document.body.style.getPropertyValue("--background-image").includes("blob:"));
  await page.waitForFunction(() => document.body.innerText.includes("测试 Star"));
  for (let i = 0; i < 60 && failedImages < 3; i += 1) await delay(100);
  assert.equal(failedImages, 3);
  await delay(1000);
  assert.equal(failedImages, 3);
  console.log("PASS: upstream failure after reload retains the previous decoded image and stops after three attempts");

  await page.screenshot({ path: artifactPath("desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: artifactPath("mobile.png"), fullPage: true });
  console.log("PASS: desktop/mobile content renders without horizontal overflow");

  const restricted = await browser.newContext();
  await restricted.addInitScript(() => {
    Object.defineProperty(globalThis, "caches", { get() { throw new Error("Storage denied"); } });
  });
  const restrictedPage = await restricted.newPage();
  await restrictedPage.route("**/api/background", (route) => route.fulfill({ status: 200, contentType: imageType, body: image }));
  await restrictedPage.goto(base);
  await restrictedPage.getByText("恢复成功", { exact: true }).waitFor();
  await restrictedPage.waitForFunction(() => document.body.style.getPropertyValue("--background-image").includes("blob:"));
  console.log("PASS: unavailable browser storage does not prevent background or page loading");

  // 数据流中途断开：截断一次客户端导航的 RSC 响应，错误边界应保持骨架屏并静默恢复
  const interrupted = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const interruptedPage = await interrupted.newPage();
  interruptedPage.on("pageerror", (error) => browserErrors.push(error.message));
  await interruptedPage.route("**/api/background", (route) => route.fulfill({ status: 200, contentType: imageType, body: image }));
  await interruptedPage.goto(`${base}/stars`);
  await interruptedPage.waitForFunction(() => document.body.innerText.includes("测试 Star"));
  let documentLoads = 0;
  let truncatedFlights = 0;
  await interruptedPage.route((url) => url.pathname === "/", async (route) => {
    const request = route.request();
    const headers = request.headers();
    if (request.resourceType() === "document") documentLoads += 1;
    if (truncatedFlights || !headers.rsc || headers["next-router-prefetch"]) return route.continue();
    const response = await route.fetch();
    const flight = await response.text();
    const cut = flight.lastIndexOf("\n", flight.indexOf("恢复成功"));
    assert.ok(cut > 0, "flight payload should stream the bookmark rows after the page shell");
    truncatedFlights += 1;
    return route.fulfill({ response, body: flight.slice(0, cut + 1) });
  });
  await interruptedPage.locator('a[href="/"]').click();
  await interruptedPage.locator(".bookmark-card .card-title-text", { hasText: "恢复成功" }).waitFor({ timeout: 30000 });
  assert.equal(truncatedFlights, 1);
  assert.equal(documentLoads, 0);
  assert.equal(await interruptedPage.getByText("暂时无法加载页面").count(), 0);
  console.log("PASS: an interrupted Server Component stream recovers silently through the error boundary without a full reload");
} catch (error) {
  console.error(error.message);
  if (page) console.error("Browser text:", (await page.locator("body").innerText()).slice(0, 2400));
  console.error("Browser errors:", browserErrors.slice(-10));
  console.error("Database counts:", Object.fromEntries(counts));
  console.error(logs.split("\n").slice(-35).join("\n"));
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (process.platform === "win32" && server.exitCode === null) {
    spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  } else {
    server.kill();
  }
  await new Promise((resolve) => {
    if (server.exitCode !== null) resolve();
    else server.once("exit", resolve);
  });
  db.closeAllConnections();
  await new Promise((resolve) => db.close(resolve));
  const target = resolve(workspace);
  const within = relative(resolve(tempRoot), target);
  if (!within.startsWith("..") && !within.includes(":") && basename(target).startsWith("loading-smoke-")) {
    await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}
