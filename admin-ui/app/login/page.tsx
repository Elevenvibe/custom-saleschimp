"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, GATEWAY, setToken, type LoginIn, type LoginOut } from "@/lib/api";
import { Recaptcha, type RecaptchaHandle } from "@/components/Recaptcha";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("admin@mysaleschimp.com");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 2FA second step.
  const [stage, setStage] = useState<"credentials" | "code">("credentials");
  const [methods, setMethods] = useState<string[]>([]);
  const [code, setCode] = useState("");
  const recaptchaRef = useRef<RecaptchaHandle>(null);

  async function attempt(withCode?: string) {
    setError(null);
    setBusy(true);
    try {
      const body: LoginIn = { email, password };
      if (withCode) body.code = withCode;
      else {
        // reCAPTCHA only on the first (credentials) step.
        const token = await recaptchaRef.current?.execute();
        if (token) body.recaptcha_token = token;
      }
      const r = await api<LoginOut>("/api/auth/super-admin/login", {
        method: "POST",
        body: JSON.stringify(body),
        auth: false,
      });
      if (r.requires_2fa) {
        setMethods(r.methods ?? []);
        setStage("code");
        return;
      }
      if (r.access_token) {
        setToken(r.access_token);
        router.replace("/dashboard");
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.status === 401 ? (stage === "code" ? "Invalid or expired code" : "Invalid credentials") : err.message);
      } else {
        setError("Login failed");
      }
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (stage === "credentials") await attempt();
    else await attempt(code);
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
            disabled={stage === "code"}
            required
          />
        </div>
        {stage === "code" && (
          <div>
            <label className="label" htmlFor="code">
              Verification code
            </label>
            <input
              id="code"
              className="input"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="6-digit code"
              autoFocus
              required
            />
            <p className="mt-1 text-xs text-slate-500">
              {methods.includes("totp") && methods.includes("email")
                ? "Enter the code from your authenticator app or the one emailed to you."
                : methods.includes("totp")
                  ? "Enter the code from your authenticator app."
                  : "Enter the code we emailed you."}
            </p>
          </div>
        )}
        {stage === "credentials" && <Recaptcha ref={recaptchaRef} gateway={GATEWAY} action="login" />}
        {error && (
          <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? "Signing in…" : stage === "code" ? "Verify & sign in" : "Sign in"}
        </button>
        {stage === "code" && (
          <button
            type="button"
            className="w-full text-center text-xs text-slate-500 hover:underline"
            onClick={() => { setStage("credentials"); setCode(""); setError(null); }}
          >
            Back
          </button>
        )}
      </form>
    </div>
  );
}
