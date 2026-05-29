"use client";

/**
 * Settings → Notifications.
 *
 * Three concerns on one page:
 *   1. Routing — master "send to tenants / super-admins" toggles plus a
 *      per-type channel matrix (Bell / Email / WhatsApp). Saved together
 *      via PUT /api/admin/notification-settings.
 *   2. Pusher Channels + Beams — real-time delivery credentials (secrets
 *      write-only; never returned). The bell subscribes to Channels for
 *      live updates; Beams powers web push.
 *   3. WhatsApp Cloud API — phone number id + access token for WhatsApp
 *      delivery on types where that channel is enabled.
 */

import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Channels = { bell: boolean; email: boolean; whatsapp: boolean };
type TypeRow = {
  key: string;
  label: string;
  description: string;
  audience: "platform" | "tenant";
  channels: Channels;
};
type Snapshot = {
  send_to_tenants: boolean;
  send_to_admins: boolean;
  types: TypeRow[];
  pusher: { enabled: boolean; app_id: string; key: string; cluster: string; has_secret: boolean };
  beams: { enabled: boolean; instance_id: string; has_secret: boolean };
  whatsapp: { enabled: boolean; phone_number_id: string; has_token: boolean };
};

export default function NotificationSettingsPage() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<Snapshot>("/api/admin/notification-settings")
      .then(setData)
      .catch((e) => setError((e as Error).message));
  }, []);
  useEffect(load, [load]);

  if (error) {
    return (
      <div className="p-8">
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      </div>
    );
  }
  if (!data) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-8">
      <header>
        <h1 className="text-xl font-semibold">Notifications</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Control who gets notified, through which channels, and configure the
          real-time + messaging providers.
        </p>
      </header>

      <RoutingCard data={data} onSaved={load} />
      <PusherCard data={data} onSaved={load} />
      <BeamsCard data={data} onSaved={load} />
      <WhatsAppCard data={data} onSaved={load} />
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="inline-flex cursor-pointer items-center">
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="relative inline-block h-5 w-9 rounded-full bg-muted transition peer-checked:bg-primary">
        <span className="absolute left-0.5 top-0.5 inline-block size-4 rounded-full bg-background transition peer-checked:translate-x-4" />
      </span>
    </label>
  );
}

