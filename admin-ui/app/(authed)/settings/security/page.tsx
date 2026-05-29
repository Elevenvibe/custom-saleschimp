"use client";

/**
 * Settings → Security. Two tabs:
 *   Two-Factor Authentication — email-code 2FA + Google Authenticator (TOTP)
 *   Google reCAPTCHA          — v2 / v3 site + secret keys
 *
 * 2FA is enforced on super-admin login (gateway auth/routes.py). reCAPTCHA
 * config is stored (secret encrypted); enforcement wiring is noted inline.
 */

import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import { PageDescription } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ShieldCheck, Smartphone, Mail } from "lucide-react";

export default function SecurityPage() {
  return (
    <div className="p-8 space-y-4 max-w-3xl">
      <div>
        <h2 className="text-lg font-semibold">Security</h2>
        <PageDescription>
          Harden your SalesChimp account across all ports.
        </PageDescription>
      </div>
      <Tabs defaultValue="2fa">
        <TabsList>
          <TabsTrigger value="2fa">Two-Factor Authentication</TabsTrigger>
          <TabsTrigger value="recaptcha">Google reCAPTCHA</TabsTrigger>
        </TabsList>
        <TabsContent value="2fa" className="pt-2">
          <TwoFactorTab />
        </TabsContent>
        <TabsContent value="recaptcha" className="pt-2">
          <RecaptchaTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

type Status = {
  email: string;
  totp_enabled: boolean;
  email_2fa_enabled: boolean;
  email_provider_configured: boolean;
};

function TwoFactorTab() {
  const [s, setS] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api<Status>("/api/admin/security").then(setS).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  if (!s) return <div className="text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-4">
      {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
      <EmailTwoFaCard status={s} onChanged={load} onError={setError} />
      <TotpCard status={s} onChanged={load} onError={setError} />
    </div>
  );
}

function EmailTwoFaCard({ status, onChanged, onError }: { status: Status; onChanged: () => void; onError: (s: string) => void }) {
  const [busy, setBusy] = useState(false);
  async function toggle(enabled: boolean) {
    setBusy(true); onError("");
    try {
      await api("/api/admin/security/email-2fa", { method: "POST", body: JSON.stringify({ enabled }) });
      onChanged();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="rounded-lg border bg-card p-5">
      <div className="flex items-start gap-3">
        <Mail className="size-5 text-muted-foreground" />
        <div className="flex-1">
          <div className="flex items-center gap-2 text-sm font-medium">
            Setup using Email
            {status.email_2fa_enabled && <Badge>enabled</Badge>}
          </div>
          {!status.email_provider_configured ? (
            <p className="mt-1 text-sm text-amber-600">
              Email SMTP settings not configured. Configure an email provider first.
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">
              Enabling this feature will send a code to <span className="font-medium">{status.email}</span> for log in.
            </p>
          )}
        </div>
        <Button
          variant={status.email_2fa_enabled ? "outline" : "default"}
          size="sm"
          disabled={busy || (!status.email_provider_configured && !status.email_2fa_enabled)}
          onClick={() => toggle(!status.email_2fa_enabled)}
        >
          {status.email_2fa_enabled ? "Disable" : "Enable"}
        </Button>
      </div>
    </section>
  );
}

function TotpCard({ status, onChanged, onError }: { status: Status; onChanged: () => void; onError: (s: string) => void }) {
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  async function init() {
    setBusy(true); onError("");
    try {
      const r = await api<{ secret: string; qr_svg_data_uri: string }>("/api/admin/security/totp/init", { method: "POST" });
      setSetup({ secret: r.secret, qr: r.qr_svg_data_uri });
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function enable() {
    setBusy(true); onError("");
    try {
      await api("/api/admin/security/totp/enable", { method: "POST", body: JSON.stringify({ code }) });
      setSetup(null); setCode(""); onChanged();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function disable() {
    const c = prompt("Enter a current authenticator code to disable TOTP:");
    if (!c) return;
    setBusy(true); onError("");
    try {
      await api("/api/admin/security/totp/disable", { method: "POST", body: JSON.stringify({ code: c }) });
      onChanged();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border bg-card p-5">
      <div className="flex items-start gap-3">
        <Smartphone className="size-5 text-muted-foreground" />
        <div className="flex-1">
          <div className="flex items-center gap-2 text-sm font-medium">
            Setup using Google Authenticator
            {status.totp_enabled && <Badge>enabled</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Use an authenticator app for free verification codes, even offline. Available for Android and iPhone.
          </p>
        </div>
        {status.totp_enabled ? (
          <Button variant="outline" size="sm" disabled={busy} onClick={disable}>Disable</Button>
        ) : !setup ? (
          <Button size="sm" disabled={busy} onClick={init}>Set up</Button>
        ) : null}
      </div>

      {setup && !status.totp_enabled && (
        <div className="mt-4 space-y-3 border-t pt-4">
          <p className="text-sm text-muted-foreground">
            Scan this QR with your authenticator app, or enter the key manually, then enter the 6-digit code to confirm.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={setup.qr} alt="TOTP QR" className="size-40 rounded border bg-white p-2" />
            <div className="text-xs">
              <div className="text-muted-foreground">Manual entry key</div>
              <code className="mt-1 block break-all rounded bg-muted px-2 py-1 font-mono">{setup.secret}</code>
            </div>
          </div>
          <div className="flex items-end gap-2">
            <div>
              <Label className="text-xs">6-digit code</Label>
              <Input className="w-40" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" maxLength={6} />
            </div>
            <Button disabled={busy || code.length < 6} onClick={enable}>Confirm & enable</Button>
            <Button variant="ghost" onClick={() => { setSetup(null); setCode(""); }}>Cancel</Button>
          </div>
        </div>
      )}
    </section>
  );
}

type Recaptcha = { enabled: boolean; version: "v2" | "v3"; site_key: string; has_secret: boolean };

function RecaptchaTab() {
  const [r, setR] = useState<Recaptcha | null>(null);
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  function load() {
    api<Recaptcha>("/api/admin/security/recaptcha").then(setR).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  async function save() {
    if (!r) return;
    setBusy(true); setError(null); setOk(null);
    try {
      const body: Record<string, unknown> = { enabled: r.enabled, version: r.version, site_key: r.site_key };
      if (secret) body.secret_key = secret;
      await api("/api/admin/security/recaptcha", { method: "PUT", body: JSON.stringify(body) });
      setSecret("");
      setOk("Saved.");
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!r) return <div className="text-sm text-muted-foreground">Loading…</div>;

  return (
    <section className="rounded-lg border bg-card p-5 space-y-4 max-w-xl">
      <div className="flex items-center gap-2 text-sm font-medium">
        <ShieldCheck className="size-4 text-muted-foreground" /> Google reCAPTCHA
      </div>
      {ok && <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{ok}</div>}
      {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}

      <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
        <input type="checkbox" className="peer sr-only" checked={r.enabled} onChange={(e) => setR({ ...r, enabled: e.target.checked })} />
        <span className="relative inline-block h-5 w-9 rounded-full bg-muted transition peer-checked:bg-primary">
          <span className="absolute left-0.5 top-0.5 inline-block size-4 rounded-full bg-background transition peer-checked:translate-x-4" />
        </span>
        Enable reCAPTCHA
      </label>

      <div>
        <Label className="text-xs">Version</Label>
        <Select value={r.version} onValueChange={(v) => setR({ ...r, version: v as "v2" | "v3" })}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="v2">v2 (checkbox)</SelectItem>
            <SelectItem value="v3">v3 (score)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-xs">Site key</Label>
        <Input value={r.site_key} onChange={(e) => setR({ ...r, site_key: e.target.value })} placeholder="6Lc..." />
      </div>
      <div>
        <Label className="text-xs">Secret key {r.has_secret && <span className="text-muted-foreground">(configured — leave blank to keep)</span>}</Label>
        <Input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={r.has_secret ? "••••••••" : "6Lc..."} />
      </div>

      <div className="rounded-md bg-muted/30 p-3 text-xs text-muted-foreground">
        Get keys at <span className="font-medium">google.com/recaptcha/admin</span>: register your domain, pick v2
        (&quot;I&apos;m not a robot&quot;) or v3 (invisible score), and copy the Site key + Secret key here.
      </div>

      <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save reCAPTCHA"}</Button>
    </section>
  );
}
