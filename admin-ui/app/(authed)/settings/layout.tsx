"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { PageHeader } from "@/components/PageHeader";
import { Clock, KeyRound, Mail } from "lucide-react";

const SETTINGS_NAV = [
  { href: "/settings/cronjob", label: "Cronjob", icon: Clock },
  { href: "/settings/provider-api-keys", label: "Provider API keys", icon: KeyRound },
  { href: "/settings/email-providers", label: "Email providers", icon: Mail },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <>
      <PageHeader title="Settings" />
      <div className="flex flex-1 min-h-0">
        <aside className="w-52 shrink-0 border-r bg-card/40 p-4">
          <nav className="space-y-1">
            {SETTINGS_NAV.map(({ href, label, icon: Icon }) => {
              const active = pathname === href || pathname.startsWith(href + "/");
              return (
                <Link
                  key={href}
                  href={href}
                  className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition ${
                    active
                      ? "bg-primary/10 font-medium text-primary"
                      : "text-foreground hover:bg-muted"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </Link>
              );
            })}
          </nav>
        </aside>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </>
  );
}
