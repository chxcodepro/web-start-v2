import type { Metadata } from "next";
import { auth } from "@/auth";
import { GithubStarBrowser } from "@/components/github-star-browser";
import { getGithubGroups } from "@/lib/data";

export const metadata: Metadata = { title: "GitHub Star" };

export default async function StarsPage() {
  const authConfigured = Boolean(process.env.AUTH_SECRET && process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET && process.env.GITHUB_OWNER_LOGIN);
  const session = authConfigured ? await auth() : null;
  const canManage = Boolean(session?.user);
  const groups = await getGithubGroups(canManage);
  return <main className="page-shell">
    <GithubStarBrowser groups={groups} canManage={canManage} />
  </main>;
}
