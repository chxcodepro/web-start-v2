import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [GitHub],
  callbacks: {
    async signIn({ profile }) {
      const owner = process.env.GITHUB_OWNER_LOGIN?.toLowerCase();
      return Boolean(owner && profile?.login && String(profile.login).toLowerCase() === owner);
    },
    async jwt({ token, profile }) {
      if (profile?.login) token.login = String(profile.login);
      return token;
    },
    async session({ session, token }) {
      session.user.login = typeof token.login === "string" ? token.login : undefined;
      return session;
    }
  },
  pages: { signIn: "/login", error: "/login" },
  session: { strategy: "jwt" }
});
