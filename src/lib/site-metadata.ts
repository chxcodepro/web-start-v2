import { fetchPublicUrl, readLimited } from "@/lib/safe-remote";

const MAX_HTML_BYTES = 1_500_000;
const siteHeaders = {
  Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.6",
  "User-Agent": "Mozilla/5.0 (compatible; StartWebMetadata/1.0; +https://start-web-mocha.vercel.app)"
};

function attribute(tag: string, name: string) {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>]+))`, "i"));
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? "";
}

function decodeHtml(value: string) {
  const named: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " };
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (_, entity: string) => {
      if (entity.startsWith("#x")) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
      if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
      return named[entity.toLowerCase()] ?? "";
    })
    .replace(/\s+/g, " ")
    .trim();
}

function findTitle(html: string) {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    const key = (attribute(tag, "property") || attribute(tag, "name")).toLowerCase();
    if (key === "og:title" || key === "twitter:title") {
      const content = decodeHtml(attribute(tag, "content"));
      if (content) return content.slice(0, 80);
    }
  }
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  return decodeHtml(title).slice(0, 80);
}

function findIcon(html: string, pageUrl: URL) {
  const matches = [...html.matchAll(/<link\b[^>]*>/gi)].map((match) => {
    const tag = match[0];
    const rel = attribute(tag, "rel").toLowerCase();
    const href = attribute(tag, "href");
    if (!href || !rel.split(/\s+/).some((part) => part === "icon" || part === "apple-touch-icon" || part === "apple-touch-icon-precomposed")) return null;
    try {
      const url = new URL(href, pageUrl);
      if (!(["http:", "https:"] as string[]).includes(url.protocol)) return null;
      const sizes = attribute(tag, "sizes");
      const largestSize = Math.max(0, ...[...sizes.matchAll(/(\d+)x(\d+)/gi)].map((size) => Number(size[1]) * Number(size[2])));
      const score = (rel.includes("apple") ? 100 : 300) + (url.pathname.endsWith(".svg") ? 100_000 : largestSize);
      return { url: url.toString(), score };
    } catch { return null; }
  }).filter((item): item is { url: string; score: number } => Boolean(item));
  matches.sort((a, b) => b.score - a.score);
  return matches[0]?.url ?? null;
}

export async function loadSiteMetadata(initialUrl: string) {
  const { response, url } = await fetchPublicUrl(initialUrl, { signal: AbortSignal.timeout(8000), headers: siteHeaders });
  if (!response.ok) throw new Error(`网站请求失败（${response.status}）`);
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType && !contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) throw new Error("网址不是网页");
  const html = new TextDecoder().decode(await readLimited(response, MAX_HTML_BYTES));
  return {
    title: findTitle(html),
    iconUrl: findIcon(html, url),
    finalUrl: url.toString()
  };
}
