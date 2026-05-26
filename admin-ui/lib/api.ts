// Tiny typed client over the gateway's /api/admin/* surface.

export const GATEWAY = process.env.NEXT_PUBLIC_GATEWAY_URL || "http://localhost:8080";

export class ApiError extends Error {
  constructor(public status: number, public body: unknown, message: string) {
    super(message);
  }
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("sc_token");
}

export function setToken(token: string | null) {
  if (typeof window === "undefined") return;
  if (token) localStorage.setItem("sc_token", token);
  else localStorage.removeItem("sc_token");
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

// --- Typed surfaces ---

export type LoginIn = { email: string; password: string };
export type LoginOut = { access_token: string; token_type: string; expires_in: number; role: string };

export type AuditRow = {
  id: number;
  actor_kind: string;
  actor_user_id: number | null;
  action: string;
  target_kind: string | null;
  target_id: string | null;
  payload?: Record<string, unknown>;
  ip: string | null;
  ua?: string | null;
  created_at: string;
};

export type Dashboard = {
  counts: { tenants: number; platform_users: number; packages: number; installed_plugins: number };
  recent_audit: AuditRow[];
};

export type Tenant = {
  id: number;
  dograh_org_id: number | null;
  name: string;
  slug: string;
  owner_email: string;
  status: string;
  created_at: string;
};

export type PlatformUser = {
  id: number;
  email: string;
  role: string;
  created_at: string;
  last_login_at: string | null;
};

export type PackageKind = "payg" | "annual";
export type BillingPeriod =
  | "monthly"
  | "annual"
  | "usage"
  | "per_sec"
  | "per_min"
  | "per_hour"
  | "per_day"
  | "per_week";

export type Package = {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  kind: PackageKind;
  billing_period: BillingPeriod;
  monthly_price_cents: number;
  bundled_minutes: number;
  overage_per_minute_micros: number;
  concurrency_included: number;
  currency: string;
  contact_sales: boolean;
  visible: boolean;
  plugins: string[];
  /** Provider kinds tenants on this package can use. Empty = no restriction. */
  allowed_provider_kinds: ProviderKind[];
  /** Per-kind override of which markup rule to apply. */
  markup_rule_ids: Record<string, number>;
  /** When true, the billing engine factors `markup_rule_ids` into billed cost. */
  apply_markup: boolean;
  /** When true, the recurring `monthly_price_cents` is forced to 0 — pure PAYG. */
  usage_only: boolean;
  /** ISO 3166-1 alpha-2 codes this pricing applies to. Empty = all countries. */
  allowed_countries: string[];
  created_at: string;
};

export type InstalledPlugin = {
  plugin_id: string;
  version: string;
  status: string;
  manifest: Record<string, unknown>;
  installed_at: string;
  updated_at: string;
};

export type EmailProvider = {
  id: number;
  scope_kind: "platform" | "tenant";
  scope_id: number | null;
  provider: "resend" | "ses" | "postmark" | "smtp";
  from_email: string;
  from_name: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type AdminInvite = {
  id: number;
  tenant_id: number;
  tenant_name: string;
  tenant_slug: string;
  email: string;
  role: string;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
  state: "pending" | "accepted" | "expired";
};

export type AdminInvitesRes = { total: number; items: AdminInvite[] };

// --- P2.A1 — Cost catalog ------------------------------------------------

export type ProviderKind =
  | "llm"
  | "tts"
  | "stt"
  | "embedding"
  | "telephony"
  | "phone_number";
export type PriceUnit =
  | "per_minute"
  | "per_input_token"
  | "per_output_token"
  | "per_character"
  | "per_call"
  | "per_request"
  | "per_1k_tokens"
  | "per_1k_chars"
  | "per_month";

export type CostProvider = {
  id: number;
  kind: ProviderKind;
  slug: string;
  name: string;
  currency: string;
  notes: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type CostProviderPrice = {
  id: number;
  cost_provider_id: number;
  unit: PriceUnit;
  variant: string | null;
  price_micros: number;
  currency: string;
  effective_at: string;
  notes: string | null;
};

export type IntegratedModelPrice = { unit: PriceUnit; price_micros: number };
export type IntegratedModel = {
  variant: string;
  label: string;
  prices: IntegratedModelPrice[];
};

export type IntegratedProvider = {
  slug: string;
  name: string;
  homepage: string;
  models: IntegratedModel[];
};

export type IntegratedCatalog = Record<ProviderKind, IntegratedProvider[]>;

export type AvailableModel = {
  variant: string;
  label: string | null;
  source: "live" | "catalog";
};

export type AvailableModelsRes = {
  source: "live" | "catalog";
  models: AvailableModel[];
  notes: string | null;
};

export type SyncPricesRes = {
  upserted: number;
  skipped: number;
  notes: string | null;
};

export type CredentialsStatus = { configured: boolean };

export type Country = { code: string; name: string };

export type PriceSyncStatus = {
  enabled: boolean;
  interval_seconds: number;
  running: boolean;
  last_run_at: string | null;
  last_providers: number;
  last_upserted: number;
  last_skipped: number;
};

export type PriceSyncRunRes = {
  providers: number;
  upserted: number;
  skipped: number;
};

export type MarkupRule = {
  id: number;
  scope_kind: "global" | "kind" | "tenant";
  scope_value: string | null;
  markup_kind: "percentage" | "fixed_per_minute" | "fixed_per_unit";
  value_micros: number;
  currency: string;
  priority: number;
  active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
};
