"use client";

import Link from "next/link";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";

/** Breadcrumb crumb. label + url means it's a link; url omitted means
 *  it's the terminal page (BreadcrumbPage). Pass the list ordered
 *  root-to-current, e.g. [{label: "Tenants", url: "/tenants"}] for the
 *  /tenants/[id] page, paired with title="Tenant: Acme". */
export type Crumb = { label: string; url?: string };

export function PageHeader({
  title,
  parents,
  action,
}: {
  title: string;
  parents?: Crumb[];
  action?: React.ReactNode;
}) {
  return (
    <header className="sticky top-0 z-20 flex shrink-0 items-center gap-2 border-b bg-background transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
      <div className="flex h-14 w-full items-center gap-2 px-4">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mr-2 data-vertical:h-4 data-vertical:self-auto" />
        <Breadcrumb>
          <BreadcrumbList>
            {parents?.map((c) => (
              <span key={`${c.label}-${c.url ?? ""}`} className="flex items-center gap-1.5">
                <BreadcrumbItem>
                  {c.url ? (
                    <BreadcrumbLink asChild>
                      <Link href={c.url}>{c.label}</Link>
                    </BreadcrumbLink>
                  ) : (
                    <span className="text-muted-foreground">{c.label}</span>
                  )}
                </BreadcrumbItem>
                <BreadcrumbSeparator />
              </span>
            ))}
            <BreadcrumbItem>
              <BreadcrumbPage>{title}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div className="ml-auto">{action}</div>
      </div>
    </header>
  );
}

export function PageDescription({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}
