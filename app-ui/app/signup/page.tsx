"use client";

import { useState } from "react";
import Link from "next/link";

import { api, ApiError } from "@/lib/api";
import { AuthShell } from "@/components/AuthShell";
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
import { Textarea } from "@/components/ui/textarea";

export default function SignupPage() {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    full_name: "",
    email: "",
    password: "",
    company_name: "",
    company_size: "",
    role_title: "",
    use_case: "",
    expected_call_volume: "",
    referral_source: "",
  });

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((s) => ({ ...s, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const payload: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(form)) {
      if (v) payload[k] = v;
    }
    try {
      await api("/api/auth/signup", {
        method: "POST",
        body: JSON.stringify(payload),
        auth: false,
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Signup failed");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <AuthShell
        title="Check your email"
        subtitle="A verification link is on its way."
      >
        <p className="text-sm text-muted-foreground">
          Tap the link in the email to finish setting up your workspace.
          Be sure to check your spam folder. The link is valid for 24 hours.
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create your SalesChimp workspace"
      subtitle="It takes about 30 seconds."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="underline">Sign in</Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <div>
          <Label htmlFor="full_name">Full name</Label>
          <Input
            id="full_name"
            value={form.full_name}
            onChange={(e) => set("full_name", e.target.value)}
            required
            maxLength={128}
          />
        </div>
        <div>
          <Label htmlFor="email">Work email</Label>
          <Input
            id="email"
            type="email"
            value={form.email}
            onChange={(e) => set("email", e.target.value)}
            required
          />
        </div>
        <div>
          <Label htmlFor="password">Password (min 8 chars)</Label>
          <Input
            id="password"
            type="password"
            value={form.password}
            onChange={(e) => set("password", e.target.value)}
            minLength={8}
            required
          />
        </div>
        <div>
          <Label htmlFor="company_name">Company name</Label>
          <Input
            id="company_name"
            value={form.company_name}
            onChange={(e) => set("company_name", e.target.value)}
            required
            maxLength={128}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Company size</Label>
            <Select value={form.company_size} onValueChange={(v) => set("company_size", v)}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1-10">1–10</SelectItem>
                <SelectItem value="11-50">11–50</SelectItem>
                <SelectItem value="51-200">51–200</SelectItem>
                <SelectItem value="201-1000">201–1000</SelectItem>
                <SelectItem value="1000+">1000+</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="role_title">Your role</Label>
            <Input
              id="role_title"
              value={form.role_title}
              onChange={(e) => set("role_title", e.target.value)}
              maxLength={64}
            />
          </div>
        </div>
        <div>
          <Label htmlFor="use_case">What will you use SalesChimp for? (optional)</Label>
          <Textarea
            id="use_case"
            value={form.use_case}
            onChange={(e) => set("use_case", e.target.value)}
            rows={3}
            maxLength={512}
          />
        </div>
        {error && (
          <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Creating…" : "Create account"}
        </Button>
      </form>
    </AuthShell>
  );
}
