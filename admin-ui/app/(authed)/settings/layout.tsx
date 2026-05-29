"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { PageHeader } from "@/components/PageHeader";
import { ArrowLeftRight, Clock, CreditCard, KeyRound, Lock, Mail, ShieldCheck, User } from "lucide-react";

const SETTINGS_NAV = [
  { href: "/settings/profile", label: "Profile", icon: User },
  { href: "/settings/security", label: "Security", icon: Lock },
  { href: "/settings/cronjob", label: "Cronjob", icon: Clock },
  { href: "/settings/provider-api-keys", label: "Provider API keys", icon: KeyRound },
  { href: "/settings/email-providers", label: "Email providers", icon: Mail },
  { href: "/settings/payment-gateways", label: "Payment gateways", icon: CreditCard },
  { href: "/settings/fx-rates", label: "FX rates", icon: ArrowLeftRight },
  { href: "/settings/permissions", label: "Permissions", icon: ShieldCheck },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <>
      <PageHeader title="Settings" />
      <div className="flex flex-1 min-h-0">
        {/* sticky top-14 pins the aside just below the (also sticky) PageHeader.
            self-start + explicit height stops flex from stretching the box;
            the inner overflow-y-auto lets a long settings nav scroll on its own. */}
        <aside className="sticky top-14 z-10 self-start h-[calc(100svh-3.5rem)] w-52 shrink-0 overflow-y-auto border-r bg-card/40 p-4">
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
        <div className="flex-1 min-w-0">{children}</div>
      </div>
    </>
  );
}
