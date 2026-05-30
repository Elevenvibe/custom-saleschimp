"use client";
import { ComingSoon } from "@/components/ComingSoon";
export default function Page() {
  return (
    <ComingSoon
      title="Finance"
      description="Invoice numbering, templates, payment instructions, accounting integrations, and estimating defaults — coming next."
      tabs={[
        "Invoice settings",
        "Invoice template",
        "Prefix settings",
        "Units",
        "Accounting (QuickBooks) — coming soon",
        "Invoice payment details",
        "Estimating",
      ]}
    />
  );
}
