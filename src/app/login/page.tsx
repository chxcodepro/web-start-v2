import { Github, LogIn } from "lucide-react";
import { auth, signIn } from "@/auth";
import { redirect } from "next/navigation";

export default async function LoginPage() {
  const ready = Boolean(process.env.AUTH_SECRET && process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET && process.env.GITHUB_OWNER_LOGIN);
  const session = ready ? await auth() : null;
  if (session) redirect("/");
  return <main className="page-shell auth-page">
    <section className="auth-card glass">
      <span className="auth-icon"><Github size={28} /></span>
      <p className="eyebrow">Owner access</p>
      <h1>登录后管理收藏</h1>
      <p>访客无需登录即可浏览。管理入口只允许配置的 GitHub 账号进入。</p>
      {ready ? <form action={async () => { "use server"; await signIn("github", { redirectTo: "/" }); }}><button className="primary-button wide-button" type="submit"><LogIn size={18} />使用 GitHub 登录</button></form> : <div className="config-notice">演示模式尚未配置 GitHub OAuth。请先按 README 设置环境变量。</div>}
    </section>
  </main>;
}
