import { NextRequest, NextResponse } from "next/server";
import { fetchPublicUrl, readLimited } from "@/lib/safe-remote";
import { loadSiteMetadata } from "@/lib/site-metadata";

export const runtime = "nodejs";

const MAX_ICON_BYTES = 1_000_000;
const cacheHeaders = {
  "Cache-Control": "public, max-age=604800, s-maxage=2592000, stale-while-revalidate=2592000",
  "CDN-Cache-Control": "public, max-age=2592000, stale-while-revalidate=2592000",
  "X-Content-Type-Options": "nosniff"
};

function inferredImageType(body: Uint8Array) {
  if (body.length >= 8 && body[0] === 0x89 && body[1] === 0x50 && body[2] === 0x4e && body[3] === 0x47) return "image/png";
  if (body.length >= 6 && new TextDecoder().decode(body.slice(0, 6)).startsWith("GIF8")) return "image/gif";
  if (body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return "image/jpeg";
  if (body.length >= 4 && body[0] === 0 && body[1] === 0 && body[2] === 1 && body[3] === 0) return "image/x-icon";
  if (body.length >= 12 && new TextDecoder().decode(body.slice(0, 4)) === "RIFF" && new TextDecoder().decode(body.slice(8, 12)) === "WEBP") return "image/webp";
  const prefix = new TextDecoder().decode(body.slice(0, Math.min(body.length, 512))).trimStart();
  if (prefix.startsWith("<svg") || /^<\?xml[\s\S]*?<svg/i.test(prefix)) return "image/svg+xml";
  return null;
}

async function fetchIcon(initialUrl: string, githubOnly: boolean) {
  const { response } = await fetchPublicUrl(initialUrl, {
    signal: AbortSignal.timeout(6000),
    headers: { Accept: "image/avif,image/webp,image/svg+xml,image/*,*/*;q=0.7", "User-Agent": "start-web-icon-cache/2.0" }
  }, githubOnly ? (url) => ["avatars.githubusercontent.com", "github.com"].includes(url.hostname.toLowerCase()) : undefined);
  if (!response.ok) throw new Error(`图标请求失败（${response.status}）`);
  const body = await readLimited(response, MAX_ICON_BYTES);
  const declaredType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
  const contentType = declaredType.startsWith("image/") ? declaredType : inferredImageType(body);
  if (!contentType) throw new Error("返回内容不是图片");
  return { body, contentType };
}

async function fetchBookmarkIcon(site: string, customUrl: string) {
  const siteUrl = new URL(site);
  const candidates: string[] = customUrl ? [customUrl] : [];
  try {
    const metadata = await loadSiteMetadata(site);
    if (metadata.iconUrl) candidates.push(metadata.iconUrl);
  } catch { /* Fall through to conventional and public favicon locations. */ }
  candidates.push(
    new URL("/favicon.ico", siteUrl).toString(),
    `https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(siteUrl.origin)}&sz=64`,
    `https://icons.duckduckgo.com/ip3/${encodeURIComponent(siteUrl.hostname)}.ico`
  );
  for (const candidate of [...new Set(candidates)]) {
    try { return await fetchIcon(candidate, false); } catch { /* Try the next favicon source. */ }
  }
  throw new Error("无法读取图标");
}

export async function GET(request: NextRequest) {
  try {
    const source = request.nextUrl.searchParams.get("url") ?? "";
    const site = request.nextUrl.searchParams.get("site") ?? "";
    const type = request.nextUrl.searchParams.get("type");
    if ((type !== "bookmark" && type !== "github") || (type === "github" && !source) || (type === "bookmark" && !site)) return new NextResponse(null, { status: 400 });
    const { body, contentType } = type === "bookmark" ? await fetchBookmarkIcon(site, source) : await fetchIcon(source, true);
    return new NextResponse(body, { headers: { ...cacheHeaders, "Content-Type": contentType } });
  } catch {
    return new NextResponse(null, { status: 404, headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" } });
  }
}
