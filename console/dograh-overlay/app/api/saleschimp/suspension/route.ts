// SALESCHIMP OVERLAY — same-origin suspension probe for the kill-live poller.
//
// Lands at src/app/api/saleschimp/suspension/route.ts via the build-time
// overlay copy. The client poller (SuspensionWatcher) can't read the
// HttpOnly dograh_auth_token cookie or call the cross-origin gateway with a
// bearer, so this server-side route does it: reads the cookie, asks the
// gateway over the docker network, and returns a tiny {suspended, mode}.
//
// Excluded from the auth middleware (matcher skips /api/*), so it's freely
// pollable and can't recurse into the suspension redirect.

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const GATEWAY_URL = process.env.GATEWAY_INTERNAL_URL || "http://gateway:8080";

export async function GET() {
  const fallback = { suspended: false, mode: "delayed" as const };
  const token = (await cookies()).get("dograh_auth_token")?.value;
  if (!token) return NextResponse.json(fallback);
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(`${GATEWAY_URL}/api/tenant/suspension-info`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return NextResponse.json(fallback);
    const d = await res.json();
    return NextResponse.json({
      suspended: Boolean(d?.suspended),
      mode: d?.mode === "kill_live" ? "kill_live" : "delayed",
    });
  } catch {
    return NextResponse.json(fallback); // fail open
  }
}
