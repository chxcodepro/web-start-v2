import { setTimeout as delay } from "node:timers/promises";

type RetryOptions = {
  attempts?: number;
  timeoutMs?: number;
  delayMs?: number;
};

export async function fetchWithRetry(input: RequestInfo | URL, init?: RequestInit, options: RetryOptions = {}) {
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  // Writes may already have committed when the connection fails.
  if (method !== "GET" && method !== "HEAD") return fetch(input, init);

  const { attempts = 3, timeoutMs = 6000, delayMs = 350 } = options;
  const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    callerSignal?.throwIfAborted();
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal;
    try {
      const response = await fetch(input instanceof Request ? input.clone() : input, { ...init, signal });
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      const retryAfter = response.headers.get("retry-after");
      const requestedDelay = retryAfter === null ? 0 : /^\d+(\.\d+)?$/.test(retryAfter)
        ? Number(retryAfter) * 1000
        : Math.max(0, Date.parse(retryAfter) - Date.now()) || 0;
      if (!retryable || attempt === attempts - 1 || requestedDelay > 2000) {
        if (!response.ok || method === "HEAD" || response.status === 204 || response.status === 205) return response;
        // Keep the deadline active through body consumption, not just headers.
        const body = await response.arrayBuffer();
        const headers = new Headers(response.headers);
        headers.delete("content-encoding");
        headers.delete("content-length");
        return new Response(body, { status: response.status, statusText: response.statusText, headers });
      }
      await response.body?.cancel();
      if (requestedDelay) {
        await delay(requestedDelay, undefined, { signal: callerSignal ?? undefined });
        continue;
      }
    } catch (error) {
      callerSignal?.throwIfAborted();
      if (attempt === attempts - 1) throw error;
    }
    await delay(delayMs * 2 ** attempt, undefined, { signal: callerSignal ?? undefined });
  }
  throw new Error("No fetch attempts configured");
}
