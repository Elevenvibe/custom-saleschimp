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
  if (!res.ok) throw new ApiError(res.status, body, body?.detail || res.statusText);
  return body as T;
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

export type TenantInvite = {
  id: number;
  tenant_id: number;
  email: string;
  role: string;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
};
