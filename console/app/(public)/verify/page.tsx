"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { api, setToken, type VerifyOut } from "@/lib/api";
import { AuthShell } from "@/components/AuthShell";

/**
 * Landing for signup email verification links. Reads `?token=` from the
 * query string, posts it to the gateway's /api/auth/verify, stashes the
 * returned customer JWT, and bounces to /console.
 *
 * Wraps the inner reader in <Suspense> because Next requires it whenever
 * useSearchParams() is called from a client page.
 */
export default function VerifyPage() {
  return (
    <Suspense fallback={<AuthShell title="Verifying…">Loading.</AuthShell>}>
      <Inner />
    </Suspense>
  );
}

function Inner() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError("No verification token in this link.");
      return;
    }
    api<VerifyOut>(`/api/auth/verify?token=${encodeURIComponent(token)}`, { auth: false })
      .then((r) => {
        setToken(r.access_token);
        // basePath in next.config.ts; targets are without the prefix.
        router.replace("/");
      })
      .catch((e) => setError((e as Error).message));
  }, [token, router]);

  if (error) {
    return (
      <AuthShell title="Couldn't verify" subtitle="The link may be expired or already used.">
        <div className="text-sm text-red-700 bg-red-50 rounded-md px-3 py-2">{error}</div>
      </AuthShell>
    );
  }
  return <AuthShell title="Verifying…" subtitle="One moment, signing you in." children={null} />;
}
