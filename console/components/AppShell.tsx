"use client";

/**
 * Console AppShell — sidebar layout that wraps every authed page.
 *
 * Mirrors Dograh's left-nav visual language (label "SALESCHIMP", section
 * groups, lucide icons). When nginx fronts both Dograh + console at the
 * unified URL, the user feels one product even though we're running our
 * own chrome here — by design, since we don't want to take a tight
 * dependency on Dograh's AppSidebar component upgrade path.
 *
 * Sidebar is fixed-width, collapses to icons under sm: in a follow-up.
 */

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  Boxes,
  CreditCard,
  LayoutDashboard,
  LogOut,
  Sparkles,
  Wallet,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { setToken, type SessionExchangeOut } from "@/lib/api";
import { NotificationBell } from "@/components/NotificationBell";

type NavItem = { title: string; href: string; icon: ReactNode };

type NavSection = { label?: string; items: NavItem[] };

// Hrefs are written WITHOUT the /console prefix because Next's basePath
// (set in next.config.ts) prepends it automatically. Writing "/console/x"
// here turns into "/console/console/x" — the classic basePath double-prefix
// bug. Same rule applies in router.replace() and <Link> hrefs everywhere
// in this folder; cross-app links to Dograh (e.g. /handler/sign-out) must
// bypass Next via plain <a> tags or window.location.
const NAV: NavSection[] = [
  {
    items: [
      { title: "Dashboard", href: "/", icon: <LayoutDashboard className="size-4" /> },
    ],
  },
  {
    label: "MONEY",
    items: [
      { title: "Wallet & Billing", href: "/billing", icon: <Wallet className="size-4" /> },
      { title: "Plans", href: "/billing/plans", icon: <CreditCard className="size-4" /> },
    ],
  },
  {
    label: "EXTEND",
    items: [
      { title: "Marketplace", href: "/marketplace", icon: <Boxes className="size-4" /> },
    ],
  },
];

export function AppShell({
  session,
  children,
}: {
  session: SessionExchangeOut;
  children: ReactNode;
}) {
  const pathname = usePathname();
  // Iframe detection. When the console renders inside Dograh's
  // /console-bridge/* iframe host we suppress our own sidebar — the
  // user is navigating via Dograh's left nav and a nested sidebar
  // would be confusing. Runs in useEffect so the initial SSR / first
  // paint match (avoids a hydration mismatch).
  const [embedded, setEmbedded] = useState(false);
  useEffect(() => {
    setEmbedded(typeof window !== "undefined" && window.self !== window.top);
  }, []);

  async function signOut() {
    // Two things to clear:
    //   1. Our console JWT in localStorage (so AuthGate doesn't see a stale
    //      session on the way out).
    //   2. Dograh's auth cookies — `/api/auth/logout` is Dograh's local-auth
    //      Next route that clears `dograh_auth_token` + `dograh_auth_user`.
    //      Same origin via nginx (everything-not-/console/* routes to ui).
    //      Stack-auth deployments would use `/handler/sign-out` instead, but
    //      OSS/local-auth is what we ship with — and `/handler/*` returns
    //      "Stack Auth handler is disabled" on local mode.
    setToken(null);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Network failure during logout is non-fatal — the cookie + token
      // are best-effort and the redirect below kicks the user to the
      // login screen where re-auth happens anyway.
    }
    window.location.href = "/auth/login";
  }

  // Embedded mode: render JUST the content. Dograh's sidebar (parent
  // window) is the source of truth for navigation; sign-out + user
  // chip live on Dograh's own footer. Direct-URL hits to /console/*
  // still get the full AppShell below.
  if (embedded) {
    return (
      <main className="min-h-screen bg-[color:var(--background)]">{children}</main>
    );
  }

  return (
    <div className="flex min-h-screen">
      <aside className="w-60 shrink-0 border-r border-[color:var(--border)] bg-[color:var(--card)] flex flex-col">
        <div className="px-4 py-4 border-b border-[color:var(--border)]">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex aspect-square size-8 items-center justify-center rounded-md bg-[color:var(--primary)] text-[color:var(--primary-foreground)]">
              <Sparkles className="size-4" />
            </div>
            <div>
              <div className="text-sm font-semibold">SalesChimp</div>
              <div className="text-[10px] uppercase tracking-wide text-[color:var(--muted-foreground)]">Console</div>
            </div>
          </Link>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
          {NAV.map((section, i) => (
            <div key={i}>
              {section.label && (
                <div className="px-2 mb-1 text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)]">
                  {section.label}
                </div>
              )}
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const active =
                    pathname === item.href ||
                    // usePathname() returns paths WITHOUT the basePath, so we
                    // compare against the stripped hrefs above. "/" is the
                    // dashboard root; treat it as an exact match only so it
                    // doesn't claim "active" on every other route.
                    (item.href !== "/" && pathname.startsWith(item.href));
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={cn(
                          "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition",
                          active
                            ? "bg-[color:var(--muted)] font-medium"
                            : "hover:bg-[color:var(--muted)]",
                        )}
                      >
                        {item.icon}
                        {item.title}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-[color:var(--border)] px-3 py-3">
          <div className="text-xs text-[color:var(--muted-foreground)] truncate">{session.email}</div>
          <div className="text-[10px] uppercase tracking-wide text-[color:var(--muted-foreground)]">
            {session.tenant_slug} · {session.role}
          </div>
          <button
            onClick={signOut}
            className="mt-2 flex items-center gap-2 text-xs text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)]"
          >
            <LogOut className="size-3" />
            Sign out
          </button>
        </div>
      </aside>

      <div className="flex flex-1 min-w-0 flex-col">
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-end gap-2 border-b border-[color:var(--border)] bg-[color:var(--background)] px-4">
          <NotificationBell />
        </header>
        <main className="flex-1 min-w-0 bg-[color:var(--background)]">{children}</main>
      </div>
    </div>
  );
}
