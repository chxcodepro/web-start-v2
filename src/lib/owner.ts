import { auth } from "@/auth";

export function isAuthConfigured() {
  return Boolean(process.env.AUTH_SECRET && process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET && process.env.GITHUB_OWNER_LOGIN);
}

// 登录回调只放行指定账号，因此存在会话即视为管理员
export async function viewerCanManage() {
  if (!isAuthConfigured()) return false;
  const session = await auth();
  return Boolean(session?.user);
}

export async function requireOwner() {
  const session = await auth();
  const expected = process.env.GITHUB_OWNER_LOGIN?.toLowerCase();
  if (!session?.user?.login || !expected || session.user.login.toLowerCase() !== expected) {
    throw new Error("UNAUTHORIZED");
  }
  return session;
}
