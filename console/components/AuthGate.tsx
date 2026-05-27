"use client";

/**
 * Auth wrapper for the console.
 *
 * Wraps protected routes — runs `ensureSession()` on mount, which reads the
 * Dograh cookie, exchanges it for a console JWT, and stashes the result in
 * localStorage so /api/tenant/* fetches work.
 *
 * Two unification rules that keep this in lockstep with Dograh:
 *
 *   1. **Single source of truth = Dograh cookie.** When we're embedded
 *      inside Dograh's chrome (window.top !== window.self → the /console-
 *      bridge iframe), the Dograh cookie is authoritative. We bypass the
 *      localStorage token path and re-derive every mount from
 *      /api/auth/oss. That way Dograh logout immediately invalidates the
 *      iframe on next render.
 *
 *   2. **Don't render our own "sign in" card inside the iframe.** If
 *      auth fails while embedded, we navigate the *top* window to
 *      /auth/login so the user lands on Dograh's login (single login
 *      page across the app). Rendering the card inside the iframe is
 *      what produced the "login page inside Dograh's body" bug.
 *
 * Standalone (non-iframe) callers still get the inline card — useful for
 * direct /console/* URLs where we don't control the top window.
 *
 * Public routes (the bare /console landing page) don't wrap with this — so
 * an unauthenticated visitor can still see the marketing/hello content.
 */

import { useEffect, useState } from "react";

import { ensureSession, type SessionExchangeOut, setToken } from "@/lib/api";

type State =
  | { kind: "loading" }
  | { kind: "ok"; session: SessionExchangeOut }
  | { kind: "anonymous" }
  | { kind: "error"; message: string };

function isEmbedded(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.self !== window.top;
  } catch {
    // Cross-origin frame access throws — that itself means we're embedded
    // in a frame we don't own, which still counts as "embedded" for our
    // purposes (defer to whatever is hosting us).
    return true;
  }
}

/** When auth fails inside the iframe, navigate the TOP window to Dograh's
 *  login. Falls back to in-frame navigation if top is cross-origin (won't
 *  happen in our setup — same-origin via nginx — but keep the fallback so
 *  the user is never stranded). */
function redirectToDograhLogin(): void {
  if (typeof window === "undefined") return;
  const target = "/auth/login";
  try {
    if (window.top && window.top !== window.self) {
      window.top.location.href = target;
      return;
    }
  } catch {
    // cross-origin top — fall through to self-navigation
  }
  window.location.href = target;
}

export function AuthGate({ children }: { children: (s: SessionExchangeOut) => React.ReactNode }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    const embedded = isEmbedded();

    async function checkAuth() {
      try {
        // Inside the iframe, drop any local token so ensureSession is forced
        // to re-derive from the Dograh cookie. This is what keeps Dograh
        // logout from leaving a zombie console session alive.
        if (embedded) {
          setToken(null);
        }
        const session = await ensureSession();
        if (cancelled) return;
        if (session === null) {
          if (embedded) {
            // Embedded → kick the user out of the iframe entirely.
            redirectToDograhLogin();
            return;
          }
          setState({ kind: "anonymous" });
        } else {
          setState({ kind: "ok", session });
        }
      } catch (e) {
        if (cancelled) return;
        if (embedded) {
          redirectToDograhLogin();
          return;
        }
        setState({ kind: "error", message: (e as Error).message });
      }
    }

    void checkAuth();

    // Periodic re-check inside the iframe so a Dograh logout (or session
    // expiry) propagates without the user having to refresh manually.
    // 60s is a balance between catching logouts quickly and not hammering
    // the bridge endpoint. Standalone callers don't get the poll because
    // they own their own page lifecycle.
    let intervalId: ReturnType<typeof setInterval> | null = null;
    if (embedded) {
      intervalId = setInterval(() => {
        if (cancelled) return;
        void checkAuth();
      }, 60_000);
    }

    return () => {
      cancelled = true;
      if (intervalId !== null) clearInterval(intervalId);
    };
  }, []);

  if (state.kind === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-[color:var(--muted-foreground)]">
        Connecting your workspace…
      </div>
    );
  }

  if (state.kind === "anonymous") {
    // Only reachable in the standalone (non-iframe) case — embedded mode
    // redirects the top window before ever rendering this branch.
    return (
      <div className="mx-auto max-w-md px-6 py-16 text-center">
        <h1 className="text-xl font-semibold">Sign in to continue</h1>
        <p className="mt-2 text-sm text-[color:var(--muted-foreground)]">
          The console uses your Dograh session. Sign in to Dograh first, then come back here.
        </p>
        {/*
          Dograh's login lives at /auth/login on the SAME host (nginx routes
          / to Dograh). Next's <Link> would basePath-prepend `/console`,
          turning this into `/console/auth/login` (a 404). Plain <a> is
          correct here because the destination is outside this Next app.
        */}
        <a
          href="/auth/login"
          className="mt-6 inline-block rounded-md bg-[color:var(--primary)] px-4 py-2 text-sm text-[color:var(--primary-foreground)] hover:opacity-90"
        >
          Go to sign in
        </a>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="mx-auto max-w-md px-6 py-16">
        <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.message}</div>
      </div>
    );
  }

  return <>{children(state.session)}</>;
}
