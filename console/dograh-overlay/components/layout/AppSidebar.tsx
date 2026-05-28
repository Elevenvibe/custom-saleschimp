"use client";

// SALESCHIMP OVERLAY — this file replaces dograh/ui/src/components/layout/
// AppSidebar.tsx at Docker build time. The only intentional diff vs
// upstream is a new BILLING section in NAV_SECTIONS that links to our
// /console/* pages (billing wallet, plans, marketplace).
//
// When upstream Dograh changes their sidebar:
//   1. diff this file vs dograh/ui/src/components/layout/AppSidebar.tsx
//   2. take upstream as the base, re-apply the BILLING section
//   3. update the lucide-react imports if upstream removed an icon we use
// Keep the [saleschimp-overlay] marker comments so a future maintainer
// can find the overlay quickly.

import type { Team } from "@stackframe/stack";
import {
  AlertTriangle,
  ArrowUpCircle,
  AudioLines,
  BarChart3, // [saleschimp-overlay] metrics icon
  Boxes, // [saleschimp-overlay] marketplace icon
  Brain,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  CreditCard, // [saleschimp-overlay] plans icon
  Database,
  FileText,
  Home,
  Key,
  LifeBuoy, // [saleschimp-overlay] tickets icon
  LogOut,
  type LucideIcon,
  Megaphone,
  Phone,
  Settings,
  TrendingUp,
  User, // [saleschimp-overlay] profile icon
  Users, // [saleschimp-overlay] members icon
  Wallet, // [saleschimp-overlay] wallet/billing icon
  Workflow,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import React, { useRef } from "react";

import ThemeToggle from "@/components/ThemeSwitcher";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAppConfig } from "@/context/AppConfigContext";
import { useTelephonyConfigWarnings } from "@/context/TelephonyConfigWarningsContext";
import { useLatestReleaseVersion } from "@/hooks/useLatestReleaseVersion";
import type { LocalUser } from "@/lib/auth";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

type SidebarNavItem = {
  title: string;
  url: string;
  icon: LucideIcon;
  showsTelephonyWarning?: boolean;
};

type SidebarNavSection = {
  label?: string;
  items: SidebarNavItem[];
};

const TELEPHONY_WARNING_COPY = "Action required";

const NAV_SECTIONS: SidebarNavSection[] = [
  {
    items: [
      {
        title: "Overview",
        url: "/overview",
        icon: Home,
      },
    ],
  },
  {
    label: "BUILD",
    items: [
      {
        title: "Voice Agents",
        url: "/workflow",
        icon: Workflow,
      },
      {
        title: "Campaigns",
        url: "/campaigns",
        icon: Megaphone,
      },
      {
        title: "Models",
        url: "/model-configurations",
        icon: Brain,
      },
      {
        title: "Telephony",
        url: "/telephony-configurations",
        icon: Phone,
        showsTelephonyWarning: true,
      },
      {
        title: "Tools",
        url: "/tools",
        icon: Wrench,
      },
      {
        title: "Files",
        url: "/files",
        icon: Database,
      },
      {
        title: "Recordings",
        url: "/recordings",
        icon: AudioLines,
      },
      {
        title: "Developers",
        url: "/api-keys",
        icon: Key,
      },
    ],
  },
  {
    label: "OBSERVE",
    items: [
      {
        title: "Agent Runs",
        url: "/usage",
        icon: TrendingUp,
      },
      // [saleschimp-overlay] Tenant-side metrics view — calls, minutes,
      // cost trend by day. Renders /console/observe/metrics in the bridge
      // iframe so the sidebar stays visible.
      {
        title: "Metrics",
        url: "/console-bridge/observe/metrics",
        icon: BarChart3,
      },
      {
        title: "Reports",
        url: "/reports",
        icon: FileText,
      },
    ],
  },
  // [saleschimp-overlay] ACCOUNT — tenant-side management surfaces that
  // didn't exist in upstream Dograh: Members (invite/remove teammates,
  // change roles) and Tickets (support inbox). Both render in the
  // /console-bridge iframe.
  {
    label: "ACCOUNT",
    items: [
      {
        title: "Members",
        url: "/console-bridge/members",
        icon: Users,
      },
      {
        title: "Tickets",
        url: "/console-bridge/tickets",
        icon: LifeBuoy,
      },
    ],
  },
  // [saleschimp-overlay] BILLING section — these point at
  // /console-bridge/* (a route owned by THIS Dograh app via the
  // dograh-overlay) which renders the matching console page inside an
  // iframe. Net effect: clicks stay on Dograh, sidebar stays visible,
  // and the console sidecar's pages render embedded.
  {
    label: "BILLING",
    items: [
      {
        title: "Wallet",
        url: "/console-bridge/billing",
        icon: Wallet,
      },
      {
        title: "Plans",
        url: "/console-bridge/billing/plans",
        icon: CreditCard,
      },
      {
        title: "Marketplace",
        url: "/console-bridge/marketplace",
        icon: Boxes,
      },
    ],
  },
];

