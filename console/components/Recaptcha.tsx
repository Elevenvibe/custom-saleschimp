"use client";

/**
 * Recaptcha — renders the Google reCAPTCHA widget when it's enabled in
 * Settings → Security, and exposes execute() to fetch a token on submit.
 *
 * - Reads the public config from /api/auth/recaptcha-config (enabled,
 *   version, site_key — never the secret).
 * - v2: renders the "I'm not a robot" checkbox; execute() returns the
 *   solved response (or null if unchecked).
 * - v3: invisible; execute() runs grecaptcha.execute with an action.
 * - When disabled/unconfigured it renders nothing and execute() → null,
 *   so forms work unchanged until an admin turns it on.
 */

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

interface Grecaptcha {
  ready: (cb: () => void) => void;
  execute: (siteKey: string, opts: { action: string }) => Promise<string>;
  render: (el: HTMLElement, opts: { sitekey: string }) => number;
  getResponse: (id?: number) => string;
}
declare global {
  interface Window {
    grecaptcha?: Grecaptcha;
  }
}

type Cfg = { enabled: boolean; version: "v2" | "v3"; site_key: string };

export type RecaptchaHandle = { execute: () => Promise<string | null> };

export const Recaptcha = forwardRef<RecaptchaHandle, { gateway: string; action?: string }>(
  function Recaptcha({ gateway, action = "login" }, ref) {
    const [cfg, setCfg] = useState<Cfg | null>(null);
    const widgetId = useRef<number | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      fetch(`${gateway}/api/auth/recaptcha-config`)
        .then((r) => r.json())
        .then(setCfg)
        .catch(() => setCfg({ enabled: false, version: "v2", site_key: "" }));
    }, [gateway]);

    useEffect(() => {
      if (!cfg?.enabled || !cfg.site_key) return;
      const src =
        cfg.version === "v3"
          ? `https://www.google.com/recaptcha/api.js?render=${cfg.site_key}`
          : "https://www.google.com/recaptcha/api.js";
      if (!document.querySelector("script[data-recaptcha]")) {
        const s = document.createElement("script");
        s.src = src;
        s.async = true;
        s.defer = true;
        s.setAttribute("data-recaptcha", "1");
        document.head.appendChild(s);
      }
      if (cfg.version === "v2") {
        const iv = setInterval(() => {
          if (window.grecaptcha?.render && containerRef.current && widgetId.current === null) {
            try {
              widgetId.current = window.grecaptcha.render(containerRef.current, {
                sitekey: cfg.site_key,
              });
            } catch {
              /* already rendered */
            }
            clearInterval(iv);
          }
        }, 300);
        return () => clearInterval(iv);
      }
    }, [cfg]);

    useImperativeHandle(
      ref,
      () => ({
        async execute() {
          if (!cfg?.enabled || !cfg.site_key || !window.grecaptcha) return null;
          if (cfg.version === "v3") {
            return new Promise<string | null>((resolve) => {
              window.grecaptcha!.ready(() => {
                window
                  .grecaptcha!.execute(cfg.site_key, { action })
                  .then(resolve)
                  .catch(() => resolve(null));
              });
            });
          }
          const resp = window.grecaptcha.getResponse(widgetId.current ?? undefined);
          return resp || null;
        },
      }),
      [cfg, action],
    );

    if (!cfg?.enabled) return null;
    if (cfg.version === "v2") return <div ref={containerRef} className="my-2" />;
    return null;
  },
);
