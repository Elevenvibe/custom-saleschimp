"use client";

import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Channels = { bell: boolean; email: boolean; whatsapp: boolean };
type Row = {
  key: string;
  label: string;
  description: string;
  audience: string;
  channels: Channels;
};
type Cfg = { send_to_me: boolean; types: Row[] };

export default function NotificationsPage() {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    api<Cfg>("/api/tenant/settings/notifications").then(setCfg).catch((e) => setErr((e as Error).message));
  }, []);
  useEffect(load, [load]);

  function setCh(key: string, ch: keyof Channels, v: boolean) {
    if (!cfg) return;
    setCfg({ ...cfg, types: cfg.types.map((r) => (r.key === key ? { ...r, channels: { ...r.channels, [ch]: v } } : r)) });
    setOk(null);
  }

  async function save() {
    if (!cfg) return;
    setBusy(true); setErr(null); setOk(null);
    try {
      const matrix: Record<string, Channels> = {};
      for (const t of cfg.types) matrix[t.key] = t.channels;
      const r = await api<Cfg>("/api/tenant/settings/notifications", {
        method: "PUT",
        body: JSON.stringify({ send_to_me: cfg.send_to_me, types: matrix }),
      });
      setCfg(r); setOk("Saved.");
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  if (!cfg) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-8">
      <header>
        <h1 className="text-xl font-semibold">Notifications</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pick which channels you want for each event. Defaults come from your
          platform admin&apos;s settings — you can override them here.
        </p>
      </header>

      <section className="space-y-4 rounded-lg border bg-card p-6">
        <label className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium">Send notifications to my workspace</div>
            <p className="text-xs text-muted-foreground">Master switch — turn off to silence every channel.</p>
          </div>
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={cfg.send_to_me}
            onChange={(e) => { setCfg({ ...cfg, send_to_me: e.target.checked }); setOk(null); }}
          />
        </label>

        <div className="overflow-hidden rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2 text-center">Bell</th>
                <th className="px-3 py-2 text-center">Email</th>
                <th className="px-3 py-2 text-center">WhatsApp</th>
              </tr>
            </thead>
            <tbody>
              {cfg.types.map((t) => (
                <tr key={t.key} className="border-t align-top">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2 font-medium">
                      {t.label}
                      <Badge variant="secondary" className="text-[10px]">{t.audience}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">{t.description}</div>
                  </td>
                  {(["bell", "email", "whatsapp"] as const).map((ch) => (
                    <td key={ch} className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        checked={t.channels[ch]}
                        onChange={(e) => setCh(t.key, ch, e.target.checked)}
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
          <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        </div>
      </section>
    </div>
  );
}