// Lazy load SelectedTeamSwitcher - we'll pass selectedTeam from our context
const StackTeamSwitcher = React.lazy(() =>
  import("@stackframe/stack").then((mod) => ({
    default: mod.SelectedTeamSwitcher,
  }))
);

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { state, isMobile, setOpenMobile } = useSidebar();
  const { provider, getSelectedTeam, logout, user } = useAuth();
  const { config } = useAppConfig();
  const { telnyxMissingWebhookPublicKeyCount } = useTelephonyConfigWarnings();
  const hasTelephonyWarning = telnyxMissingWebhookPublicKeyCount > 0;
  const isCollapsed = !isMobile && state === "collapsed";

  // Get selected team for Stack auth (cast to Team type from Stack)
  // Stabilize the reference so SelectedTeamSwitcher only sees a change when the team ID changes,
  // preventing unnecessary PATCH calls to Stack Auth on every route navigation.
  const selectedTeamRef = useRef<Team | null>(null);
  const rawSelectedTeam = provider === "stack" && getSelectedTeam ? getSelectedTeam() as Team | null : null;
  if (rawSelectedTeam?.id !== selectedTeamRef.current?.id) {
    selectedTeamRef.current = rawSelectedTeam;
  }
  const selectedTeam = selectedTeamRef.current;

  // Version info from app config context
  const versionInfo = config ? { ui: config.uiVersion, api: config.apiVersion } : null;

  // Check for updates only on self-hosted (OSS) deployments — cloud is managed for the user.
  const { latest: latestRelease, isBehind, isLatest } = useLatestReleaseVersion(
    versionInfo?.ui,
    { enabled: config?.deploymentMode === "oss" },
  );

  const isActive = (path: string) => pathname.startsWith(path);

  const handleMobileNavClick = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
  };

  const SidebarLink = ({ item }: { item: SidebarNavItem }) => {
    const isItemActive = isActive(item.url);
    const Icon = item.icon;
    const showWarningDot = item.showsTelephonyWarning && hasTelephonyWarning;
    const tooltip = {
      children: (
        <div className="notranslate" translate="no">
          <p>{item.title}</p>
          {showWarningDot && (
            <p className="text-amber-600 dark:text-amber-400">{TELEPHONY_WARNING_COPY}</p>
          )}
        </div>
      ),
    };
    const warningIndicator = (
      <AlertTriangle
        aria-label="Action required on a telephony configuration"
        className={cn(
          "text-amber-500",
          isCollapsed ? "absolute -right-0.5 -top-0.5 h-3 w-3" : "ml-auto h-3.5 w-3.5"
        )}
      />
    );

    return (
      <SidebarMenuButton
        asChild
        tooltip={tooltip}
        className={cn(
          "hover:bg-accent hover:text-accent-foreground",
          isItemActive && "bg-accent text-accent-foreground"
        )}
      >
        <Link
          href={item.url}
          onClick={handleMobileNavClick}
          className={cn("relative", isCollapsed && "justify-center")}
          translate="no"
        >
          <Icon className="h-4 w-4 shrink-0" />
          <span
            className={cn("notranslate min-w-0 flex-1 truncate", isCollapsed && "sr-only")}
            translate="no"
          >
            {item.title}
          </span>
          {showWarningDot && (
            isCollapsed ? (
              warningIndicator
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  {warningIndicator}
                </TooltipTrigger>
                <TooltipContent side="right">
                  <p>{TELEPHONY_WARNING_COPY}</p>
                </TooltipContent>
              </Tooltip>
            )
          )}
        </Link>
      </SidebarMenuButton>
    );
  };

  return (
    <Sidebar collapsible="icon" className="border-r">
      <SidebarHeader className="border-b px-2 py-3 notranslate" translate="no">
        <div className="flex items-center justify-between">
          <div className={cn("flex items-center gap-2", isCollapsed && "hidden")}>
            <Link
              href="/"
              className="notranslate flex items-center gap-2 px-2 text-xl font-bold"
              translate="no"
            >
              Dograh
              {versionInfo && (
                <span
                  className="notranslate text-xs font-normal text-muted-foreground"
                  translate="no"
                >
                  v{versionInfo.ui}
                </span>
              )}
            </Link>
            {isBehind && latestRelease && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <a
                    href="https://docs.dograh.com/deployment/update"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-md border bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium leading-none text-amber-900 transition-opacity hover:opacity-80 dark:bg-amber-950 dark:text-amber-200"
                  >
                    <ArrowUpCircle className="h-3 w-3" />
                    Update
                  </a>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p>Latest: {latestRelease} — click to see the update guide</p>
                </TooltipContent>
              </Tooltip>
            )}
            {isLatest && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center rounded-md border bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium leading-none text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
                    Latest
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p>You&apos;re running the latest release</p>
                </TooltipContent>
              </Tooltip>
            )}
          </div>

          <SidebarTrigger className={cn("hover:bg-accent", isCollapsed && "mx-auto")}>
            {isCollapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </SidebarTrigger>
        </div>

        {provider === "stack" && (
          <div className={cn("mt-3 notranslate", isCollapsed && "hidden")} translate="no">
            <React.Suspense
              fallback={
                <div className="h-9 w-full animate-pulse rounded bg-muted" />
              }
            >
              <StackTeamSwitcher
                selectedTeam={selectedTeam || undefined}
                onChange={() => {
                  router.refresh();
                }}
              />
            </React.Suspense>
          </div>
        )}
      </SidebarHeader>

      <SidebarContent className={cn("notranslate", isCollapsed && "px-0")} translate="no">
        {NAV_SECTIONS.map((section, index) => (
          <SidebarGroup
            key={section.label ?? "overview"}
            className={index === 0 ? "mt-2" : "mt-6"}
          >
            {section.label && (
              <SidebarGroupLabel
                className={cn(
                  "notranslate text-xs font-semibold uppercase tracking-wider text-muted-foreground",
                  isCollapsed && "hidden"
                )}
                translate="no"
              >
                {section.label}
              </SidebarGroupLabel>
            )}
            <SidebarMenu>
              {section.items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarLink item={item} />
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter
        className={cn("border-t p-4 notranslate", isCollapsed && "p-2")}
        translate="no"
      >
        <div className="space-y-2">
          {provider !== "stack" && (
            <div className={cn("flex", isCollapsed ? "justify-center" : "justify-start")}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 cursor-pointer rounded-full">
                    <span className="text-xs font-medium">
                      {(user?.displayName || (user as LocalUser | undefined)?.email || "")
                        .split(/[\s@]/)
                        .filter(Boolean)
                        .slice(0, 2)
                        .map((s: string) => s[0]?.toUpperCase())
                        .join("")
                        || "U"}
                    </span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="start" className="w-56">
                  <DropdownMenuLabel className="font-normal">
                    <div className="flex flex-col space-y-1">
                      {(user as LocalUser | undefined)?.email && (
                        <p className="text-xs text-muted-foreground">{(user as LocalUser).email}</p>
                      )}
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {/* [saleschimp-overlay] Profile — the *user's* own page
                      (name, email, password) as opposed to the *org's*
                      settings below. Lives at /console/profile so users
                      who land directly on /console can still get to it. */}
                  <DropdownMenuItem onClick={() => router.push("/console-bridge/profile")} className="cursor-pointer">
                    <User className="mr-2 h-4 w-4" />
                    Profile
                  </DropdownMenuItem>
                  {/* [saleschimp-overlay] Organization settings — opens the
                      tenant org-admin page inside the console iframe. Local-
                      auth branch (most tenants use this). Mirrored in the
                      Stack-auth branch below; if you change one, change both. */}
                  <DropdownMenuItem onClick={() => router.push("/console-bridge/settings/organization")} className="cursor-pointer">
                    <Settings className="mr-2 h-4 w-4" />
                    Organization settings
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => router.push("/settings")} className="cursor-pointer">
                    <Settings className="mr-2 h-4 w-4" />
                    Platform Settings
                  </DropdownMenuItem>
                  {/* [saleschimp-overlay] Wrap logout so we also drop the
                      console's localStorage token. Otherwise a Dograh sign-
                      out leaves a zombie sc_console_token alive that would
                      log the next user into the previous tenant for one
                      mount before AuthGate cycles. */}
                  <DropdownMenuItem
                    onClick={() => {
                      try {
                        if (typeof window !== "undefined") {
                          localStorage.removeItem("sc_console_token");
                        }
                      } catch {
                        // localStorage may be disabled — non-fatal, Dograh
                        // logout still proceeds.
                      }
                      logout();
                    }}
                    className="cursor-pointer"
                  >
                    <LogOut className="mr-2 h-4 w-4" />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}

          {provider === "stack" && (
            <div className={cn("flex", isCollapsed ? "justify-center" : "justify-start")}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 cursor-pointer rounded-full">
                    <span className="text-xs font-medium">
                      {(user?.displayName || (user as { primaryEmail?: string })?.primaryEmail || "")
                        .split(/[\s@]/)
                        .filter(Boolean)
                        .slice(0, 2)
                        .map((s: string) => s[0]?.toUpperCase())
                        .join("")
                        || "U"}
                    </span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="start" className="w-56">
                  <DropdownMenuLabel className="font-normal">
                    <div className="flex flex-col space-y-1">
                      {user?.displayName && (
                        <p className="text-sm font-medium">{user.displayName}</p>
                      )}
                      {(user as { primaryEmail?: string })?.primaryEmail && (
                        <p className="text-xs text-muted-foreground">{(user as { primaryEmail?: string }).primaryEmail}</p>
                      )}
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {/* [saleschimp-overlay] /handler/account-settings is Stack
                      Auth's route — in OSS / local-auth mode it returns
                      "Stack Auth handler is disabled". Only render this
                      item when the active auth provider is Stack; local-
                      auth users get sign-out + the other settings rows. */}
                  {provider === "stack" && (
                    <DropdownMenuItem onClick={() => router.push("/handler/account-settings")} className="cursor-pointer">
                      <Settings className="mr-2 h-4 w-4" />
                      Account settings
                    </DropdownMenuItem>
                  )}
                  {/* [saleschimp-overlay] Profile — Stack-auth branch
                      mirror of the local-auth Profile entry above. */}
                  <DropdownMenuItem onClick={() => router.push("/console-bridge/profile")} className="cursor-pointer">
                    <User className="mr-2 h-4 w-4" />
                    Profile
                  </DropdownMenuItem>
                  {/* [saleschimp-overlay] Organization settings — opens the
                      tenant org-admin page inside the console iframe so the
                      Dograh chrome stays visible. Lives above "Platform
                      Settings" because it's the more common destination
                      (every org-admin tweaks branding / concurrency /
                      add-ons; Platform Settings is the rarer admin path). */}
                  <DropdownMenuItem onClick={() => router.push("/console-bridge/settings/organization")} className="cursor-pointer">
                    <Settings className="mr-2 h-4 w-4" />
                    Organization settings
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => router.push("/settings")} className="cursor-pointer">
                    <Settings className="mr-2 h-4 w-4" />
                    Platform Settings
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => router.push("/usage")} className="cursor-pointer">
                    <CircleDollarSign className="mr-2 h-4 w-4" />
                    Usage
                  </DropdownMenuItem>
                  {/* [saleschimp-overlay] Mirrors the local-auth branch — drop
                      the console token alongside Dograh's logout so the two
                      sessions tear down together. */}
                  <DropdownMenuItem
                    onClick={() => {
                      try {
                        if (typeof window !== "undefined") {
                          localStorage.removeItem("sc_console_token");
                        }
                      } catch {
                        // localStorage may be disabled — non-fatal.
                      }
                      logout();
                    }}
                    className="cursor-pointer"
                  >
                    <LogOut className="mr-2 h-4 w-4" />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}

          <div className={cn("mt-2 border-t pt-2", isCollapsed && "flex justify-center")}>
            {isCollapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="notranslate" translate="no">
                    <ThemeToggle
                      showLabel={false}
                      className="hover:bg-accent hover:text-accent-foreground"
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <p>Toggle theme</p>
                </TooltipContent>
              </Tooltip>
            ) : (
              <div className="notranslate" translate="no">
                <ThemeToggle
                  showLabel={true}
                  className="hover:bg-accent hover:text-accent-foreground"
                />
              </div>
            )}
          </div>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
