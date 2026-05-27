"use client";

/**
 * Layout for all authenticated console pages.
 *
 * Every page under app/(authed)/* renders inside the AuthGate (which
 * exchanges the Dograh cookie for a console JWT) + AppShell (sidebar +
 * content area). Public pages skip this group — the only public route
 * today is the / landing page (app/page.tsx) which stays minimal.
 */

import { AppShell } from "@/components/AppShell";
import { AuthGate } from "@/components/AuthGate";

export default function AuthedLayout({ children }: { children: React.ReactNode }) {
  return <AuthGate>{(session) => <AppShell session={session}>{children}</AppShell>}</AuthGate>;
}
