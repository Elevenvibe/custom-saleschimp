// SALESCHIMP OVERLAY — shadcn `breadcrumb` primitive (new-york style).
//
// This file is the PROOF + TEMPLATE for the overlay-ui pattern. It lands
// at src/components/ui/breadcrumb.tsx at Docker build time via the
// `COPY console/dograh-overlay/ ./src/` line in Dockerfile.ui, so it
// resolves through Dograh's `@/components/ui` alias exactly like a
// natively-installed shadcn component — WITHOUT running `npx shadcn add`
// inside the dograh/ submodule (which would be wiped on the next
// `update-dograh.sh`).
//
// HOW TO ADD MORE SHADCN COMPONENTS THE SAFE WAY:
//   1. Generate the component anywhere OUTSIDE the submodule — e.g.
//        npx shadcn@latest add <name>     (in admin-ui/ or a scratch dir)
//   2. Copy the generated src/components/ui/<name>.tsx into
//        console/dograh-overlay/components/ui/<name>.tsx
//   3. Fix the import style if needed: Dograh uses the INDIVIDUAL radix
//      packages (@radix-ui/react-slot), NOT the `radix-ui` umbrella that
//      admin-ui uses. Check dograh/ui/package.json for the dep before
//      relying on it — if the component needs a radix package Dograh
//      doesn't ship, the build will fail to resolve the import.
//   4. docker compose build ui && docker compose up -d --force-recreate ui
//
// Dograh was MISSING breadcrumb (it has sidebar/sheet/tooltip/etc. but
// not this one), so this is a real gap-fill, not a redundant overwrite.

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { ChevronRight, MoreHorizontal } from "lucide-react";

import { cn } from "@/lib/utils";

function Breadcrumb({ ...props }: React.ComponentProps<"nav">) {
  return <nav aria-label="breadcrumb" data-slot="breadcrumb" {...props} />;
}

function BreadcrumbList({ className, ...props }: React.ComponentProps<"ol">) {
  return (
    <ol
      data-slot="breadcrumb-list"
      className={cn(
        "flex flex-wrap items-center gap-1.5 break-words text-sm text-muted-foreground sm:gap-2.5",
        className,
      )}
      {...props}
    />
  );
}

function BreadcrumbItem({ className, ...props }: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="breadcrumb-item"
      className={cn("inline-flex items-center gap-1.5", className)}
      {...props}
    />
  );
}

function BreadcrumbLink({
  asChild,
  className,
  ...props
}: React.ComponentProps<"a"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "a";
  return (
    <Comp
      data-slot="breadcrumb-link"
      className={cn("transition-colors hover:text-foreground", className)}
      {...props}
    />
  );
}

function BreadcrumbPage({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="breadcrumb-page"
      role="link"
      aria-disabled="true"
      aria-current="page"
      className={cn("font-normal text-foreground", className)}
      {...props}
    />
  );
}

function BreadcrumbSeparator({
  children,
  className,
  ...props
}: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="breadcrumb-separator"
      role="presentation"
      aria-hidden="true"
      className={cn("[&>svg]:size-3.5", className)}
      {...props}
    >
      {children ?? <ChevronRight />}
    </li>
  );
}

function BreadcrumbEllipsis({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="breadcrumb-ellipsis"
      role="presentation"
      aria-hidden="true"
      className={cn("flex size-9 items-center justify-center", className)}
      {...props}
    >
      <MoreHorizontal className="size-4" />
      <span className="sr-only">More</span>
    </span>
  );
}

export {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
  BreadcrumbEllipsis,
};
