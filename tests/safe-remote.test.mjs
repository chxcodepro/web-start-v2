import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchPublicUrl, readLimited } from "../src/lib/safe-remote.ts";

test("follows a public 302 and resolves relative locations", async (t) => {
  const urls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    urls.push(String(url));
    assert.equal(init.redirect, "manual");
    return urls.length === 1
      ? new Response(null, { status: 302, headers: { Location: "/image.webp" } })
      : new Response("image", { headers: { "Content-Type": "image/webp" } });
  });
  const { response, url } = await fetchPublicUrl("https://8.8.8.8/random", {});
  assert.equal(response.status, 200);
  assert.equal(url.toString(), "https://8.8.8.8/image.webp");
  assert.equal(urls.length, 2);
});

test("rejects redirects into private networks", async (t) => {
  const mock = t.mock.method(globalThis, "fetch", async () =>
    new Response(null, { status: 302, headers: { Location: "http://127.0.0.1/private" } }));
  await assert.rejects(fetchPublicUrl("https://8.8.8.8/random", {}), /私有网络/);
  assert.equal(mock.mock.callCount(), 1);
});

test("bounds redirect loops and cancels redirect bodies", async (t) => {
  let cancelled = 0;
  const mock = t.mock.method(globalThis, "fetch", async () =>
    new Response(new ReadableStream({ cancel() { cancelled += 1; } }), {
      status: 302, headers: { Location: "/loop" }
    }));
  await assert.rejects(fetchPublicUrl("https://8.8.8.8/loop", {}), /重定向过多/);
  assert.equal(mock.mock.callCount(), 4);
  assert.equal(cancelled, 4);
});

test("304 is not mistaken for a redirect", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 304 }));
  const { response } = await fetchPublicUrl("https://8.8.8.8/image", {});
  assert.equal(response.status, 304);
});

test("enforces declared and streamed response size limits", async () => {
  await assert.rejects(readLimited(new Response("12345", { headers: { "Content-Length": "5" } }), 4), /内容过大/);
  await assert.rejects(readLimited(new Response("12345"), 4), /内容过大/);
  assert.equal(new TextDecoder().decode(await readLimited(new Response("1234"), 4)), "1234");
});
