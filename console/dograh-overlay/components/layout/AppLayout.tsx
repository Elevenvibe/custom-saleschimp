"use client";

// SALESCHIMP OVERLAY — replaces dograh/ui/src/components/layout/AppLayout.tsx
// at Docker build time (COPY console/dograh-overlay/ ./src/).
//
// Changes vs upstream (cleaner-UI pass):
//   - AppHeader: removed the "Join Slack" link + GitHub star badge, added a
//     notification bell. The collapse trigger (SidebarTrigger) now lives
//     here in the top header (sidebar-08 layout) instead of inside the
//     sidebar, with a vertical separator + brand label.
//   - Everything else (SidebarProvider/SidebarInset shell, route gating,
//     workflow-editor special-casing, headerActions/stickyTabs) is
//     preserved from upstream.
//
// RE-MERGE NOTE: if a Dograh bump changes ui/src/components/layout/
// AppLayout.tsx, diff it against this file and re-apply the AppHeader
// redesign onto the new upstream base.

import { Bell, ChevronRight } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import React, { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";

import { AppSidebar } from "./AppSidebar";

// [saleschimp-overlay] Build a {crumbs, title} from the current path so the
// header shows the page the user is on instead of a static brand wordmark.
// Numeric / long-hex segments (workflow ids, run ids) collapse to "Detail".
function titleCase(seg: string): string {
  return seg.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
function crumbsFromPath(pathname: string): { label: string; href: string }[] {
  const parts = pathname.split("/").filter(Boolean);
  const out: { label: string; href: string }[] = [];
  let href = "";
  for (const p of parts) {
    href += `/${p}`;
    // Skip the basePath segment + opaque ids in the visible trail.
    if (p === "console") continue;
    const isId = /^[0-9]+$/.test(p) || /^[0-9a-f]{8,}$/i.test(p);
    out.push({ label: isId ? "Detail" : titleCase(p), href });
  }
  return out.length ? out : [{ label: "Dashboard", href: "/" }];
}

function AppHeader() {
  const pathname = usePathname() || "/";
  const crumbs = crumbsFromPath(pathname);
  const title = crumbs[crumbs.length - 1].label;
  const parents = crumbs.slice(0, -1);
  return (
    <header className="sticky top-0 z-50 flex h-14 shrink-0 items-center gap-2 border-b bg-background px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 h-4" />
      <div className="min-w-0">
        {parents.length > 0 && (
          <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-muted-foreground">
            {parents.map((c, i) => (
              <span key={`${c.href}-${i}`} className="flex items-center gap-1">
                <Link href={c.href} className="hover:underline">{c.label}</Link>
                <ChevronRight className="h-3 w-3" />
              </span>
            ))}
            <span className="text-foreground">{title}</span>
          </nav>
        )}
        <h1 className="truncate text-sm font-semibold leading-tight">{title}</h1>
      </div>

      <div className="ml-auto flex items-center gap-2">
        {/* [saleschimp-overlay] Notification bell replaces the old
            "Join Slack" link + GitHub star badge. Placeholder content for
            now; wire to a real notifications feed in a later slice. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="relative h-8 w-8"
              aria-label="Notifications"
            >
              <Bell className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            <div className="px-3 py-2 text-sm font-medium">Notifications</div>
            <DropdownMenuSeparator />
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              You&apos;re all caught up.
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

interface AppLayoutProps {
  children: ReactNode;
  headerActions?: ReactNode;
  stickyTabs?: ReactNode;
}

const AppLayout: React.FC<AppLayoutProps> = ({
  children,
  headerActions,
  stickyTabs,
}) => {
  const pathname = usePathname();

  // Hide sidebar for root (/), /handler routes (Stack Auth), and /auth routes.
  const shouldShowSidebar =
    pathname !== "/" &&
    !pathname.startsWith("/handler") &&
    !pathname.startsWith("/auth");

  // Only the exact editor page /workflow/<id>, not sub-routes like /runs.
  const isWorkflowEditor = /^\/workflow\/\d+$/.test(pathname);

  return (
    <SidebarProvider defaultOpen>
      {shouldShowSidebar ? (
        <div className="flex min-h-screen w-full">
          <AppSidebar />
          <SidebarInset className="flex-1">
            {!isWorkflowEditor && <AppHeader />}
            {headerActions && (
              <header className="sticky top-0 z-50 w-full border-b bg-background">
                <div className="container mx-auto px-4 py-4">
                  <div className="flex items-center justify-center">
                    {headerActions}
                  </div>
                </div>
              </header>
            )}

            {stickyTabs && (
              <div className="sticky top-0 z-40 bg-[#2a2e39] border-b border-gray-700">
                <div className="container mx-auto px-4">
                  <div className="flex items-center justify-center py-2">
                    {stickyTabs}
                  </div>
                </div>
              </div>
            )}

            <main className="flex-1">{children}</main>
          </SidebarInset>
        </div>
      ) : (
        <div className="flex-1 w-full">{children}</div>
      )}
    </SidebarProvider>
  );
};

export default AppLayout;
