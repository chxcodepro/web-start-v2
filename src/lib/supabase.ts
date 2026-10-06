import { createClient } from "@supabase/supabase-js";
import { fetchWithRetry } from "@/lib/retry-fetch";

function isModernApiKey(value: string) {
  return value.startsWith("sb_secret_") || value.startsWith("sb_publishable_");
}

function apiKeyOnlyFetch(apiKey: string): typeof fetch {
  return async (input, init) => {
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, name) => headers.set(name, value));

    // New Supabase API keys are opaque values, not JWTs. supabase-js still adds
    // the key as a Bearer fallback for Data API requests, which can make
    // PostgREST try to validate it as a JWT. Keep the required apikey header and
    // remove only that fallback; real user access tokens remain untouched.
    if (headers.get("authorization") === `Bearer ${apiKey}`) {
      headers.delete("authorization");
    }

    return fetchWithRetry(input, { ...init, headers });
  };
}

export function hasDatabaseConfig() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase 尚未配置");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { retry: false },
    global: { fetch: isModernApiKey(key) ? apiKeyOnlyFetch(key) : fetchWithRetry }
  });
}
