"use client";

/**
 * /console/reset — emergency session-clear utility.
 *
 * Hit when something's gone weird and you want a clean slate without
 * digging into DevTools. Clears every piece of session state we own and
 * sends you back to Dograh's login:
 *   1. localStorage.sc_console_token (our JWT)
 *   2. POST /api/auth/logout — Dograh's Next route that drops the
 *      HttpOnly dograh_auth_token + dograh_auth_user cookies
 *   3. window.location.href = /auth/login
 *
 * Lives under (public)/ so it never gets wrapped in AuthGate — running
 * it from a stuck-auth state is the entire point.
 *
 * No buttons, no confirmations. The page is "do the thing and leave"
 * — anyone who navigates here intentionally wants a reset.
 */

import { useEffect, useState } from "react";

import { setToken } from "@/lib/api";
import { AuthShell } from "@/components/AuthShell";

export default function ResetPage() {
  const [step, setStep] = useState<"clearing" | "redirecting">("clearing");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // 1. Drop our console JWT.
      setToken(null);

      // 2. Tell Dograh to drop its cookies. Network failure is
      //    non-fatal — we still want to redirect.
      try {
        await fetch("/api/auth/logout", { method: "POST" });
      } catch {
        // ignored
      }

      if (cancelled) return;
      setStep("redirecting");

      // 3. Hard-navigate so any in-memory app state gets nuked too.
      window.location.href = "/auth/login";
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AuthShell
      title={step === "clearing" ? "Clearing session…" : "Redirecting…"}
      subtitle="Dropping your console + Dograh tokens, then taking you back to sign in."
    >
      <p className="text-sm text-muted-foreground text-center">
        {step === "clearing"
          ? "One moment."
          : "If you aren't redirected automatically, "}
        {step === "redirecting" && (
          <a href="/auth/login" className="underline">
            click here
          </a>
        )}
        {step === "redirecting" && "."}
      </p>
    </AuthShell>
  );
}
