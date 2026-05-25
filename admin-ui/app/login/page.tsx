"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, setToken, type LoginIn, type LoginOut } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("admin@mysaleschimp.com");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const body: LoginIn = { email, password };
      const r = await api<LoginOut>("/api/auth/super-admin/login", {
        method: "POST",
        body: JSON.stringify(body),
        auth: false,
      });
      setToken(r.access_token);
      router.replace("/dashboard");
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.status === 401 ? "Invalid credentials" : err.message);
      } else {
        setError("Login failed");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <form onSubmit={submit} className="card w-full max-w-sm card-pad space-y-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">SalesChimp Admin</h1>
          <p className="text-sm text-slate-500">Super-admin sign-in</p>
        </div>
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input
            id="email"
            className="input"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input
            id="password"
            className="input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {error && (
          <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
