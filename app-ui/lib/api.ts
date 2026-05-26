// Customer-side typed client over the gateway's /api/auth/* and /api/tenant/* surface.

export const GATEWAY = process.env.NEXT_PUBLIC_GATEWAY_URL || "http://localhost:8080";

export class ApiError extends Error {
  constructor(public status: number, public body: unknown, message: string) {
    super(message);
  }
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("sc_customer_token");
}

export function setToken(token: string | null) {
  if (typeof window === "undefined") return;
  if (token) localStorage.setItem("sc_customer_token", token);
  else localStorage.removeItem("sc_customer_token");
}

export async function api<T = unknown>(
  path: string,
  init: RequestInit & { auth?: boolean } = {},
): Promise<T> {
  const { auth = true, headers, ...rest } = init;
  const h: Record<string, string> = { "Content-Type": "application/json", ...(headers as Record<string, string>) };
  if (auth) {
    const token = getToken();
    if (token) h.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${GATEWAY}${path}`, { ...rest, headers: h });
  if (res.status === 401 && auth) {
    setToken(null);
    if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
      window.location.href = "/login";
    }
  }
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, body, _formatDetail(body?.detail) || res.statusText);
  return body as T;
}

/** Normalize FastAPI/Pydantic's `detail` field into a readable message.
 *  - string → returned as-is
 *  - array (Pydantic validation errors) → join the `msg` (+ field) of each
 *  - other shapes → JSON.stringify so we never show "[object Object]"
 */
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

// --- Types matching the gateway's contracts -------------------------------

export type LoginOut = {
  access_token: string;
  expires_in: number;
  role: string;
  org_id: number;
  redirect: string;
};

export type VerifyOut = {
  tenant_id: number;
  dograh_org_id: number;
  dograh_user_id: number;
  access_token: string;
  expires_in: number;
  role: string;
  redirect: string;
};

export type InvitePreview = {
  email: string;
  role: string;
  tenant_name: string;
  invited_by_email: string | null;
};

export type AcceptInviteOut = {
  access_token: string;
  expires_in: number;
  role: string;
  redirect: string;
};

export type TenantInfo = {
  id: number;
  name: string;
  slug: string;
  owner_email: string;
  status: string;
  dograh_org_id: number | null;
  onboarding_completed: boolean;
  created_at: string;
};

export type Me = {
  user: { id: number | null; email: string; role: string; org_id: number | null };
  tenant: TenantInfo;
  members: {
    id: number;
    email: string;
    role: string;
    dograh_user_id: number | null;
    joined_at: string;
  }[];
};

export type Plan = {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  kind: "payg" | "annual";
  billing_period: "monthly" | "annual" | "usage";
  monthly_price_cents: number;
  bundled_minutes: number;
  overage_per_minute_micros: number;
  concurrency_included: number;
  currency: string;
  contact_sales: boolean;
  plugins: string[];
};

export type PlansRes = {
  current_plan_id: number | null;
  plans: Plan[];
};

export type TenantInvite = {
  id: number;
  tenant_id: number;
  email: string;
  role: string;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
};

// --- P2.A3 — Wallet / usage / payments ----------------------------------

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

// One row per currency the tenant holds. Returned by /api/tenant/wallets
// (plural). Use this for the multi-currency balance cards on /billing;
// WalletSummary stays the canonical shape for the single-currency
// detail view (with ledger).
export type WalletRow = {
  currency: string;
  balance_micros: number;
  credit_limit_micros: number;
  auto_reload_enabled: boolean;
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

export type ProviderInfo = {
  slug: "stripe" | "paystack";
  configured: boolean;
  is_default: boolean;
  /** Publishable / public key, shipped to the browser for Stripe
   *  Elements / Paystack inline. Empty when the provider isn't
   *  configured or doesn't use a public key. */
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

export const MICROS_PER_UNIT = 1_000_000;

export function microsToUsd(micros: number, digits = 2): string {
  const sign = micros < 0 ? "-" : "";
  return `${sign}$${(Math.abs(micros) / MICROS_PER_UNIT).toFixed(digits)}`;
}

export function centsToUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
