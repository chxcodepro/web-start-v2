import { fetchPublicUrl, readLimited } from "@/lib/safe-remote";

export async function GET() {
  try {
    const { response } = await fetchPublicUrl("https://www.loliapi.com/acg/", {
      headers: { Accept: "image/avif,image/webp,image/*" },
      cache: "no-store",
      signal: AbortSignal.timeout(8000)
    });
    const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (!response.ok || !contentType || !["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"].includes(contentType)) {
      await response.body?.cancel();
      throw new Error("Background provider did not return an image");
    }
    const bytes = await readLimited(response, 8 * 1024 * 1024);
    if (!bytes.length) throw new Error("Background provider returned an empty image");
    return new Response(bytes, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400, stale-if-error=86400",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch {
    return Response.json({ error: "背景暂时不可用" }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
