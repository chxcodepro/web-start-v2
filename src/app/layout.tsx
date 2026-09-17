import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Web Start", template: "%s · Web Start" },
  description: "分组收藏书签与 GitHub Star 的轻量浏览器开始页。"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const authEnabled = Boolean(process.env.AUTH_SECRET && process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET && process.env.GITHUB_OWNER_LOGIN);
  return <html lang="zh-CN"><body><SiteHeader authEnabled={authEnabled} />{children}</body></html>;
}
