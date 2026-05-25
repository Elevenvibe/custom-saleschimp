"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { api, setToken, type Me, GATEWAY } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LogOut, Sparkles, ExternalLink, Users, Settings } from "lucide-react";

export default function DashboardPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Me>("/api/tenant/me").then(setMe).catch((e) => setError(e.message));
  }, []);

  function signOut() {
    setToken(null);
    router.replace("/login");
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      </div>
    );
  }
  if (!me) {
    return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="mx-auto min-h-screen max-w-3xl px-6 py-12">
      <div className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex aspect-square size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles className="size-5" />
          </div>
          <div>
            <div className="text-lg font-semibold">{me.tenant.name}</div>
            <div className="text-xs text-muted-foreground">
              <Badge variant="secondary">{me.user.role}</Badge> · {me.user.email}
            </div>
          </div>
        </div>
        <Button variant="ghost" onClick={signOut}>
          <LogOut className="size-4" /> Sign out
        </Button>
      </div>

      {!me.tenant.onboarding_completed && (
        <div className="mb-6 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          You haven&apos;t finished onboarding.{" "}
          <Link href="/onboarding" className="underline">Complete it</Link>.
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <Card title="Open Dograh" body="Build workflows, manage agents, and run calls." href={GATEWAY}>
          <ExternalLink className="size-4" />
        </Card>
        <Card title="Invite team" body="Add more teammates to your workspace." href="/onboarding">
          <Users className="size-4" />
        </Card>
        <Card title="Workspace settings" body="Change name and other workspace settings." href="/onboarding">
          <Settings className="size-4" />
        </Card>
      </div>

      <div className="mt-8 rounded-md border bg-card p-4 text-sm">
        <div className="mb-2 font-medium">Members ({me.members.length})</div>
        <ul className="space-y-1.5">
          {me.members.map((m) => (
            <li key={m.id} className="flex items-center justify-between text-sm">
              <span>{m.email}</span>
              <Badge variant="secondary" className="text-xs">{m.role}</Badge>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Card({
  title,
  body,
  href,
  children,
}: {
  title: string;
  body: string;
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="block rounded-lg border bg-card p-4 transition hover:bg-muted/40"
    >
      <div className="mb-2 flex items-center justify-between">
        {children}
      </div>
      <div className="font-medium">{title}</div>
      <div className="mt-1 text-xs text-muted-foreground">{body}</div>
    </Link>
  );
}
