import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

function isPublicAddress(address: string) {
  const value = address.toLowerCase();
  if (value.startsWith("::ffff:")) return isPublicAddress(value.slice(7));
  if (isIP(value) === 4) {
    const [a, b] = value.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168)) ||
      (a === 198 && (b === 18 || b === 19)));
  }
  if (isIP(value) === 6) {
    return !(value === "::" || value === "::1" || value.startsWith("fc") || value.startsWith("fd") || /^fe[89ab]/.test(value));
  }
  return false;
}

export async function assertPublicHttpUrl(value: string) {
  const url = new URL(value);
  if (!(["http:", "https:"] as string[]).includes(url.protocol) || url.username || url.password) throw new Error("不支持的远程地址");
  if (url.port && url.port !== "80" && url.port !== "443") throw new Error("不支持的远程端口");
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) throw new Error("不支持本地地址");
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) throw new Error("不支持私有网络地址");
  return url;
}

export async function fetchPublicUrl(initialUrl: string, init: RequestInit, validate?: (url: URL) => boolean) {
  let url = await assertPublicHttpUrl(initialUrl);
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    if (validate && !validate(url)) throw new Error("不允许的远程地址");
    const response = await fetch(url, { ...init, redirect: "manual" });
    if (response.status < 300 || response.status >= 400) return { response, url };
    const location = response.headers.get("location");
    if (!location || redirects === 3) throw new Error("远程地址重定向过多");
    url = await assertPublicHttpUrl(new URL(location, url).toString());
  }
  throw new Error("无法读取远程地址");
}

export async function readLimited(response: Response, maxBytes: number) {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > maxBytes) throw new Error("远程内容过大");
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw new Error("远程内容过大"); }
    chunks.push(value);
  }
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
  return joined;
}
