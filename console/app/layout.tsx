import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "SalesChimp Console",
  description: "Billing, plans, and marketplace for SalesChimp tenants.",
};

/**
 * Root layout for the console sidecar.
 *
 * We deliberately keep this stripped down — no providers, no auth wrapper,
 * no sidebar. Those come in the next iteration once nginx fronts both Dograh
 * and console at one origin and we can read Dograh's auth cookie from here.
 *
 * For Step A (this iteration) the only thing we need to prove is that
 * `localhost:3040/console` returns a working page from our container.
 */
export default function ConsoleRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
