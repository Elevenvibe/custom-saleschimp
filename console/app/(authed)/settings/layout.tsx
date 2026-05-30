"use client";

/**
 * Tenant settings — inner sidebar shell mirroring the super-admin pattern.
 *
 * The left rail lists every settings area; the right pane renders the
 * active sub-route. Most areas are "coming soon" placeholders today (the
 * roadmap is visible to operators); the live areas (Organization, App,
 * Currency, Notifications, Payment methods, Tax, Custom fields) are wired
 * through their own pages.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Banknote,
  Bell,
  BellRing,
  Briefcase,
  Building2,
  Calendar,
  ClipboardList,
  ClipboardSignature,
  Clock,
  CreditCard,
  Currency,
  DollarSign,
  FileSignature,
  Fingerprint,
  Gauge,
  GitBranch,
  HardHat,
  Hourglass,
  Inbox,
  Languages,
  LayoutDashboard,
  ListPlus,
  Lock,
  Mail,
  Megaphone,
  MessageSquare,
  Package,
  Paintbrush,
  Pencil,
  Plus,
  Receipt,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Star,
  Ticket,
  UserCheck,
  UserPlus,
  Users,
  Wallet,
  Wand2,
} from "lucide-react";

const NAV = [
  { href: "/settings/organization", label: "Organization", icon: Building2 },
  { href: "/settings/notifications", label: "Notifications", icon: Bell },
  { href: "/settings/currency", label: "Currency", icon: Currency },
  { href: "/settings/app", label: "App settings", icon: LayoutDashboard },
  { href: "/settings/payment-methods", label: "Payment methods", icon: CreditCard },
  { href: "/settings/finance", label: "Finance", icon: DollarSign },
  { href: "/settings/contract", label: "Contract", icon: FileSignature },
  { href: "/settings/tax", label: "Tax", icon: Receipt },
  { href: "/settings/ticket", label: "Tickets", icon: Ticket },
  { href: "/settings/project", label: "Projects", icon: Briefcase },
  { href: "/settings/attendance", label: "Attendance", icon: UserCheck },
  { href: "/settings/leave", label: "Leave", icon: Calendar },
  { href: "/settings/custom-fields", label: "Custom fields", icon: ListPlus },
  { href: "/settings/roles", label: "Roles & permissions", icon: ShieldCheck },
  { href: "/settings/messaging", label: "Messaging", icon: MessageSquare },
  { href: "/settings/lead", label: "Leads", icon: Megaphone },
  { href: "/settings/time-log", label: "Time logs", icon: Clock },
  { href: "/settings/task", label: "Tasks", icon: ClipboardList },
  { href: "/settings/security", label: "Security", icon: Lock },
  { href: "/settings/theme", label: "Theme", icon: Paintbrush },
  { href: "/settings/custom-link", label: "Custom links", icon: GitBranch },
  { href: "/settings/gdpr", label: "GDPR", icon: Fingerprint },
  { href: "/settings/sign-up", label: "Sign up", icon: UserPlus },
  { href: "/settings/payroll", label: "Payroll", icon: Banknote },
  { href: "/settings/overtime", label: "Overtime", icon: Hourglass },
  { href: "/settings/performance", label: "Performance", icon: Gauge },
  { href: "/settings/purchase", label: "Purchase", icon: ShoppingCart },
  { href: "/settings/recruit", label: "Recruitment", icon: HardHat },
  { href: "/settings/billing", label: "Billing", icon: Wallet },
  { href: "/settings/asset", label: "Assets", icon: Package },
];
// quiet the linter about unused icon imports — kept for future areas.
const _unused = [BellRing, ClipboardSignature, Inbox, Languages, Mail, Pencil, Plus, Sparkles, Star, Users, Wand2];
void _unused;

export default function TenantSettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="flex min-h-[calc(100vh-3.5rem)]">
      <aside className="w-60 shrink-0 border-r bg-card/40 px-2 py-4 overflow-y-auto">
        <div className="mb-3 px-2 text-[10px] uppercase tracking-wider text-muted-foreground">
          Settings
        </div>
        <nav className="space-y-0.5">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(href + "/");
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition ${
                  active
                    ? "bg-primary/10 font-medium text-primary"
                    : "text-foreground hover:bg-muted"
                }`}
              >
                <Icon className="size-4" />
                <span className="truncate">{label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