function RoutingCard({ data, onSaved }: { data: Snapshot; onSaved: () => void }) {
  const [toTenants, setToTenants] = useState(data.send_to_tenants);
  const [toAdmins, setToAdmins] = useState(data.send_to_admins);
  const [types, setTypes] = useState<TypeRow[]>(data.types);
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function setChannel(key: string, ch: keyof Channels, v: boolean) {
    setTypes((rows) =>
      rows.map((r) => (r.key === key ? { ...r, channels: { ...r.channels, [ch]: v } } : r)),
    );
    setOk(null);
  }

  async function save() {
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      const matrix: Record<string, Channels> = {};
      for (const t of types) matrix[t.key] = t.channels;
      await api("/api/admin/notification-settings", {
        method: "PUT",
        body: JSON.stringify({
          send_to_tenants: toTenants,
          send_to_admins: toAdmins,
          types: matrix,
        }),
      });
      setOk("Saved.");
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4 rounded-lg border bg-card p-6">
      <h2 className="text-sm font-medium">Routing</h2>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium">Send notifications to tenants</div>
            <p className="text-xs text-muted-foreground">
              Master switch for every tenant-facing notification.
            </p>
          </div>
          <Toggle checked={toTenants} onChange={(v) => { setToTenants(v); setOk(null); }} />
        </div>
        <div className="flex items-center justify-between gap-4 border-t pt-3">
          <div>
            <div className="text-sm font-medium">Send notifications to super-admins</div>
            <p className="text-xs text-muted-foreground">
              Master switch for every platform-team notification.
            </p>
          </div>
          <Toggle checked={toAdmins} onChange={(v) => { setToAdmins(v); setOk(null); }} />
        </div>
      </div>

      <div className="overflow-hidden rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Notification type</th>
              <th className="px-3 py-2 text-center">Bell</th>
              <th className="px-3 py-2 text-center">Email</th>
              <th className="px-3 py-2 text-center">WhatsApp</th>
            </tr>
          </thead>
          <tbody>
            {types.map((t) => (
              <tr key={t.key} className="border-t align-top">
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{t.label}</span>
                    <Badge variant="secondary" className="text-[10px]">
                      {t.audience === "platform" ? "Admin" : "Tenant"}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">{t.description}</div>
                </td>
                {(["bell", "email", "whatsapp"] as const).map((ch) => (
                  <td key={ch} className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={t.channels[ch]}
                      onChange={(e) => setChannel(t.key, ch, e.target.checked)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {err && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</div>}
      {ok && <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{ok}</div>}
      <div className="flex justify-end">
        <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save routing"}</Button>
      </div>
    </section>
  );
}

function ProviderShell({
  title,
  description,
  enabled,
  onToggle,
  children,
  onSave,
  busy,
  ok,
  err,
}: {
  title: string;
  description: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  children: React.ReactNode;
  onSave: () => void;
  busy: boolean;
  ok: string | null;
  err: string | null;
}) {
  return (
    <section className="space-y-4 rounded-lg border bg-card p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-medium">{title}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
        <Toggle checked={enabled} onChange={onToggle} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
      {err && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</div>}
      {ok && <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{ok}</div>}
      <div className="flex justify-end">
        <Button onClick={onSave} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
      </div>
    </section>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  full,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  full?: boolean;
}) {
  return (
    <div className={full ? "sm:col-span-2" : undefined}>
      <Label>{label}</Label>
      <Input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

function PusherCard({ data, onSaved }: { data: Snapshot; onSaved: () => void }) {
  const [enabled, setEnabled] = useState(data.pusher.enabled);
  const [appId, setAppId] = useState(data.pusher.app_id);
  const [key, setKey] = useState(data.pusher.key);
  const [cluster, setCluster] = useState(data.pusher.cluster);
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true); setErr(null); setOk(null);
    try {
      await api("/api/admin/notification-settings/pusher", {
        method: "PUT",
        body: JSON.stringify({
          enabled, app_id: appId, key, cluster,
          ...(secret ? { secret } : {}),
        }),
      });
      setOk("Saved."); setSecret(""); onSaved();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <ProviderShell
      title="Pusher Channels (real-time bell)"
      description="Pushes a live nudge so the bell updates without waiting for the 30s poll. Public key + cluster are sent to the browser; the secret stays server-side."
      enabled={enabled}
      onToggle={(v) => { setEnabled(v); setOk(null); }}
      onSave={save} busy={busy} ok={ok} err={err}
    >
      <TextField label="App ID" value={appId} onChange={setAppId} placeholder="1234567" />
      <TextField label="Cluster" value={cluster} onChange={setCluster} placeholder="mt1" />
      <TextField label="Key (public)" value={key} onChange={setKey} placeholder="a1b2c3…" />
      <TextField
        label={data.pusher.has_secret ? "Secret (leave blank to keep)" : "Secret"}
        value={secret} onChange={setSecret} type="password" placeholder="••••••••"
      />
    </ProviderShell>
  );
}

function BeamsCard({ data, onSaved }: { data: Snapshot; onSaved: () => void }) {
  const [enabled, setEnabled] = useState(data.beams.enabled);
  const [instanceId, setInstanceId] = useState(data.beams.instance_id);
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true); setErr(null); setOk(null);
    try {
      await api("/api/admin/notification-settings/beams", {
        method: "PUT",
        body: JSON.stringify({ enabled, instance_id: instanceId, ...(secret ? { secret } : {}) }),
      });
      setOk("Saved."); setSecret(""); onSaved();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <ProviderShell
      title="Pusher Beams (web push)"
      description="Delivers OS-level push notifications to subscribed browsers, even when the app tab is closed."
      enabled={enabled}
      onToggle={(v) => { setEnabled(v); setOk(null); }}
      onSave={save} busy={busy} ok={ok} err={err}
    >
      <TextField label="Instance ID" value={instanceId} onChange={setInstanceId} placeholder="xxxxxxxx-xxxx-…" full />
      <TextField
        label={data.beams.has_secret ? "Secret key (leave blank to keep)" : "Secret key"}
        value={secret} onChange={setSecret} type="password" placeholder="••••••••" full
      />
    </ProviderShell>
  );
}

function WhatsAppCard({ data, onSaved }: { data: Snapshot; onSaved: () => void }) {
  const [enabled, setEnabled] = useState(data.whatsapp.enabled);
  const [phoneNumberId, setPhoneNumberId] = useState(data.whatsapp.phone_number_id);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true); setErr(null); setOk(null);
    try {
      await api("/api/admin/notification-settings/whatsapp", {
        method: "PUT",
        body: JSON.stringify({ enabled, phone_number_id: phoneNumberId, ...(token ? { token } : {}) }),
      });
      setOk("Saved."); setToken(""); onSaved();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <ProviderShell
      title="WhatsApp (Cloud API)"
      description="Sends WhatsApp messages via Meta's Cloud API for notification types with the WhatsApp channel enabled. Uses the recipient's saved phone number."
      enabled={enabled}
      onToggle={(v) => { setEnabled(v); setOk(null); }}
      onSave={save} busy={busy} ok={ok} err={err}
    >
      <TextField label="Phone number ID" value={phoneNumberId} onChange={setPhoneNumberId} placeholder="1029384756" full />
      <TextField
        label={data.whatsapp.has_token ? "Access token (leave blank to keep)" : "Access token"}
        value={token} onChange={setToken} type="password" placeholder="••••••••" full
      />
    </ProviderShell>
  );
}
