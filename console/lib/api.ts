// Console API client over the gateway's /api/tenant/* surface.
//
// Same shape as app-ui/lib/api.ts so porting individual pages over is mostly
// a path-update job. Token storage uses a different localStorage key
// (`sc_console_token`) to keep the console session distinct from the
// legacy app-ui session during the parallel migration.

export const GATEWAY = process.env.NEXT_PUBLIC_GATEWAY_URL || "http://localhost:8080";

export class ApiError extends Error {
  constructor(public status: number, public body: unknown, message: string) {
    super(message);
  }
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("sc_console_token");
}

export function setToken(token: string | null) {
  if (typeof window === "undefined") return;
  if (token) localStorage.setItem("sc_console_token", token);
  else localStorage.removeItem("sc_console_token");
}

export async function api<T = unknown>(
  path: string,
  init: RequestInit & { auth?: boolean } = {},
): Promise<T> {
  const { auth = true, headers, ...rest } = init;
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    ...(headers as Record<string, string>),
  };
  if (auth) {
    const token = getToken();
    if (token) h.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${GATEWAY}${path}`, { ...rest, headers: h });
  // On 401 drop the cached token so the next page load re-runs
  // session-exchange against Dograh. If we're embedded inside Dograh's
  // chrome (the /console-bridge iframe), also bounce the top window to
  // Dograh's login — otherwise the user gets stuck in an iframe whose
  // contents 401 silently. This keeps Dograh + console as a single
  // logical session: when one side fails auth, both sides re-login.
  if (res.status === 401 && auth) {
    setToken(null);
    if (typeof window !== "undefined") {
      let embedded = false;
      try {
        embedded = window.self !== window.top;
      } catch {
        embedded = true; // cross-origin top counts as embedded
      }
      if (embedded) {
        try {
          if (window.top) {
            window.top.location.href = "/auth/login";
          } else {
            window.location.href = "/auth/login";
          }
        } catch {
          window.location.href = "/auth/login";
        }
      }
    }
  }
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  // Suspended tenants: the gateway middleware 403s non-allowlisted
  // /api/tenant/* with detail.code === 'tenant_suspended'. Bounce the
  // (top) window to the suspended page — which itself only calls the
  // allowlisted suspension-info + tickets endpoints, so it won't loop.
  if (
    res.status === 403 &&
    body?.detail?.code === "tenant_suspended" &&
    typeof window !== "undefined"
  ) {
    const target = "/console/suspended";
    if (!window.location.pathname.endsWith("/suspended")) {
      // Full-screen takeover — break out of the Dograh iframe if embedded.
      try {
        const top = window.top;
        if (top && top !== window.self) top.location.href = target;
        else window.location.href = target;
      } catch {
        window.location.href = target;
      }
    }
  }
  if (!res.ok) {
    throw new ApiError(res.status, body, _formatDetail(body?.detail) || res.statusText);
  }
  return body as T;
}

function _formatDetail(detail: unknown): string | null {
  if (detail == null) return null;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((d) => {
        if (typeof d === "string") return d;
        if (d && typeof d === "object") {
          const loc = Array.isArray(d.loc) ? d.loc.slice(1).join(".") : "";
          const msg = typeof d.msg === "string" ? d.msg : JSON.stringify(d);
          return loc ? `${loc}: ${msg}` : msg;
        }
        return String(d);
      })
      .join("; ");
  }
  if (typeof detail === "object") return JSON.stringify(detail);
  return String(detail);
}

// --- Session exchange ----------------------------------------------------

export type SessionExchangeOut = {
  access_token: string;
  expires_in: number;
  role: string;
  org_id: number;
  tenant_slug: string;
  email: string;
};

/**
 * Resolve a console session. Two paths, tried in this order:
 *
 *   1. Local — an `sc_console_token` already in localStorage (from a prior
 *      session-exchange OR from the /console/login form). Validate by
 *      calling /api/tenant/me; on 200 we synthesize a SessionExchangeOut
 *      from the response and return it. On 401 we clear the stale token
 *      and fall through to path 2.
 *
 *   2. Dograh session bridge — when the user clicked a BILLING link in
 *      Dograh's sidebar, they're authenticated to Dograh but our console
 *      has no token yet. Dograh's `dograh_auth_token` cookie is HttpOnly
 *      (JS can't read it directly), so we ask Dograh's own
 *      `GET /api/auth/oss` route — a same-origin Next handler that reads
 *      the cookie server-side and returns `{ token, user }` as JSON.
 *      We forward that token to our gateway's /api/auth/session-exchange
 *      which validates it via Dograh's /api/v1/auth/me, looks up the
 *      tenant, and mints an sc_console_token.
 *
 * Returns null when neither path produces a session — caller should
 * direct the user to sign in (either via /console/login or Dograh).
 */
export async function ensureSession(): Promise<SessionExchangeOut | null> {
  if (typeof window === "undefined") return null;

  // Path 1 — existing console token. Covers the form-login path
  // (/console/login → /api/auth/login → setToken) which never goes
  // through session-exchange because Dograh's API login doesn't set
  // a session cookie.
  const existing = getToken();
  if (existing) {
    const me = await _meFromToken(existing);
    if (me) return me;
    // Stale / expired — drop it and try the cookie path.
    setToken(null);
  }

  // Path 2 — Dograh session bridge. Same-origin via nginx so the browser
  // automatically sends the cookie; Dograh's Next route reads it on the
  // server and returns the token as JSON. This is exactly how Dograh's
  // own LocalProviderWrapper bootstraps its in-memory token, so we don't
  // need to fight HttpOnly.
  let dograhToken: string | null = null;
  try {
    const ossRes = await fetch("/api/auth/oss", {
      credentials: "include",
    });
    if (ossRes.ok) {
      const body = (await ossRes.json()) as { token?: string };
      dograhToken = body.token ?? null;
    }
  } catch {
    // Network/CORS issue → fall through to null, caller renders the
    // "sign in to continue" card.
  }
  if (!dograhToken) return null;

  const res = await fetch(`${GATEWAY}/api/auth/session-exchange`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${dograhToken}`,
    },
  });
  if (!res.ok) return null;
  const body = (await res.json()) as SessionExchangeOut;
  setToken(body.access_token);
  return body;
}

