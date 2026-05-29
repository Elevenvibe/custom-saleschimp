"use client";

/**
 * Settings → Profile (super-admin's own account).
 *
 * All profile fields + avatar upload + password change + a verified email
 * change. Email change mails a 6-digit code to the new address; entering it
 * here swaps the email and (per spec) bounces back to the dashboard.
 *
 * Backend: /api/admin/profile (GET/PATCH), /avatar, /password,
 * /email/request, /email/verify.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { api, GATEWAY, getToken } from "@/lib/api";
import { PageDescription } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Upload } from "lucide-react";

type Profile = {
  id: number;
  email: string;
  role: string;
  first_name: string | null;
  last_name: string | null;
  profile_picture_url: string | null;
  country: string | null;
  mobile: string | null;
  language: string;
  gender: string | null;
  date_of_birth: string | null;
  slack_member_id: string | null;
  marital_status: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  about: string | null;
  receive_email_notifications: boolean;
  google_calendar_enabled: boolean;
  pending_email: string | null;
};

export default function ProfileSettingsPage() {
  const [p, setP] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  function load() {
    api<Profile>("/api/admin/profile").then(setP).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  if (error && !p) {
    return (
      <div className="p-8">
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      </div>
    );
  }
  if (!p) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="p-8 space-y-6 max-w-3xl">
      <div>
        <h2 className="text-lg font-semibold">Profile</h2>
        <PageDescription>Your super-admin account details.</PageDescription>
      </div>

      {ok && <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{ok}</div>}
      {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}

      <AvatarCard profile={p} onChanged={load} onError={setError} />
      <DetailsCard profile={p} onSaved={(msg) => { setOk(msg); load(); }} onError={setError} />
      <EmailCard profile={p} onChanged={load} onError={setError} />
      <PasswordCard onDone={(msg) => setOk(msg)} onError={setError} />
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border bg-card p-5 space-y-4">
      <div className="text-sm font-medium">{title}</div>
      {children}
    </section>
  );
}

function AvatarCard({ profile, onChanged, onError }: { profile: Profile; onChanged: () => void; onError: (s: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function upload(file: File) {
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const token = getToken();
      const res = await fetch(`${GATEWAY}/api/admin/profile/avatar`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: form,
      });
      if (!res.ok) throw new Error((await res.text()) || `upload failed (${res.status})`);
      onChanged();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <Card title="Profile picture">
      <div className="flex items-center gap-4">
        {profile.profile_picture_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={profile.profile_picture_url} alt="avatar" className="size-16 rounded-full object-cover" />
        ) : (
          <div className="flex size-16 items-center justify-center rounded-full bg-muted text-xl font-medium">
            {(profile.first_name?.[0] ?? profile.email[0]).toUpperCase()}
          </div>
        )}
        <Button variant="outline" size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
          {busy ? "Uploading…" : "Upload"}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
          }}
        />
      </div>
    </Card>
  );
}

function DetailsCard({ profile, onSaved, onError }: { profile: Profile; onSaved: (msg: string) => void; onError: (s: string) => void }) {
  const [f, setF] = useState(profile);
  const [busy, setBusy] = useState(false);
  function set<K extends keyof Profile>(k: K, v: Profile[K]) {
    setF((prev) => ({ ...prev, [k]: v }));
  }

  async function save() {
    setBusy(true);
    onError("");
    try {
      await api("/api/admin/profile", {
        method: "PATCH",
        body: JSON.stringify({
          first_name: f.first_name,
          last_name: f.last_name,
          country: f.country,
          mobile: f.mobile,
          language: f.language,
          gender: f.gender || null,
          date_of_birth: f.date_of_birth || null,
          slack_member_id: f.slack_member_id,
          marital_status: f.marital_status,
          address: f.address,
          city: f.city,
          state: f.state,
          zip_code: f.zip_code,
          about: f.about,
          receive_email_notifications: f.receive_email_notifications,
          google_calendar_enabled: f.google_calendar_enabled,
        }),
      });
      onSaved("Profile saved.");
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Details">
      <div className="grid grid-cols-2 gap-3">
        <Field label="First name"><Input value={f.first_name ?? ""} onChange={(e) => set("first_name", e.target.value)} /></Field>
        <Field label="Last name"><Input value={f.last_name ?? ""} onChange={(e) => set("last_name", e.target.value)} /></Field>
        <Field label="Mobile"><Input value={f.mobile ?? ""} onChange={(e) => set("mobile", e.target.value)} /></Field>
        <Field label="Country"><Input value={f.country ?? ""} onChange={(e) => set("country", e.target.value)} /></Field>
        <Field label="Gender">
          <Select value={f.gender ?? ""} onValueChange={(v) => set("gender", v)}>
            <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="male">Male</SelectItem>
              <SelectItem value="female">Female</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Date of birth"><Input type="date" value={f.date_of_birth ?? ""} onChange={(e) => set("date_of_birth", e.target.value)} /></Field>
        <Field label="Marital status">
          <Select value={f.marital_status ?? ""} onValueChange={(v) => set("marital_status", v)}>
            <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="single">Single</SelectItem>
              <SelectItem value="married">Married</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Language">
          <Select value={f.language || "en"} onValueChange={(v) => set("language", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="en">English</SelectItem>
              <SelectItem value="fr">French</SelectItem>
              <SelectItem value="es">Spanish</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Slack Member ID"><Input value={f.slack_member_id ?? ""} onChange={(e) => set("slack_member_id", e.target.value)} /></Field>
        <Field label="Address"><Input value={f.address ?? ""} onChange={(e) => set("address", e.target.value)} /></Field>
        <Field label="City"><Input value={f.city ?? ""} onChange={(e) => set("city", e.target.value)} /></Field>
        <Field label="State"><Input value={f.state ?? ""} onChange={(e) => set("state", e.target.value)} /></Field>
        <Field label="Zip code"><Input value={f.zip_code ?? ""} onChange={(e) => set("zip_code", e.target.value)} /></Field>
      </div>

      <div>
        <Label>About</Label>
        <textarea
          className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
          rows={3}
          value={f.about ?? ""}
          onChange={(e) => set("about", e.target.value)}
        />
      </div>

      <div className="flex flex-wrap gap-6">
        <Toggle label="Receive email notifications" value={f.receive_email_notifications} onChange={(v) => set("receive_email_notifications", v)} />
        <Toggle label="Enable Google Calendar" value={f.google_calendar_enabled} onChange={(v) => set("google_calendar_enabled", v)} />
      </div>

      <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save profile"}</Button>
    </Card>
  );
}

function EmailCard({ profile, onChanged, onError }: { profile: Profile; onChanged: () => void; onError: (s: string) => void }) {
  const router = useRouter();
  const [newEmail, setNewEmail] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"idle" | "verify">(profile.pending_email ? "verify" : "idle");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function request() {
    setBusy(true); onError("");
    try {
      const r = await api<{ sent_to: string }>("/api/admin/profile/email/request", {
        method: "POST",
        body: JSON.stringify({ new_email: newEmail }),
      });
      setNote(`Code sent to ${r.sent_to}. Enter it below.`);
      setStage("verify");
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true); onError("");
    try {
      await api("/api/admin/profile/email/verify", {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      // Per spec: redirect back to the dashboard on success.
      router.push("/dashboard");
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Email address">
      <div className="text-sm text-muted-foreground">
        Current: <span className="font-medium text-foreground">{profile.email}</span>
        {profile.pending_email && (
          <span className="ml-2 text-amber-600">pending change → {profile.pending_email}</span>
        )}
      </div>
      {note && <div className="rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-700">{note}</div>}
      {stage === "idle" ? (
        <div className="flex items-end gap-2">
          <Field label="New email">
            <Input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="new@example.com" />
          </Field>
          <Button variant="outline" disabled={busy || !newEmail} onClick={request}>
            {busy ? "Sending…" : "Send code"}
          </Button>
        </div>
      ) : (
        <div className="flex items-end gap-2">
          <Field label="Verification code">
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="6-digit code" maxLength={6} />
          </Field>
          <Button disabled={busy || !code} onClick={verify}>
            {busy ? "Verifying…" : "Verify & save"}
          </Button>
          <Button variant="ghost" onClick={() => { setStage("idle"); setNote(null); onChanged(); }}>Cancel</Button>
        </div>
      )}
    </Card>
  );
}

function PasswordCard({ onDone, onError }: { onDone: (msg: string) => void; onError: (s: string) => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true); onError("");
    try {
      await api("/api/admin/profile/password", {
        method: "POST",
        body: JSON.stringify({ current_password: current, new_password: next }),
      });
      setCurrent(""); setNext("");
      onDone("Password updated.");
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Password">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Current password"><Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" /></Field>
        <Field label="New password (min 12)"><Input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={12} /></Field>
      </div>
      <Button onClick={save} disabled={busy || !current || next.length < 12}>{busy ? "Updating…" : "Change password"}</Button>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex-1">
      <Label className="text-xs">{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
      <input
        type="checkbox"
        className="peer sr-only"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="relative inline-block h-5 w-9 rounded-full bg-muted transition peer-checked:bg-primary">
        <span className="absolute left-0.5 top-0.5 inline-block size-4 rounded-full bg-background transition peer-checked:translate-x-4" />
      </span>
      {label}
    </label>
  );
}
