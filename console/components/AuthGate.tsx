"use client";

/**
 * Auth wrapper for the console.
 *
 * Wraps protected routes — runs `ensureSession()` on mount, which reads the
 * Dograh cookie, exchanges it for a console JWT, and stashes the result in
 * localStorage so /api/tenant/* fetches work. On failure: shows a clear
 * "sign in to Dograh first" prompt with a link back to the Dograh login.
 *
 * Public routes (the bare /console landing page) don't wrap with this — so
 * an unauthenticated visitor can still see the marketing/hello content.
 */

import { useEffect, useState } from "react";

import { ensureSession, type SessionExchangeOut } from "@/lib/api";

type State =
  | { kind: "loading" }
  | { kind: "ok"; session: SessionExchangeOut }
  | { kind: "anonymous" }
  | { kind: "error"; message: string };

export function AuthGate({ children }: { children: (s: SessionExchangeOut) => React.ReactNode }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session = await ensureSession();
        if (cancelled) return;
        if (session === null) {
          setState({ kind: "anonymous" });
        } else {
          setState({ kind: "ok", session });
        }
      } catch (e) {
        if (cancelled) return;
        setState({ kind: "error", message: (e as Error).message });
      }
    })();
    return () => {
      cancelled = true;
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
