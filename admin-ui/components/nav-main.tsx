"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { useState } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";

export type NavItem = {
  title: string;
  url: string;
  icon?: React.ReactNode;
  // When present, the item renders as a collapsible group. The `url`
  // field becomes the prefix used to decide active state for the parent.
  // The Communication group (Email + Tickets) uses this; everything else
  // stays flat to keep the sidebar quick to scan.
  children?: { title: string; url: string }[];
};

export function NavMain({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <SidebarGroup>
      <SidebarMenu>
        {items.map((item) =>
          item.children && item.children.length > 0 ? (
            <CollapsibleNavItem key={item.title} item={item} pathname={pathname} />
          ) : (
            <SingleNavItem key={item.url} item={item} pathname={pathname} />
          ),
        )}
      </SidebarMenu>
    </SidebarGroup>
  );
}

function SingleNavItem({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = pathname === item.url || pathname.startsWith(item.url + "/");
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild tooltip={item.title} isActive={active}>
        <Link href={item.url}>
          {item.icon}
          <span>{item.title}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function CollapsibleNavItem({ item, pathname }: { item: NavItem; pathname: string }) {
  // Group is "active" iff any child route matches — also drives the
  // default open state so a deep link lands with the right group expanded.
  const childActive = (item.children ?? []).some(
    (c) => pathname === c.url || pathname.startsWith(c.url + "/"),
  );
  const [open, setOpen] = useState(childActive);

  return (
    <Collapsible asChild open={open} onOpenChange={setOpen} className="group/collapsible">
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton tooltip={item.title} isActive={childActive}>
            {item.icon}
            <span>{item.title}</span>
            <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {item.children!.map((child) => {
              const active = pathname === child.url || pathname.startsWith(child.url + "/");
              return (
                <SidebarMenuSubItem key={child.url}>
                  <SidebarMenuSubButton asChild isActive={active}>
                    <Link href={child.url}>
                      <span>{child.title}</span>
                    </Link>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              );
            })}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}
