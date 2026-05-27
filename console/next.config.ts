import type { NextConfig } from "next";

/**
 * Console = the tenant-facing SaaS pages (billing, marketplace, wallet, etc.)
 * that live INSIDE the unified Dograh experience.
 *
 * basePath="/console" means every route in this app gets the `/console` prefix
 * — so `app/page.tsx` becomes `/console`, `app/billing/page.tsx` becomes
 * `/console/billing`, etc. That way nginx can do a flat path-based route from
 * the unified URL: `localhost:8081/console/*` → console:3040/console/*.
 *
 * `output: "standalone"` keeps the runtime image small — Next.js bundles
 * everything needed to serve into `.next/standalone`, which the Dockerfile
 * copies into a node:alpine runtime stage. Matches the pattern used by
 * admin-ui and app-ui.
 */
const nextConfig: NextConfig = {
  basePath: "/console",
  output: "standalone",
  reactStrictMode: true,
  // Disable image optimisation in dev to dodge a Next quirk where /_next/image
  // requests don't pick up the basePath consistently when behind a proxy.
  // We'll re-enable + configure once nginx is in front.
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
