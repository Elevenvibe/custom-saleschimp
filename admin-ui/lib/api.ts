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
  if (!res.ok) throw new ApiError(res.status, body, body?.detail || res.statusText);
  return body as T;
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

export type Package = {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  monthly_price_cents: number;
  limits: Record<string, unknown>;
  plugins: string[];
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

export type ProviderKind = "llm" | "tts" | "stt" | "embedding" | "telephony";
export type PriceUnit =
  | "per_minute"
  | "per_input_token"
  | "per_output_token"
  | "per_character"
  | "per_call"
  | "per_request"
  | "per_1k_tokens"
  | "per_1k_chars";

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
