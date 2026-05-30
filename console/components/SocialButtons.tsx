"use client";

/**
 * SocialButtons (console) — "Continue with …" buttons for enabled social
 * providers, plus post-OAuth fragment handling.
 *
 * The button navigates to the gateway's /social/{provider}/start (audience
 * customer); after the provider round-trip the gateway redirects back here
 * with the session token (or an error) in the URL fragment. On mount we read
 * location.hash: access_token logs the user in; social_error is surfaced via
 * onError. Renders nothing when no providers are enabled.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { GATEWAY, setToken } from "@/lib/api";

type Provider = { provider: string; name: string };

export function SocialButtons({
  redirectTo = "/",
  onError,
}: {
  redirectTo?: string;
  onError?: (msg: string) => void;
}) {
  const router = useRouter();
  const [providers, setProviders] = useState<Provider[]>([]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.location.hash) return;
    const params = new URLSearchParams(window.location.hash.slice(1));
    const token = params.get("access_token");
    const err = params.get("social_error");
    history.replaceState(null, "", window.location.pathname + window.location.search);
    if (token) {
      setToken(token);
      router.replace(redirectTo);
    } else if (err && onError) {
      onError(err);
    }
  }, [router, redirectTo, onError]);

  useEffect(() => {
    fetch(`${GATEWAY}/api/auth/social-config`)
      .then((r) => r.json())
      .then((d) => setProviders(d.providers ?? []))
      .catch(() => setProviders([]));
  }, []);

  if (providers.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 py-1">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs text-muted-foreground">or continue with</span>
        <span className="h-px flex-1 bg-border" />
      </div>
      <div className="grid gap-2">
        {providers.map((p) => (
          <a
            key={p.provider}
            href={`${GATEWAY}/api/auth/social/${p.provider}/start?audience=customer`}
            className="flex w-full items-center justify-center rounded-md border bg-background px-4 py-2 text-sm font-medium hover:bg-muted/50"
          >
            Continue with {p.name}
          </a>
        ))}
      </div>
    </div>
  );
}
