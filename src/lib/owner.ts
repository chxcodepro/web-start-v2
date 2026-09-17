import { auth } from "@/auth";

export async function requireOwner() {
  const session = await auth();
  const expected = process.env.GITHUB_OWNER_LOGIN?.toLowerCase();
  if (!session?.user?.login || !expected || session.user.login.toLowerCase() !== expected) {
    throw new Error("UNAUTHORIZED");
  }
  return session;
}
