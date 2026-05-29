"use client";

/**
 * SupportWidget — relocated from the tenant Dograh UI (Chatwoot floating
 * bubble). Mounts the Chatwoot SDK only for super-admins holding the
 * `support_widget` permission. Tenants no longer get the widget (the
 * Dograh ChatwootWidget overlay was neutralized to a no-op).
 *
 * Reads NEXT_PUBLIC_CHATWOOT_URL / NEXT_PUBLIC_CHATWOOT_TOKEN; no-ops if
 * unset (so the build/dev works without Chatwoot configured). Same SDK
 * dance Dograh used, minus the per-route hiding (admin has no workflow
 * editor to hide it on).
 */

import { useEffect } from "react";

import { usePermissions } from "@/lib/usePermissions";

declare global {
  interface Window {
    chatwootSDK?: { run: (c: { websiteToken: string; baseUrl: string }) => void };
    chatwootSettings?: {
      position?: "left" | "right";
      type?: "standard" | "expanded_bubble";
      launcherTitle?: string;
    };
  }
}

const BASE_URL = process.env.NEXT_PUBLIC_CHATWOOT_URL;
const TOKEN = process.env.NEXT_PUBLIC_CHATWOOT_TOKEN;

export function SupportWidget() {
  const { loaded, can } = usePermissions();
  const allowed = can("support_widget");

  useEffect(() => {
    if (!loaded || !allowed) return;
    if (!BASE_URL || !TOKEN) {
      // Not configured — silently skip (dev / unconfigured deploys).
      return;
    }
    if (window.chatwootSettings) return; // already initialised

    window.chatwootSettings = {
      position: "right",
      type: "standard",
      launcherTitle: "Support",
    };

    const existing = document.querySelector(
      `script[src="${BASE_URL}/packs/js/sdk.js"]`,
    );
    if (existing) {
      window.chatwootSDK?.run({ websiteToken: TOKEN, baseUrl: BASE_URL });
      return;
    }

    const script = document.createElement("script");
    script.src = `${BASE_URL}/packs/js/sdk.js`;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      window.chatwootSDK?.run({ websiteToken: TOKEN, baseUrl: BASE_URL });
    };
    document.body.appendChild(script);
  }, [loaded, allowed]);

  return null;
}
