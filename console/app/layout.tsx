import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import "./globals.css";

// Match Dograh exactly — it also loads Geist / Geist Mono via next/font so
// the unified URL (Dograh + console behind one nginx origin) renders one
// consistent typeface at the same size.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SalesChimp Console",
  description: "Billing, plans, and marketplace for SalesChimp tenants.",
};

export default function ConsoleRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
