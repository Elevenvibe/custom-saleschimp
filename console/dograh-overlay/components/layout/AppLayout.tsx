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

import { Bell } from "lucide-react";
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

function AppHeader() {
  return (
    <header className="sticky top-0 z-50 flex h-14 shrink-0 items-center gap-2 border-b bg-background px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 h-4" />
      <Link href="/" className="text-sm font-semibold">
        SalesChimp
      </Link>

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
