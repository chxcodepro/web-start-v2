"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bookmark, Clipboard, Github, LogIn, LogOut } from "lucide-react";
import { signIn, signOut } from "next-auth/react";

export function SiteHeader({ authEnabled }: { authEnabled: boolean }) {
  const pathname = usePathname();
  const [loggedIn, setLoggedIn] = useState(false);
  const [navHidden, setNavHidden] = useState(false);

  useEffect(() => {
    if (!authEnabled) return;
    fetch("/api/auth/session").then((response) => response.json()).then((session) => setLoggedIn(Boolean(session?.user))).catch(() => setLoggedIn(false));
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
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
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
    {loggedIn
      ? <button type="button" className="login-dock login-only" aria-label="退出登录" title="退出登录" onClick={() => void signOut({ callbackUrl: "/" })}><LogOut size={18} aria-hidden="true" /></button>
      : (authEnabled
      ? <button type="button" className="login-dock login-only" aria-label="使用 GitHub 登录" title="登录" onClick={() => void signIn("github", { callbackUrl: "/" })}><LogIn size={18} aria-hidden="true" /></button>
      : <Link href="/login" className="login-dock login-only" aria-label="登录" title="登录"><LogIn size={18} aria-hidden="true" /></Link>)}
  </>;
}