/** Validate a token by calling /api/tenant/me. Returns a synthesized
 *  SessionExchangeOut shape so AuthGate can render without caring
 *  which path produced the session. */
async function _meFromToken(token: string): Promise<SessionExchangeOut | null> {
  try {
    const res = await fetch(`${GATEWAY}/api/tenant/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      user: { email: string; role: string; org_id: number };
      tenant: { slug: string };
    };
    // expires_in is informational only in the UI — we re-validate via
    // /me on every mount anyway, so a stale value is harmless.
    return {
      access_token: token,
      expires_in: 0,
      role: body.user.role,
      org_id: body.user.org_id,
      tenant_slug: body.tenant.slug,
      email: body.user.email,
    };
  } catch {
    return null;
  }
}

// --- Shared types + formatters --------------------------------------------

export const MICROS_PER_UNIT = 1_000_000;

export function microsToUsd(micros: number, digits = 2): string {
  const sign = micros < 0 ? "-" : "";
  return `${sign}$${(Math.abs(micros) / MICROS_PER_UNIT).toFixed(digits)}`;
}

export function centsToUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function makeRef(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// --- Organization Settings ----------------------------------------------

export type OrgPackageInfo = {
  id: number;
  slug: string;
  name: string;
  concurrency_included: number;
};

export type OrgSettings = {
  id: number;
  name: string;
  slug: string;
  owner_email: string;
  status: string;
  dograh_org_id: number | null;
  created_at: string;
  logo_url: string | null;
  favicon_url: string | null;
  concurrent_calls_limit: number | null;
  concurrent_calls_effective: number;
  auto_fallback_enabled: boolean;
  package: OrgPackageInfo | null;
  // Organization profile (migration 0024).
  company_phone: string | null;
  website: string | null;
  industry: string | null;
  company_size: string | null;
  country: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  about: string | null;
};

export type LoginOut = {
  access_token: string;
  expires_in: number;
  role: string;
  org_id: number;
  redirect: string;
};

// --- Public auth flows ----------------------------------------------------

export type VerifyOut = {
  access_token: string;
  expires_in: number;
  role: string;
  org_id: number;
  redirect: string;
};

export type InvitePreview = {
  tenant_name: string;
  email: string;
  role: string;
  expires_at: string;
};

export type AcceptInviteOut = {
  access_token: string;
  expires_in: number;
  role: string;
  org_id: number;
};

export type SignupIn = {
  email: string;
  password: string;
  full_name: string;
  workspace_name: string;
};

// --- Wallet + ledger + usage ----------------------------------------------

export type LedgerRow = {
  id: number;
  delta_micros: number;
  balance_after_micros: number;
  currency: string;
  reason: "charge" | "topup" | "refund" | "adjustment" | "coupon" | "auto_reload";
  ref_kind: string | null;
  ref_id: string | null;
  notes: string | null;
  created_at: string;
};

export type WalletSummary = {
  tenant_id: number;
  balance_micros: number;
  currency: string;
  auto_reload_enabled: boolean;
  auto_reload_threshold_micros: number;
  auto_reload_amount_micros: number;
  recent_ledger: LedgerRow[];
};

export type WalletRow = {
  currency: string;
  balance_micros: number;
  credit_limit_micros: number;
  auto_reload_enabled: boolean;
};

export type UsageRow = {
  id: number;
  external_ref: string;
  package_id: number | null;
  kind: string;
  unit: string;
  quantity_micros: number;
  raw_cost_micros: number;
  markup_micros: number;
  billed_micros: number;
  currency: string;
  cost_breakdown: Record<string, unknown>;
  occurred_at: string;
};

export type UsageDailyBucket = {
  day: string;
  call_count: number;
  quantity_micros: number;
  billed_micros: number;
};

// --- Payments / providers / methods ---------------------------------------

export type ProviderInfo = {
  slug: "stripe" | "paystack";
  configured: boolean;
  is_default: boolean;
  publishable_key: string;
};

export type PaymentMethod = {
  id: number;
  provider: "stripe" | "paystack";
  brand: string | null;
  last4: string | null;
  exp_month: number | null;
  exp_year: number | null;
  is_default: boolean;
  status: "active" | "revoked";
  created_at: string;
};

export type TopUpResult = {
  intent_id: number;
  provider: string;
  provider_ref: string;
  client_secret: string | null;
  authorization_url: string | null;
  amount_cents: number;
  currency: string;
};

export type CouponRedeemResult = {
  coupon_id: number;
  value_applied_micros: number;
  new_balance_micros: number;
};

// --- Plans ---------------------------------------------------------------

export type Plan = {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  kind: "payg" | "annual";
  billing_period:
    | "monthly"
    | "annual"
    | "usage"
    | "per_sec"
    | "per_min"
    | "per_hour"
    | "per_day"
    | "per_week";
  monthly_price_cents: number;
  bundled_minutes: number;
  overage_per_minute_micros: number;
  concurrency_included: number;
  currency: string;
  contact_sales: boolean;
  plugins: string[];
  allowed_provider_kinds: string[];
  usage_only: boolean;
  allowed_countries: string[];
};

export type PlansRes = {
  current_plan_id: number | null;
  plans: Plan[];
};

// --- Marketplace ----------------------------------------------------------

export type PluginPricingKind = "free" | "one_time" | "monthly" | "per_call";

export type CatalogEntry = {
  slug: string;
  name: string;
  description: string | null;
  vendor: string | null;
  icon_url: string | null;
  homepage_url: string | null;
  pricing_kind: PluginPricingKind;
  price_micros: number;
  currency: string;
  hooks: string[];
  required_scopes: string[];
};

export type InstallRow = {
  slug: string;
  name: string;
  status: "active" | "paused" | "failed";
  settings: Record<string, unknown>;
  installed_at: string;
  pricing_kind: PluginPricingKind;
  price_micros: number;
  currency: string;
};
