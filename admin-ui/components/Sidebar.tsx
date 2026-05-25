"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { setToken } from "@/lib/api";
import {
  LayoutDashboard,
  Building2,
  Users,
  ScrollText,
  Package,
  PlugZap,
  Mail,
  LogOut,
} from "lucide-react";

const nav = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/tenants", label: "Tenants", icon: Building2 },
  { href: "/platform-users", label: "Platform users", icon: Users },
  { href: "/audit", label: "Audit log", icon: ScrollText },
  { href: "/packages", label: "Packages", icon: Package },
  { href: "/plugins", label: "Plugins", icon: PlugZap },
  { href: "/email-providers", label: "Email providers", icon: Mail },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="px-5 py-5">
        <div className="text-lg font-semibold text-slate-900">SalesChimp</div>
        <div className="text-xs text-slate-500">super-admin</div>
      </div>
      <nav className="flex-1 px-2">
        {nav.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm ${
                active
                  ? "bg-brand-50 text-brand-700 font-medium"
                  : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              <Icon className="h-4 w-4" />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>
      <button
        className="m-2 flex items-center gap-2 rounded-md px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
        onClick={() => {
          setToken(null);
          router.replace("/login");
        }}
      >
        <LogOut className="h-4 w-4" />
        Sign out
      </button>
    </aside>
  );
}
