"use client";

import * as React from "react";
import Link from "next/link";

import { NavMain, type NavItem } from "@/components/nav-main";
import { NavUser } from "@/components/nav-user";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import {
  LayoutDashboard,
  Building2,
  Users,
  ScrollText,
  Package,
  PlugZap,
  Send,
  Sparkles,
  Coins,
  Settings,
  Wallet,
  Boxes,
} from "lucide-react";

const nav: NavItem[] = [
  { title: "Dashboard", url: "/dashboard", icon: <LayoutDashboard /> },
  { title: "Tenants", url: "/tenants", icon: <Building2 /> },
  { title: "Platform users", url: "/platform-users", icon: <Users /> },
  { title: "Invites", url: "/invites", icon: <Send /> },
  { title: "Audit log", url: "/audit", icon: <ScrollText /> },
  { title: "Packages", url: "/packages", icon: <Package /> },
  { title: "Cost catalog", url: "/cost-catalog", icon: <Coins /> },
  { title: "Billing", url: "/billing", icon: <Wallet /> },
  { title: "Marketplace", url: "/marketplace", icon: <Boxes /> },
  { title: "Plugins (runtime)", url: "/plugins", icon: <PlugZap /> },
  { title: "Settings", url: "/settings", icon: <Settings /> },
];

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/dashboard">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <Sparkles className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">SalesChimp</span>
                  <span className="truncate text-xs text-muted-foreground">super-admin</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={nav} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
