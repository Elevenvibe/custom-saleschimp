"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { api, setToken, type VerifyOut } from "@/lib/api";
import { AuthShell } from "@/components/AuthShell";

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
        router.replace(r.redirect || "/dashboard");
      })
      .catch((e) => setError(e.message));
  }, [token, router]);

  if (error) {
    return (
      <AuthShell title="Verification failed" subtitle={error}>
        <p className="text-sm text-muted-foreground">
          The link may have expired, already been used, or been mistyped.
          Try signing up again or contact your team admin.
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Verifying your email…" subtitle="Almost there.">
      <p className="text-sm text-muted-foreground">
        We&apos;re creating your workspace and getting you signed in.
      </p>
    </AuthShell>
  );
}
