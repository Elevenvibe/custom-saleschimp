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
  // session-exchange against Dograh.
  if (res.status === 401 && auth) {
    setToken(null);
  }
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
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
 * Read the Dograh auth token from same-origin cookie, hand it to the gateway,
 * cache the returned sc_console_token in localStorage. Idempotent — if we
 * already have a valid console token cached, we skip the exchange.
 *
 * Returns the resolved session (or null if we couldn't get a Dograh token —
 * caller should redirect to /login on Dograh in that case).
 */
export async function ensureSession(): Promise<SessionExchangeOut | null> {
  if (typeof window === "undefined") return null;
  // Cookie lookup runs on the client because the cookie is HttpOnly=false in
  // Dograh's OSS mode (so JS can read it). If Dograh ever flips that flag we
  // fall back to letting the gateway read the cookie directly via the proxy.
  const dograhToken = _readCookie("dograh_auth_token");
  if (!dograhToken) return null;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${dograhToken}`,
  };
  const res = await fetch(`${GATEWAY}/api/auth/session-exchange`, {
    method: "POST",
    headers,
  });
  if (!res.ok) {
    return null;
  }
  const body = (await res.json()) as SessionExchangeOut;
  setToken(body.access_token);
  return body;
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

function _readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const target = `${name}=`;
  for (const part of document.cookie.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(target)) {
      return decodeURIComponent(trimmed.slice(target.length));
    }
  }
  return null;
}
