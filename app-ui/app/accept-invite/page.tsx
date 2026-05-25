"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import {
  api,
  ApiError,
  setToken,
  type AcceptInviteOut,
  type InvitePreview,
} from "@/lib/api";
import { AuthShell } from "@/components/AuthShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={<AuthShell title="Loading…">Please wait.</AuthShell>}>
      <Inner />
    </Suspense>
  );
}

function Inner() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token");

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setPreviewError("No invite token in this link.");
      return;
    }
    api<InvitePreview>(`/api/auth/invites/${encodeURIComponent(token)}/preview`, { auth: false })
      .then(setPreview)
      .catch((e) => setPreviewError(e.message));
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<AcceptInviteOut>("/api/auth/accept-invite", {
        method: "POST",
        body: JSON.stringify({ token, password, full_name: fullName }),
        auth: false,
      });
      setToken(r.access_token);
      router.replace(r.redirect || "/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (previewError) {
    return (
      <AuthShell title="Invitation problem" subtitle={previewError}>
        <p className="text-sm text-muted-foreground">
          The link may have expired or already been used. Ask the inviter to send a new one.
        </p>
      </AuthShell>
    );
  }
  if (!preview) {
    return <AuthShell title="Loading invitation…">Please wait.</AuthShell>;
  }

  return (
    <AuthShell
      title={`Join ${preview.tenant_name}`}
      subtitle={
        preview.invited_by_email
          ? `${preview.invited_by_email} invited you as ${preview.role.replace("_", " ")}.`
          : `You've been invited as ${preview.role.replace("_", " ")}.`
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <div>
          <Label>Inviter</Label>
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
            {preview.email} · <Badge variant="secondary">{preview.role}</Badge>
          </div>
        </div>
        <div>
          <Label htmlFor="full_name">Your name</Label>
          <Input id="full_name" value={fullName} onChange={(e) => setFullName(e.target.value)} required maxLength={128} />
        </div>
        <div>
          <Label htmlFor="password">Choose a password (min 8 chars)</Label>
          <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
        </div>
        {error && (
          <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
        )}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Joining…" : "Accept invitation"}
        </Button>
      </form>
    </AuthShell>
  );
}
