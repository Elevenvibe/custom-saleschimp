import { Sparkles } from "lucide-react";

/**
 * Centered card shell for public auth flows (signup, verify, accept-invite,
 * login). No AuthGate, no AppShell — these pages render before the user has
 * a session.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[color:var(--muted)] p-6">
      <div className="mb-6 flex items-center gap-2 text-[color:var(--foreground)]">
        <div className="flex aspect-square size-9 items-center justify-center rounded-lg bg-[color:var(--primary)] text-[color:var(--primary-foreground)]">
          <Sparkles className="size-5" />
        </div>
        <div className="text-lg font-semibold">SalesChimp</div>
      </div>
      <div className="w-full max-w-md rounded-lg border border-[color:var(--border)] bg-[color:var(--card)] shadow-sm">
        <div className="border-b border-[color:var(--border)] p-6">
          <h1 className="text-xl font-semibold">{title}</h1>
          {subtitle && (
            <p className="mt-1 text-sm text-[color:var(--muted-foreground)]">{subtitle}</p>
          )}
        </div>
        <div className="p-6">{children}</div>
      </div>
      {footer && <div className="mt-6 text-sm text-[color:var(--muted-foreground)]">{footer}</div>}
    </div>
  );
}
