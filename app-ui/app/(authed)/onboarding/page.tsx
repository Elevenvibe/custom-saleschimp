"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { api, type Me, type TenantInfo, type TenantInvite } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sparkles, Building2, Bot, Send, CheckCircle2 } from "lucide-react";

const STEPS = ["workspace", "starter", "team"] as const;
type Step = (typeof STEPS)[number];

const TRACKS = [
  {
    id: "outbound",
    title: "Outbound prospecting",
    body: "Dial leads, qualify them, and book meetings on autopilot.",
  },
  {
    id: "inbound",
    title: "Inbound qualification",
    body: "Catch new sign-ups instantly and route them to the right rep.",
  },
  {
    id: "support",
    title: "Customer support",
    body: "Front-line voice agents that resolve tier-1 tickets 24/7.",
  },
] as const;

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("workspace");
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Me>("/api/tenant/me").then((m) => {
      setMe(m);
      if (m.tenant.onboarding_completed) {
        router.replace("/dashboard");
      }
    }).catch((e) => setError(e.message));
  }, [router]);

  async function finish() {
    try {
      await api("/api/tenant/me/onboarding/complete", {
        method: "POST",
        body: JSON.stringify({ completed: true }),
      });
      router.replace("/dashboard");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="rounded-md border bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>
      </div>
    );
  }
  if (!me) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="mx-auto min-h-screen max-w-3xl px-6 py-12">
      <div className="mb-8 flex items-center gap-3">
        <div className="flex aspect-square size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Sparkles className="size-5" />
        </div>
        <div>
          <div className="text-lg font-semibold">Welcome to SalesChimp</div>
          <div className="text-sm text-muted-foreground">
            Let&apos;s get {me.tenant.name} set up — three quick steps.
          </div>
        </div>
      </div>

      <Stepper current={step} onStep={setStep} />

      <div className="mt-8 rounded-lg border bg-card p-6 shadow-sm">
        {step === "workspace" && (
          <WorkspaceStep me={me} onMe={setMe} onNext={() => setStep("starter")} />
        )}
        {step === "starter" && (
          <StarterStep onBack={() => setStep("workspace")} onNext={() => setStep("team")} />
        )}
        {step === "team" && (
          <TeamStep onBack={() => setStep("starter")} onFinish={finish} />
        )}
      </div>
    </div>
  );
}

function Stepper({ current, onStep }: { current: Step; onStep: (s: Step) => void }) {
  const labels = {
    workspace: { icon: <Building2 className="size-4" />, label: "Workspace" },
    starter: { icon: <Bot className="size-4" />, label: "Starter agent" },
    team: { icon: <Send className="size-4" />, label: "Invite team" },
  };
  return (
    <div className="flex items-center gap-2">
      {STEPS.map((s, i) => {
        const isActive = s === current;
        const isPast = STEPS.indexOf(current) > i;
        return (
          <button
            key={s}
            onClick={() => isPast && onStep(s)}
            disabled={!isPast && !isActive}
            className={`flex flex-1 items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition ${
              isActive
                ? "border-primary bg-primary/5 font-medium"
                : isPast
                ? "border-border hover:bg-muted/50 cursor-pointer"
                : "border-border text-muted-foreground"
            }`}
          >
            <span className="flex aspect-square size-6 items-center justify-center rounded-full border text-xs">
              {isPast ? <CheckCircle2 className="size-4" /> : i + 1}
            </span>
            {labels[s].icon}
            {labels[s].label}
          </button>
        );
      })}
    </div>
  );
}

