"use client";

/**
 * OODA super-admin dashboard.
 *
 * Two tabs:
 *   Overview        — platform snapshot + the 15 stat sections. Real data
 *                     where the schema supports it; "Coming soon" cards
 *                     where there's no data path yet (multi-org, invoices,
 *                     user-role breakdown).
 *   Recent Activity — audit feed with filters.
 *
 * All Overview aggregates come from one call: /api/admin/dashboard/overview.
 * Money: usage is micros (÷1e6), payments are cents (÷100).
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { api } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";
import { UpdateCheckerCard } from "@/components/UpdateCheckerCard";
import {
  Building2,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Package as PackageIcon,
  PlugZap,
  Users,
} from "lucide-react";

// ---------- types (mirror /dashboard/overview) ----------
type MoneySeries = { total: number; this_month: number; this_year: number; last_3_months: { month: string; value: number }[] };
type Overview = {
  snapshot: {
    tenants: { active: number; inactive: number; total: number };
    packages: { active: number; inactive: number; total: number };
    platform_users: number;
    installed_plugins: number;
    organizations: { coming_soon: boolean };
  };
  earnings: MoneySeries;
  sales: MoneySeries;
  subscriptions: { active: number; new_this_month: number; monthly: { month: string; count: number }[] };
  top_paying_tenants: { tenant_id: number; name: string; amount_micros: number }[];
  payment_gateways: { provider: string; amount_cents: number; count: number }[];
  recent_payments: { tenant: string; amount_cents: number; currency: string; provider: string; purpose: string; created_at: string | null }[];
  package_counts: { name: string; count: number }[];
  newly_registered: { id: number; name: string; logo_url: string | null; created_at: string | null; package: string | null }[];
  recent_subscriptions: { name: string; package: string; started_at: string | null; source: string }[];
  expiring_subscriptions: { name: string; package: string; ends_at: string | null; amount_cents: number; currency: string }[];
  upcoming_renewals: { name: string; package: string; ends_at: string | null; amount_cents: number; currency: string }[];
  org_most_users: { tenant_id: number; name: string; logo_url: string | null; members: number }[];
  registration: { year: number; months: { month: string; n: number; quarter: number; count: number }[] };
};

const usd = (micros: number) =>
  (micros / 1_000_000).toLocaleString(undefined, { style: "currency", currency: "USD" });
const usdCents = (cents: number) =>
  (cents / 100).toLocaleString(undefined, { style: "currency", currency: "USD" });

function relTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const days = Math.floor(diff / 86_400_000);
  const rel =
    days <= 0 ? "today" : days === 1 ? "1 day ago" : days < 30 ? `${days} days ago` : days < 365 ? `${Math.floor(days / 30)} mo ago` : `${Math.floor(days / 365)} yr ago`;
  const stamp = d.toLocaleString(undefined, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${stamp} (${rel})`;
}

export default function DashboardPage() {
  const [tab, setTab] = useState("overview");
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chartYear, setChartYear] = useState<number>(new Date().getFullYear());

  const load = useCallback(() => {
    api<Overview>(`/api/admin/dashboard/overview?year=${chartYear}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [chartYear]);
  useEffect(load, [load]);

  return (
    <>
      <PageHeader title="Dashboard" />
      <div className="p-8">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="activity">Recent Activity</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6 pt-2">
            {error && (
              <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
            )}
            {!data ? (
              <div className="text-sm text-muted-foreground">Loading…</div>
            ) : (
              <OverviewTab data={data} chartYear={chartYear} setChartYear={setChartYear} />
            )}
          </TabsContent>

          <TabsContent value="activity" className="pt-2">
            <ActivityTab />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}

function OverviewTab({
  data,
  chartYear,
  setChartYear,
}: {
  data: Overview;
  chartYear: number;
  setChartYear: (y: number) => void;
}) {
  return (
    <div className="space-y-6">
      <UpdateCheckerCard />

      {/* Platform snapshot */}
      <SectionTitle>Platform snapshot</SectionTitle>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <SplitStat icon={<Building2 className="size-4" />} label="Tenants" active={data.snapshot.tenants.active} inactive={data.snapshot.tenants.inactive} />
        <SplitStat icon={<PackageIcon className="size-4" />} label="Packages" active={data.snapshot.packages.active} inactive={data.snapshot.packages.inactive} />
        <Stat icon={<Users className="size-4" />} label="Platform users" value={data.snapshot.platform_users} />
        <Stat icon={<PlugZap className="size-4" />} label="Installed plugins" value={data.snapshot.installed_plugins} />
        <ComingSoonStat icon={<Building2 className="size-4" />} label="Total organizations" note="Multi-org per tenant — wire me up!" />
      </div>

      {/* Earnings + Sales */}
      <div className="grid gap-4 lg:grid-cols-2">
        <MoneyCard title="Earning reports" subtitle="Catalog profit (markup)" series={data.earnings} fmt={usd} color="var(--color-primary)" />
        <MoneyCard title="Sales reports" subtitle="Catalog usage billed — all tenants" series={data.sales} fmt={usd} color="var(--chart-2)" />
      </div>

      {/* Subscriptions + Registration chart */}
      <div className="grid gap-4 lg:grid-cols-2">
        <SubscriptionsCard subs={data.subscriptions} />
        <RegistrationCard registration={data.registration} chartYear={chartYear} setChartYear={setChartYear} />
      </div>

      {/* Tables row 1 */}
      <div className="grid gap-4 lg:grid-cols-2">
        <TableCard title="Top paying tenants" empty="No usage billed yet.">
          {data.top_paying_tenants.map((t) => (
            <Row key={t.tenant_id} left={t.name} right={usd(t.amount_micros)} />
          ))}
        </TableCard>
        <TableCard title="Payment gateway breakdown" empty="No payments captured yet.">
          {data.payment_gateways.map((g) => (
            <Row key={g.provider} left={<span className="capitalize">{g.provider}</span>} sub={`${g.count} payments`} right={usdCents(g.amount_cents)} />
          ))}
        </TableCard>
      </div>

      {/* Recent succeeded payments — payment-backed (purpose tags subscription vs top-up). */}
      <TableCard title="Recent payments" subtitle="Captured payments across all tenants" empty="No captured payments yet. Configure a gateway + confirm a payment (webhook or sync).">
        {data.recent_payments.map((p, i) => (
          <div key={i} className="flex items-center justify-between gap-2 border-b py-2 last:border-0">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{p.tenant}</div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="capitalize">{p.provider}</span>
                <Badge variant="secondary" className="text-[10px]">{p.purpose === "subscription" ? "subscription" : "top-up"}</Badge>
                <span>{p.created_at ? new Date(p.created_at).toLocaleDateString() : "—"}</span>
              </div>
            </div>
            <div className="shrink-0 font-medium tabular-nums">{usdCents(p.amount_cents)}</div>
          </div>
        ))}
      </TableCard>

      {/* Tables row 2 */}
      <div className="grid gap-4 lg:grid-cols-2">
        <TableCard title="Package count" subtitle="Orgs subscribed per package" empty="No packages.">
          {data.package_counts.map((p, i) => (
            <Row key={p.name} left={`${i + 1}. ${p.name}`} right={`${p.count} orgs`} />
          ))}
        </TableCard>
        <TableCard title="Subscription overview" subtitle="New subscriptions per month" empty="No subscriptions yet.">
          {data.subscriptions.monthly.map((m) => (
            <Row key={m.month} left={m.month} right={String(m.count)} />
          ))}
        </TableCard>
      </div>

      {/* Newly registered + Recent subscriptions */}
      <div className="grid gap-4 lg:grid-cols-2">
        <TableCard title="Newly registered tenants" empty="No tenants.">
          {data.newly_registered.map((t, i) => (
            <div key={t.id} className="flex items-center gap-3 border-b py-2 last:border-0">
              <span className="w-5 text-xs text-muted-foreground">{i + 1}.</span>
              <Logo url={t.logo_url} name={t.name} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{t.name}</div>
                <div className="text-xs text-muted-foreground">
                  {t.package ?? "no package"} · {relTime(t.created_at)}
                </div>
              </div>
            </div>
          ))}
        </TableCard>
        <TableCard title="Recent paid subscriptions" empty="No subscriptions yet.">
          {data.recent_subscriptions.map((s, i) => (
            <div key={i} className="flex items-center justify-between gap-2 border-b py-2 last:border-0">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{s.name}</div>
                <div className="text-xs text-muted-foreground">{s.package}</div>
              </div>
              <div className="shrink-0 text-right">
                <Badge variant="secondary" className="text-[10px] capitalize">{s.source}</Badge>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {s.started_at ? new Date(s.started_at).toLocaleDateString() : "—"}
                </div>
              </div>
            </div>
          ))}
        </TableCard>
      </div>

      {/* Renewals / expiring / org-most-users */}
      <div className="grid gap-4 lg:grid-cols-2">
        <TableCard title="Upcoming renewals (30 days)" empty="No renewals in the next 30 days.">
          {data.upcoming_renewals.map((r, i) => (
            <Row key={i} left={r.name} sub={r.ends_at ? new Date(r.ends_at).toLocaleDateString() : "—"} right={usdCents(r.amount_cents)} />
          ))}
        </TableCard>
        <TableCard title="Expiring subscriptions (30 days)" empty="No subscriptions expiring soon.">
          {data.expiring_subscriptions.map((r, i) => (
            <Row key={i} left={r.name} sub={r.package} right={r.ends_at ? new Date(r.ends_at).toLocaleDateString() : "—"} />
          ))}
        </TableCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <TableCard title="Orgs with most users" subtitle="AI agents / employees / clients split — coming soon" empty="No members yet.">
          {data.org_most_users.map((o, i) => (
            <div key={o.tenant_id} className="flex items-center gap-3 border-b py-2 last:border-0">
              <span className="w-5 text-xs text-muted-foreground">{i + 1}.</span>
              <Logo url={o.logo_url} name={o.name} />
              <div className="min-w-0 flex-1 truncate text-sm font-medium">{o.name}</div>
              <Badge variant="secondary">{o.members} users</Badge>
            </div>
          ))}
        </TableCard>
        <ComingSoonCard title="Invoices due soon" note="No invoice model yet — coming soon." />
      </div>
    </div>
  );
}

