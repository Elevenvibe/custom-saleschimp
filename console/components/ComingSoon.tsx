"use client";

/**
 * Shared "coming soon" placeholder. Used by every tenant settings area that
 * isn't yet wired so each placeholder page is a 1-liner.
 */

import { Sparkles } from "lucide-react";

export function ComingSoon({
  title,
  description,
  tabs,
}: {
  title: string;
  description: string;
  tabs?: string[];
}) {
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-8">
      <header>
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </header>

      {tabs && tabs.length > 0 && (
        <div className="flex flex-wrap gap-1 border-b">
          {tabs.map((t) => (
            <span
              key={t}
              className="rounded-t-md border border-b-0 bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground"
            >
              {t}
            </span>
          ))}
        </div>
      )}

      <div className="rounded-lg border border-dashed bg-muted/20 p-12 text-center">
        <Sparkles className="mx-auto size-8 text-muted-foreground" />
        <p className="mt-3 text-sm font-medium">Coming soon</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          We&apos;re actively building this. Reach out to support if you have
          specific requirements you&apos;d like included.
        </p>
      </div>
    </div>
  );
}