function WorkspaceStep({
  me,
  onMe,
  onNext,
}: {
  me: Me;
  onMe: (m: Me) => void;
  onNext: () => void;
}) {
  const [name, setName] = useState(me.tenant.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const t = await api<TenantInfo>("/api/tenant/me/branding", {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
      onMe({ ...me, tenant: t });
      onNext();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">Confirm your workspace</h2>
        <p className="text-sm text-muted-foreground">
          This is the name your teammates and customers will see.
        </p>
      </div>
      <div>
        <Label htmlFor="workspace_name">Workspace name</Label>
        <Input
          id="workspace_name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={128}
        />
      </div>
      <div className="text-xs text-muted-foreground">
        Slug: <code className="font-mono">{me.tenant.slug}</code> · Owner: <code className="font-mono">{me.tenant.owner_email}</code>
      </div>
      {error && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onNext}>Skip</Button>
        <Button onClick={save} disabled={busy || !name}>
          {busy ? "Saving…" : "Save and continue"}
        </Button>
      </div>
    </div>
  );
}

function StarterStep({
  onBack,
  onNext,
}: {
  onBack: () => void;
  onNext: () => void;
}) {
  const [pick, setPick] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">Pick a starter agent</h2>
        <p className="text-sm text-muted-foreground">
          We&apos;ll seed a template for you. You can edit or replace it anytime.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {TRACKS.map((t) => (
          <button
            key={t.id}
            onClick={() => setPick(t.id)}
            className={`rounded-md border p-4 text-left transition ${
              pick === t.id
                ? "border-primary bg-primary/5"
                : "border-border hover:bg-muted/50"
            }`}
          >
            <div className="mb-2 flex items-center justify-between">
              <Bot className="size-5" />
              {pick === t.id && <CheckCircle2 className="size-4 text-primary" />}
            </div>
            <div className="font-medium">{t.title}</div>
            <div className="mt-1 text-xs text-muted-foreground">{t.body}</div>
          </button>
        ))}
      </div>
      <div className="rounded-md border bg-amber-50 px-3 py-2 text-xs text-amber-800">
        Heads-up: real workflow templates aren&apos;t seeded yet — picking one here is a UX placeholder.
        You&apos;ll build your first agent in the Dograh workflow editor.
      </div>
      <div className="flex justify-between gap-2">
        <Button variant="ghost" onClick={onBack}>Back</Button>
        <Button onClick={onNext}>Continue</Button>
      </div>
    </div>
  );
}

function TeamStep({
  onBack,
  onFinish,
}: {
  onBack: () => void;
  onFinish: () => void;
}) {
  const [invites, setInvites] = useState<TenantInvite[] | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("org_member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api<TenantInvite[]>("/api/tenant/invites").then(setInvites).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  async function send() {
    if (!email) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/tenant/invites", {
        method: "POST",
        body: JSON.stringify({ email, role }),
      });
      setEmail("");
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">Invite your team</h2>
        <p className="text-sm text-muted-foreground">
          Send invitations now or later — anyone you invite gets their own login.
        </p>
      </div>
      <div className="flex gap-2">
        <Input
          type="email"
          placeholder="teammate@yourcompany.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Select value={role} onValueChange={setRole}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="org_member">Member</SelectItem>
            <SelectItem value="org_admin">Admin</SelectItem>
          </SelectContent>
        </Select>
        <Button onClick={send} disabled={busy || !email}>Send invite</Button>
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      )}

      <div className="rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
            <tr><th className="px-3 py-2">Email</th><th className="px-3 py-2">Role</th><th className="px-3 py-2">Status</th></tr>
          </thead>
          <tbody>
            {!invites && <tr><td colSpan={3} className="px-3 py-4 text-center text-muted-foreground">Loading…</td></tr>}
            {invites?.length === 0 && (
              <tr><td colSpan={3} className="px-3 py-4 text-center text-muted-foreground">No invites yet — add one above.</td></tr>
            )}
            {invites?.map((i) => (
              <tr key={i.id} className="border-t">
                <td className="px-3 py-2">{i.email}</td>
                <td className="px-3 py-2"><Badge variant="secondary">{i.role}</Badge></td>
                <td className="px-3 py-2">
                  {i.accepted_at ? (
                    <Badge>accepted</Badge>
                  ) : (
                    <Badge variant="secondary">pending</Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex justify-between gap-2">
        <Button variant="ghost" onClick={onBack}>Back</Button>
        <Button onClick={onFinish}>Finish setup</Button>
      </div>
    </div>
  );
}
