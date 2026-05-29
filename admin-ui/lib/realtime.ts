"use client";

/**
 * useRealtimeRefresh — subscribe to Pusher Channels for live notification
 * nudges, calling `onEvent` whenever one arrives.
 *
 * Design notes:
 *   - pusher-js is loaded lazily from the CDN ONLY when the realtime config
 *     reports Pusher enabled, so disabled deployments ship zero extra JS and
 *     make no third-party requests.
 *   - We subscribe to a PUBLIC per-recipient channel. The pushed event has no
 *     sensitive payload — it just tells the client to re-fetch from the
 *     authenticated REST endpoint. No private-channel auth endpoint needed.
 *   - If anything fails (no config, CDN blocked, bad creds), we silently fall
 *     back to the caller's polling.
 */

import { useEffect } from "react";

import { api } from "@/lib/api";

const PUSHER_SRC = "https://js.pusher.com/8.4.0/pusher.min.js";

type RealtimeConfig = {
  pusher: { enabled: boolean; key: string; cluster: string; channel: string; event: string };
};

// Minimal shape of the bits of pusher-js we use.
interface PusherChannel {
  bind: (event: string, cb: () => void) => void;
}
interface PusherClient {
  subscribe: (channel: string) => PusherChannel;
  unsubscribe: (channel: string) => void;
  disconnect: () => void;
}
interface PusherCtor {
  new (key: string, opts: { cluster: string }): PusherClient;
}
declare global {
  interface Window {
    Pusher?: PusherCtor;
  }
}

function loadPusherScript(): Promise<PusherCtor | null> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") return resolve(null);
    if (window.Pusher) return resolve(window.Pusher);
    const existing = document.querySelector<HTMLScriptElement>("script[data-pusher]");
    if (existing) {
      existing.addEventListener("load", () => resolve(window.Pusher ?? null));
      existing.addEventListener("error", () => resolve(null));
      return;
    }
    const s = document.createElement("script");
    s.src = PUSHER_SRC;
    s.async = true;
    s.setAttribute("data-pusher", "1");
    s.addEventListener("load", () => resolve(window.Pusher ?? null));
    s.addEventListener("error", () => resolve(null));
    document.head.appendChild(s);
  });
}

export function useRealtimeRefresh(configPath: string, onEvent: () => void): void {
  useEffect(() => {
    let client: PusherClient | null = null;
    let channelName = "";
    let cancelled = false;

    (async () => {
      let cfg: RealtimeConfig | null = null;
      try {
        cfg = await api<RealtimeConfig>(configPath);
      } catch {
        return; // fall back to polling
      }
      const p = cfg?.pusher;
      if (!p?.enabled || !p.key || !p.cluster || !p.channel) return;

      const Ctor = await loadPusherScript();
      if (!Ctor || cancelled) return;

      try {
        client = new Ctor(p.key, { cluster: p.cluster });
        channelName = p.channel;
        const channel = client.subscribe(channelName);
        channel.bind(p.event || "notification", () => onEvent());
      } catch {
        client = null;
      }
    })();

    return () => {
      cancelled = true;
      try {
        if (client && channelName) client.unsubscribe(channelName);
        client?.disconnect();
      } catch {
        /* noop */
      }
    };
  }, [configPath, onEvent]);
}