// ---------- snapshot stat cards ----------
function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">{icon}{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}
function SplitStat({ icon, label, active, inactive }: { icon: React.ReactNode; label: string; active: number; inactive: number }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">{icon}{label}</div>
      <div className="mt-1 text-2xl font-semibold">{active + inactive}</div>
      <div className="mt-1 flex gap-2 text-[11px]">
        <span className="text-emerald-600">{active} active</span>
        <span className="text-muted-foreground">{inactive} inactive</span>
      </div>
    </div>
  );
}
function ComingSoonStat({ icon, label, note }: { icon: React.ReactNode; label: string; note: string }) {
  return (
    <div className="rounded-lg border border-dashed bg-muted/20 p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">{icon}{label}</div>
      <Badge variant="outline" className="mt-1 text-[10px]">Coming soon</Badge>
      <div className="mt-1 text-[11px] text-muted-foreground">{note}</div>
    </div>
  );
}

function MoneyCard({ title, subtitle, series, fmt, color }: { title: string; subtitle: string; series: MoneySeries; fmt: (n: number) => string; color: string }) {
  const config: ChartConfig = { value: { label: title, color } };
  return (
    <div className="rounded-lg border bg-card p-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm font-medium">{title}</div>
          <div className="text-xs text-muted-foreground">{subtitle}</div>
        </div>
        <CreditCard className="size-4 text-muted-foreground" />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-3 text-center">
        <div><div className="text-lg font-semibold">{fmt(series.total)}</div><div className="text-[11px] text-muted-foreground">Total</div></div>
        <div><div className="text-lg font-semibold">{fmt(series.this_month)}</div><div className="text-[11px] text-muted-foreground">This month</div></div>
        <div><div className="text-lg font-semibold">{fmt(series.this_year)}</div><div className="text-[11px] text-muted-foreground">This year</div></div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4">
        <ChartContainer config={config} className="aspect-[4/3] w-full">
          <BarChart data={series.last_3_months} margin={{ left: 0, right: 0, top: 4, bottom: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={6} />
            <ChartTooltip content={<ChartTooltipContent formatter={(v) => fmt(Number(v))} />} />
            <Bar dataKey="value" fill="var(--color-value)" radius={4} />
          </BarChart>
        </ChartContainer>
        <div className="space-y-1.5">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Last 3 months</div>
          {series.last_3_months.map((m) => (
            <div key={m.month} className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{m.month}</span>
              <span className="font-medium">{fmt(m.value)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SubscriptionsCard({ subs }: { subs: Overview["subscriptions"] }) {
  return (
    <div className="rounded-lg border bg-card p-5">
      <div className="text-sm font-medium">Subscription overview</div>
      <div className="mt-3 grid grid-cols-2 gap-3 text-center">
        <div><div className="text-2xl font-semibold">{subs.active}</div><div className="text-[11px] text-muted-foreground">Active subscriptions</div></div>
        <div><div className="text-2xl font-semibold">{subs.new_this_month}</div><div className="text-[11px] text-muted-foreground">New this month</div></div>
      </div>
    </div>
  );
}

function RegistrationCard({
  registration,
  chartYear,
  setChartYear,
}: {
  registration: Overview["registration"];
  chartYear: number;
  setChartYear: (y: number) => void;
}) {
  const [mode, setMode] = useState<"quarter" | "month">("quarter");
  const config: ChartConfig = { count: { label: "Registrations", color: "var(--color-primary)" } };

  const chartData = useMemo(() => {
    if (mode === "month") {
      return registration.months.map((m) => ({ label: m.month, count: m.count }));
    }
    const q: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
    for (const m of registration.months) q[m.quarter] += m.count;
    return [1, 2, 3, 4].map((n) => ({ label: `Q${n}`, count: q[n] }));
  }, [registration, mode]);

  return (
    <div className="rounded-lg border bg-card p-5">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">Org registrations</div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md border p-0.5 text-xs">
            <button type="button" onClick={() => setMode("quarter")} className={`rounded px-2 py-0.5 ${mode === "quarter" ? "bg-primary text-primary-foreground" : ""}`}>Quarter</button>
            <button type="button" onClick={() => setMode("month")} className={`rounded px-2 py-0.5 ${mode === "month" ? "bg-primary text-primary-foreground" : ""}`}>Month</button>
          </div>
          <div className="flex items-center gap-1 text-xs">
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setChartYear(chartYear - 1)}><ChevronLeft className="size-3.5" /></Button>
            <span className="w-10 text-center font-medium">{registration.year}</span>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setChartYear(chartYear + 1)}><ChevronRight className="size-3.5" /></Button>
          </div>
        </div>
      </div>
      <ChartContainer config={config} className="mt-3 aspect-[16/7] w-full">
        <BarChart data={chartData} margin={{ left: 0, right: 0, top: 4, bottom: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={6} />
          <ChartTooltip content={<ChartTooltipContent hideLabel />} />
          <Bar dataKey="count" fill="var(--color-count)" radius={4} />
        </BarChart>
      </ChartContainer>
    </div>
  );
}

// ---------- generic table card + rows ----------
function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="text-sm font-semibold text-muted-foreground">{children}</div>;
}
function TableCard({ title, subtitle, empty, children }: { title: string; subtitle?: string; empty: string; children: React.ReactNode }) {
  const arr = Array.isArray(children) ? children : [children];
  const isEmpty = arr.flat().filter(Boolean).length === 0;
  return (
    <div className="rounded-lg border bg-card p-5">
      <div className="text-sm font-medium">{title}</div>
      {subtitle && <div className="text-xs text-muted-foreground">{subtitle}</div>}
      <div className="mt-3">
        {isEmpty ? <div className="py-4 text-center text-xs text-muted-foreground">{empty}</div> : children}
      </div>
    </div>
  );
}
function Row({ left, sub, right }: { left: React.ReactNode; sub?: React.ReactNode; right: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b py-2 text-sm last:border-0">
      <div className="min-w-0">
        <div className="truncate">{left}</div>
        {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      </div>
      <div className="shrink-0 font-medium tabular-nums">{right}</div>
    </div>
  );
}
function Logo({ url, name }: { url: string | null; name: string }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={name} className="size-7 shrink-0 rounded object-cover" />;
  }
  return (
    <div className="flex size-7 shrink-0 items-center justify-center rounded bg-muted text-xs font-medium">
      {name.slice(0, 1).toUpperCase()}
    </div>
  );
}
function ComingSoonCard({ title, note }: { title: string; note: string }) {
  return (
    <div className="flex flex-col rounded-lg border border-dashed bg-muted/20 p-5">
      <div className="text-sm font-medium">{title}</div>
      <Badge variant="outline" className="mt-2 w-fit text-[10px]">Coming soon</Badge>
      <div className="mt-2 text-xs text-muted-foreground">{note}</div>
    </div>
  );
}

// ---------- Recent Activity tab ----------
type AuditRow = {
  id: number;
  actor_kind: string;
  actor_user_id: number | null;
  action: string;
  target_kind: string | null;
  target_id: string | null;
  ip: string | null;
  created_at: string;
};

function ActivityTab() {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actorKind, setActorKind] = useState<string>("all");
  const [actionInput, setActionInput] = useState("");
  const [action, setAction] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setAction(actionInput.trim()), 300);
    return () => clearTimeout(t);
  }, [actionInput]);

  useEffect(() => {
    const sp = new URLSearchParams();
    sp.set("limit", "100");
    if (actorKind !== "all") sp.set("actor_kind", actorKind);
    if (action) sp.set("action", action);
    api<{ items: AuditRow[] }>(`/api/admin/audit?${sp.toString()}`)
      .then((r) => setRows(r.items))
      .catch((e) => setError(e.message));
  }, [actorKind, action]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-44">
          <label className="mb-1 block text-xs text-muted-foreground">Actor</label>
          <Select value={actorKind} onValueChange={setActorKind}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All actors</SelectItem>
              <SelectItem value="platform">Platform</SelectItem>
              <SelectItem value="customer">Customer</SelectItem>
              <SelectItem value="system">System</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="mb-1 block text-xs text-muted-foreground">Action starts with</label>
          <Input className="h-9" placeholder="e.g. admin.tenant" value={actionInput} onChange={(e) => setActionInput(e.target.value)} />
        </div>
      </div>

      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <div className="rounded-lg border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2">When</th>
              <th className="px-4 py-2">Actor</th>
              <th className="px-4 py-2">Action</th>
              <th className="px-4 py-2">Target</th>
              <th className="px-4 py-2">IP</th>
            </tr>
          </thead>
          <tbody>
            {!rows && <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">Loading…</td></tr>}
            {rows?.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">No activity matches.</td></tr>}
            {rows?.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">{new Date(r.created_at).toLocaleString()}</td>
                <td className="px-4 py-2"><Badge variant="secondary" className="text-[10px]">{r.actor_kind}</Badge></td>
                <td className="px-4 py-2 font-mono text-xs">{r.action}</td>
                <td className="px-4 py-2 text-xs text-muted-foreground">{r.target_kind ? `${r.target_kind}#${r.target_id ?? "?"}` : "—"}</td>
                <td className="px-4 py-2 text-muted-foreground">{r.ip ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
