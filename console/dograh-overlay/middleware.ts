// SALESCHIMP OVERLAY — replaces dograh/ui/src/middleware.ts at build time
// (COPY console/dograh-overlay/ ./src/ in Dockerfile.ui).
//
// Preserves upstream Dograh behaviour VERBATIM (auth-provider detection +
// token→/auth/login redirect) and ADDS suspension enforcement: a suspended
// tenant hitting ANY Dograh page (ports 8080 AND 8081 both render this UI)
// is redirected to the full-screen /console/suspended takeover BEFORE the
// page renders. This is the hard block the gateway's /api/tenant/*
// middleware can't provide for Dograh's own pages.
//
// RE-MERGE NOTE: if a Dograh bump changes src/middleware.ts, diff it and
// re-apply the [saleschimp-overlay] suspension block onto the new base.
//
// The suspension check is a server-side fetch to the gateway over the
// docker network (no CORS, token never leaves the server). It FAILS OPEN:
// if the gateway is unreachable we let the request through rather than
// locking everyone out on an infra blip — the gateway's own /api/tenant/*
// guard still blocks the SaaS surface in that window.

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

const OSS_TOKEN_COOKIE = 'dograh_auth_token';

// Paths that don't require authentication in OSS mode
const PUBLIC_PATHS = ['/auth/login', '/auth/signup'];

// [saleschimp-overlay] gateway base URL on the docker network.
const GATEWAY_URL = process.env.GATEWAY_INTERNAL_URL || 'http://gateway:8080';
// Where suspended tenants land (console basePath = /console).
const SUSPENDED_PATH = '/console/suspended';

let cachedAuthProvider: string | null = null;

async function fetchAuthProvider(): Promise<string> {
  if (cachedAuthProvider) {
    return cachedAuthProvider;
  }

  try {
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:8000';
    const res = await fetch(`${backendUrl}/api/v1/health`);
    if (res.ok) {
      const data = await res.json();
      cachedAuthProvider = (data.auth_provider as string) || 'local';
      return cachedAuthProvider;
    }
  } catch {
    // Backend not reachable — fall back to local
  }

  cachedAuthProvider = 'local';
  return cachedAuthProvider;
}

// [saleschimp-overlay] Is this token's tenant suspended? Server-side call
// to the gateway. Fails open (returns false) on any error.
async function isTenantSuspended(token: string): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(`${GATEWAY_URL}/api/tenant/suspension-info`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return false;
    const data = await res.json();
    return Boolean(data?.suspended);
  } catch {
    return false; // fail open
  }
}

export async function middleware(request: NextRequest) {
  const authProvider = await fetchAuthProvider();

  // Only handle OSS mode
  if (authProvider !== 'local') {
    return NextResponse.next();
  }

  const token = request.cookies.get(OSS_TOKEN_COOKIE)?.value;
  const { pathname } = request.nextUrl;

  // Allow public paths without auth
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // If no token, redirect to login
  if (!token) {
    const loginUrl = new URL('/auth/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  // [saleschimp-overlay] Suspension gate — block the whole Dograh app for
  // suspended tenants, sending them to the suspension takeover. Skip if
  // we're already heading there (defensive; this UI doesn't serve
  // /console/* but the check is cheap).
  if (!pathname.startsWith(SUSPENDED_PATH) && (await isTenantSuspended(token))) {
    return NextResponse.redirect(new URL(SUSPENDED_PATH, request.url));
  }

  return NextResponse.next();
}

// Configure which routes the middleware runs on
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - api routes
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (public folder)
     */
    '/((?!api|_next/static|_next/image|favicon.ico|public).*)',
  ],
};
