import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchWithRetry } from "../src/lib/retry-fetch.ts";

const options = { attempts: 3, timeoutMs: 100, delayMs: 1 };

test("retries transient read status codes", async (t) => {
  for (const status of [408, 429, 500, 502, 503, 504]) {
    let calls = 0;
    const mock = t.mock.method(globalThis, "fetch", async () =>
      ++calls < 3 ? new Response("temporary", { status }) : Response.json({ ok: true }));
    const response = await fetchWithRetry("https://example.com/data", undefined, options);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(calls, 3);
    mock.mock.restore();
  }
});

test("retries network failure and truncated read bodies", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    if (calls === 1) throw new TypeError("fetch failed");
    if (calls === 2) return new Response(new ReadableStream({
      start(controller) { controller.error(new Error("truncated body")); }
    }));
    return Response.json(["recovered"]);
  });
  assert.deepEqual(await (await fetchWithRetry("https://example.com/data", undefined, options)).json(), ["recovered"]);
  assert.equal(calls, 3);
});

test("does not retry permanent client errors", async (t) => {
  for (const status of [400, 401, 403, 404]) {
    const mock = t.mock.method(globalThis, "fetch", async () => new Response("invalid", { status }));
    assert.equal((await fetchWithRetry("https://example.com/data", undefined, options)).status, status);
    assert.equal(mock.mock.callCount(), 1);
    mock.mock.restore();
  }
});

test("returns the final failed response without an unbounded retry loop", async (t) => {
  const mock = t.mock.method(globalThis, "fetch", async () => new Response("unavailable", { status: 503 }));
  const response = await fetchWithRetry("https://example.com/data", undefined, options);
  assert.equal(await response.text(), "unavailable");
  assert.equal(mock.mock.callCount(), 3);
});

test("does not replay mutation requests", async (t) => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const mock = t.mock.method(globalThis, "fetch", async () => { throw new TypeError("lost response after commit"); });
    await assert.rejects(fetchWithRetry("https://example.com/data", { method, body: "{}" }, options));
    assert.equal(mock.mock.callCount(), 1);
    mock.mock.restore();
  }
});

test("supports Request inputs and HEAD reads", async (t) => {
  const mock = t.mock.method(globalThis, "fetch", async (_input, init) => {
    assert.ok(init.signal);
    return new Response(null, { status: 204 });
  });
  const response = await fetchWithRetry(new Request("https://example.com/data", { method: "HEAD" }), undefined, options);
  assert.equal(response.status, 204);
  assert.equal(mock.mock.callCount(), 1);
});

test("caller abort is not retried", async (t) => {
  const controller = new AbortController();
  const mock = t.mock.method(globalThis, "fetch", async () => {
    controller.abort(new Error("cancelled"));
    throw new TypeError("fetch failed");
  });
  await assert.rejects(fetchWithRetry("https://example.com/data", { signal: controller.signal }, options), /cancelled/);
  assert.equal(mock.mock.callCount(), 1);
});

test("an already aborted read never sends a request", async (t) => {
  const mock = t.mock.method(globalThis, "fetch", async () => Response.json({}));
  await assert.rejects(fetchWithRetry("https://example.com/data", { signal: AbortSignal.abort() }, options));
  assert.equal(mock.mock.callCount(), 0);
});

test("honors short Retry-After and does not retry before a long Retry-After", async (t) => {
  let calls = 0;
  const short = t.mock.method(globalThis, "fetch", async () => ++calls === 1
    ? new Response("", { status: 429, headers: { "Retry-After": "0.001" } })
    : Response.json({ ok: true }));
  assert.equal((await fetchWithRetry("https://example.com/data", undefined, options)).status, 200);
  assert.equal(calls, 2);
  short.mock.restore();
  const long = t.mock.method(globalThis, "fetch", async () =>
    new Response("rate limited", { status: 429, headers: { "Retry-After": "30" } }));
  assert.equal((await fetchWithRetry("https://example.com/data", undefined, options)).status, 429);
  assert.equal(long.mock.callCount(), 1);
});

test("times out and retries reads whose bodies stall", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_input, { signal }) => {
    calls += 1;
    return new Response(new ReadableStream({
      start(controller) {
        signal.addEventListener("abort", () => controller.error(signal.reason), { once: true });
      }
    }));
  });
  // AbortSignal.timeout uses unreferenced timers in Node.
  const keepAlive = setInterval(() => {}, 100);
  try {
    await assert.rejects(fetchWithRetry("https://example.com/data", undefined, { ...options, timeoutMs: 10 }), { name: "TimeoutError" });
    assert.equal(calls, 3);
  } finally {
    clearInterval(keepAlive);
  }
});
