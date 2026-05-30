"use client";

/**
 * Settings → Finance (placeholder).
 *
 * Intentionally blank for now — the nav slot is reserved so the eventual
 * finance settings (currency, tax/VAT, invoice details, payout config, …)
 * land in a stable place without a later nav reshuffle. Scope to be agreed
 * before wiring a backend.
 */

import { DollarSign } from "lucide-react";

export default function FinanceSettingsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-8">
      <header>
        <h1 className="text-xl font-semibold">Finance</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Finance settings for the platform.
        </p>
      </header>

      <div className="rounded-lg border border-dashed bg-muted/20 p-12 text-center">
        <DollarSign className="mx-auto size-8 text-muted-foreground" />
        <p className="mt-3 text-sm font-medium">Coming soon</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          This section is reserved for finance configuration. Tell us the
          fields you need (currency, tax/VAT, invoice details, payout config)
          and we&apos;ll wire it up.
        </p>
      </div>
    </div>
  );
}
