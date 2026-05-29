"use client";

/**
 * Settings → Storage.
 *
 * Dograh stores user files (call recordings, audio) on one platform-wide
 * storage backend, configured via environment variables read at process
 * start. This page is the control-plane home for that config: pick a backend
 * (S3 or MinIO; GCS/Azure are on Dograh's roadmap), enter its keys (secret
 * write-only, encrypted at rest), validate connectivity, and copy the exact
 * env-var block to apply to the Dograh service.
 *
 * Applying = set the env + restart Dograh. Live propagation (Dograh reading
 * this config from the control DB) is a documented follow-up.
 */

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, HardDrive, Loader2 } from "lucide-react";

import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type CatalogItem = { key: string; name: string; description: string; available: boolean };
type Snapshot = {
  backend: "s3" | "minio";
  catalog: CatalogItem[];
  s3: { bucket: string; region: string; access_key_id: string; has_secret: boolean };
  minio: {
    endpoint: string;
    public_endpoint: string;
    bucket: string;
    access_key: string;
    secure: boolean;
    has_secret: boolean;
  };
  env_preview: Record<string, string>;
};

export default function StorageSettingsPage() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<Snapshot>("/api/admin/storage-settings")
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

  return <StorageForm key={JSON.stringify(data.env_preview)} data={data} onSaved={load} />;
}

function StorageForm({ data, onSaved }: { data: Snapshot; onSaved: () => void }) {
  const [backend, setBackend] = useState<"s3" | "minio">(data.backend);

  // S3 fields
  const [s3Bucket, setS3Bucket] = useState(data.s3.bucket);
  const [s3Region, setS3Region] = useState(data.s3.region);
  const [s3Key, setS3Key] = useState(data.s3.access_key_id);
  const [s3Secret, setS3Secret] = useState("");

  // MinIO fields
  const [mEndpoint, setMEndpoint] = useState(data.minio.endpoint);
  const [mPublic, setMPublic] = useState(data.minio.public_endpoint);
  const [mBucket, setMBucket] = useState(data.minio.bucket);
  const [mKey, setMKey] = useState(data.minio.access_key);
  const [mSecret, setMSecret] = useState("");
  const [mSecure, setMSecure] = useState(data.minio.secure);

  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; detail: string } | null>(null);

  async function save() {
    setBusy(true);
    setErr(null);
    setOk(null);
    setTestResult(null);
    try {
      const body: Record<string, unknown> = { backend };
      if (backend === "s3") {
        body.s3 = {
          bucket: s3Bucket,
          region: s3Region,
          access_key_id: s3Key,
          ...(s3Secret ? { secret_access_key: s3Secret } : {}),
        };
      } else {
        body.minio = {
          endpoint: mEndpoint,
          public_endpoint: mPublic,
          bucket: mBucket,
          access_key: mKey,
          secure: mSecure,
          ...(mSecret ? { secret_key: mSecret } : {}),
        };
      }
      await api("/api/admin/storage-settings", { method: "PUT", body: JSON.stringify(body) });
      setOk("Saved. Apply the env-var block below to Dograh and restart it for the change to take effect.");
      setS3Secret("");
      setMSecret("");
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setTesting(true);
    setTestResult(null);
    setErr(null);
    try {
      const r = await api<{ ok: boolean; detail: string }>("/api/admin/storage-settings/test", {
        method: "POST",
      });
      setTestResult(r);
    } catch (e) {
      setTestResult({ ok: false, detail: (e as Error).message });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-8">
      <header>
        <h1 className="text-xl font-semibold">Storage</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Where Dograh stores user files (call recordings, audio). Applies
          platform-wide across all ports.
        </p>
      </header>

      {/* Backend picker */}
      <section className="space-y-3 rounded-lg border bg-card p-6">
        <h2 className="text-sm font-medium">Storage backend</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {data.catalog.map((c) => {
            const selected = backend === c.key;
            return (
              <button
                key={c.key}
                type="button"
                disabled={!c.available}
                onClick={() => c.available && setBackend(c.key as "s3" | "minio")}
                className={`rounded-lg border p-4 text-left transition ${
                  selected ? "border-primary ring-1 ring-primary" : "hover:bg-muted/40"
                } ${c.available ? "" : "cursor-not-allowed opacity-60"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-medium">
                    <HardDrive className="size-4" /> {c.name}
                  </div>
                  {!c.available && <Badge variant="secondary" className="text-[10px]">Coming soon</Badge>}
                  {selected && <Check className="size-4 text-primary" />}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{c.description}</p>
              </button>
            );
          })}
        </div>
      </section>

      {/* Credentials */}
      <section className="space-y-4 rounded-lg border bg-card p-6">
        <h2 className="text-sm font-medium">
          {backend === "s3" ? "Amazon S3 credentials" : "MinIO credentials"}
        </h2>

        {backend === "s3" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Bucket" value={s3Bucket} onChange={setS3Bucket} placeholder="my-voice-bucket" />
            <Field label="Region" value={s3Region} onChange={setS3Region} placeholder="us-east-1" />
            <Field label="Access key ID" value={s3Key} onChange={setS3Key} placeholder="AKIA…" />
            <Field
              label={data.s3.has_secret ? "Secret access key (leave blank to keep)" : "Secret access key"}
              value={s3Secret}
              onChange={setS3Secret}
              type="password"
              placeholder="••••••••"
            />
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Endpoint (internal)" value={mEndpoint} onChange={setMEndpoint} placeholder="minio:9000" />
            <Field label="Public endpoint" value={mPublic} onChange={setMPublic} placeholder="http://localhost:9000" />
            <Field label="Bucket" value={mBucket} onChange={setMBucket} placeholder="voice-audio" />
            <Field label="Access key" value={mKey} onChange={setMKey} placeholder="minioadmin" />
            <Field
              label={data.minio.has_secret ? "Secret key (leave blank to keep)" : "Secret key"}
              value={mSecret}
              onChange={setMSecret}
              type="password"
              placeholder="••••••••"
            />
            <div>
              <Label>Use TLS</Label>
              <select
                className="mt-0.5 h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={mSecure ? "true" : "false"}
                onChange={(e) => setMSecure(e.target.value === "true")}
              >
                <option value="false">No (http)</option>
                <option value="true">Yes (https)</option>
              </select>
            </div>
          </div>
        )}

        {err && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</div>}
        {ok && <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{ok}</div>}
        {testResult && (
          <div
            className={`rounded-md px-3 py-2 text-sm ${
              testResult.ok ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"
            }`}
          >
            {testResult.detail}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={test} disabled={testing || busy}>
            {testing ? <Loader2 className="size-4 animate-spin" /> : null}
            {testing ? "Testing…" : "Test connection"}
          </Button>
          <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Test validates the <strong>saved</strong> config — save first, then test.
        </p>
      </section>

      {/* Env preview */}
      <EnvPreview env={data.env_preview} />
    </div>
  );
}

function EnvPreview({ env }: { env: Record<string, string> }) {
  const [copied, setCopied] = useState(false);
  const text = Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be blocked; ignore */
    }
  }

  return (
    <section className="space-y-3 rounded-lg border bg-card p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Apply to Dograh</h2>
        <Button variant="outline" size="sm" onClick={copy}>
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Set these environment variables on the Dograh service and restart it.
        The secret value is the one you entered above (shown masked here for
        safety). Once applied, all Dograh user files store on the selected
        backend across every port. Live propagation without a restart is a
        planned follow-up.
      </p>
      <pre className="overflow-x-auto rounded-md bg-muted/50 p-4 text-xs leading-relaxed">
        {text}
      </pre>
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <Input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}
