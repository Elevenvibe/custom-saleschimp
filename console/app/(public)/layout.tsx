/**
 * Layout for public (non-authed) console pages. Skips AuthGate +
 * AppShell — these pages render before the user has a session.
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
