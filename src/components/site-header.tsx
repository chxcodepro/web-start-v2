"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bookmark, Clipboard, Github, Power, UserRound } from "lucide-react";
import { signIn, signOut } from "next-auth/react";
import { SCROLL_COMPENSATION_EVENT } from "@/lib/scroll-anchor";

export function SiteHeader({ authEnabled }: { authEnabled: boolean }) {
  const pathname = usePathname();
  // null 表示会话尚未确认：此时不显示图标，避免登录图标闪成退出图标
  const [loggedIn, setLoggedIn] = useState<boolean | null>(authEnabled ? null : false);
  const [navHidden, setNavHidden] = useState(false);

  useEffect(() => {
    if (!authEnabled) return;
    fetch("/api/auth/session", { signal: AbortSignal.timeout(8000) }).then((response) => response.json()).then((session) => setLoggedIn(Boolean(session?.user))).catch(() => setLoggedIn(false));
  }, [authEnabled]);

  useEffect(() => {
    let previousY = window.scrollY;
    let frame = 0;
    const update = () => {
      const currentY = window.scrollY;
      if (currentY <= 48) setNavHidden(false);
      else if (currentY > previousY + 4) setNavHidden(true);
      else if (currentY < previousY - 4) setNavHidden(false);
      previousY = currentY;
      frame = 0;
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    // 页面为了让内容留在原位自动修正的滚动不是用户在滚，从比较基准里扣掉，顶栏保持原样
    const onCompensation = (event: Event) => { previousY += (event as CustomEvent<number>).detail; };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener(SCROLL_COMPENSATION_EVENT, onCompensation);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener(SCROLL_COMPENSATION_EVENT, onCompensation);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return <>
    <header className={`site-header page-shell ${navHidden ? "nav-hidden" : ""}`}>
      <div className="header-inner glass">
        <nav className="nav-links" aria-label="主要导航">
          <Link href="/" aria-label="书签" title="书签" className={`nav-link icon-only ${pathname === "/" ? "active" : ""}`}><Bookmark size={19} aria-hidden="true" /></Link>
          <Link href="/stars" aria-label="GitHub Star" title="GitHub Star" className={`nav-link icon-only ${pathname.startsWith("/stars") ? "active" : ""}`}><Github size={19} aria-hidden="true" /></Link>
          <Link href="/clipboard" aria-label="剪切板" title="剪切板" className={`nav-link icon-only ${pathname.startsWith("/clipboard") ? "active" : ""}`}><Clipboard size={19} aria-hidden="true" /></Link>
        </nav>
      </div>
    </header>
    {loggedIn === null
      ? <span className="dock-button login-dock is-pending" aria-hidden="true" />
      : loggedIn
      ? <button type="button" className="dock-button login-dock is-signed-in" aria-label="退出登录" title="退出登录" onClick={() => void signOut({ callbackUrl: "/" })}><Power size={18} aria-hidden="true" /></button>
      : (authEnabled
      ? <button type="button" className="dock-button login-dock" aria-label="使用 GitHub 登录" title="登录" onClick={() => void signIn("github", { callbackUrl: "/" })}><UserRound size={19} aria-hidden="true" /></button>
      : <Link href="/login" className="dock-button login-dock" aria-label="登录" title="登录"><UserRound size={19} aria-hidden="true" /></Link>)}
  </>;
}
