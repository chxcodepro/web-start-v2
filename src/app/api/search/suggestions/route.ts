import { NextRequest, NextResponse } from "next/server";

async function loadSuggestions(endpoint: string, referer: string, timeout: number) {
  const response = await fetch(endpoint, {
    headers: {
      "Accept": "application/json,text/plain,*/*",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      "Referer": referer,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36"
    },
    signal: AbortSignal.timeout(timeout),
    cache: "no-store"
  });
  if (!response.ok) throw new Error(`Suggestion provider returned ${response.status}`);
  const data = await response.json();
  const suggestions = Array.isArray(data?.[1]) ? data[1].filter((item: unknown): item is string => typeof item === "string").slice(0, 8) : [];
  if (!suggestions.length) throw new Error("Suggestion provider returned no results");
  return suggestions;
}

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim().slice(0, 120) ?? "";
  const engine = request.nextUrl.searchParams.get("engine") === "google" ? "google" : "bing";
  if (query.length < 2) return NextResponse.json({ suggestions: [] });
  const encodedQuery = encodeURIComponent(query);
  const googleEndpoint = `https://www.google.com/complete/search?client=chrome&hl=zh-CN&q=${encodedQuery}`;
  const bingEndpoint = `https://api.bing.com/osjson.aspx?query=${encodedQuery}&market=zh-CN`;
  try {
    const suggestions = engine === "google"
      ? await Promise.any([
        loadSuggestions(googleEndpoint, "https://www.google.com/", 5000),
        new Promise<void>((resolve) => setTimeout(resolve, 650)).then(() => loadSuggestions(bingEndpoint, "https://www.bing.com/", 3500))
      ])
      : await loadSuggestions(bingEndpoint, "https://www.bing.com/", 3500);
    return NextResponse.json({ suggestions }, { headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" } });
  } catch {
    return NextResponse.json({ suggestions: [] });
  }
}
