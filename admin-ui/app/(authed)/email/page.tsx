"use client";

/**
 * /email — super-admin platform mailbox.
 *
 * Same gmail-style two-pane layout as /tickets, but the inbox is bound
 * to the IMAP credentials configured under Settings → Email providers →
 * IMAP tab. SMTP credentials drive the outbox.
 *
 * Live fetch + send via aioimaplib + aiosmtplib is queued in a follow-up
 * (P-Email-2). Today this page does three things:
 *
 *   1. Surfaces whether IMAP/SMTP is configured at all (calls
 *      /api/admin/mailbox to read the active flags).
 *   2. Shows an empty-state guiding the user to configure credentials
 *      when they're absent.
 *   3. Renders the layout so the visual design is in place — the inbox
 *      list and detail pane swap in real messages once the fetcher
 *      ships, with no markup churn.
 */

import { useEffect, useState } from "react";
import Link from "next/link";

import { api } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Inbox, Settings as SettingsIcon } from "lucide-react";

type MailboxOut = {
  smtp_active: boolean;
  imap_active: boolean;
  from_email: string | null;
  from_name: string | null;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_username: string | null;
  imap_host: string | null;
  imap_port: number | null;
  imap_username: string | null;
};

export default function EmailPage() {
  const [mailbox, setMailbox] = useState<MailboxOut | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<MailboxOut>("/api/admin/mailbox")
      .then(setMailbox)
      .catch((e) => setError((e as Error).message));
  }, []);

  const configured = mailbox?.imap_active && mailbox?.smtp_active;

  return (
    <>
      <PageHeader title="Email" parents={[{ label: "Communication" }]} />
      <div className="flex h-[calc(100vh-3.5rem)]">
        {/* Left inner sidebar — folders + (eventual) message preambles */}
        <div className="w-[360px] shrink-0 border-r bg-muted/20 flex flex-col">
          <div className="border-b p-3 space-y-1 text-xs">
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md bg-primary/5 px-2 py-1.5 text-left font-medium"
            >
              <Inbox className="h-3.5 w-3.5" />
              Inbox
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 text-xs text-muted-foreground">
            {!mailbox ? (
              "Loading…"
            ) : !configured ? (
              <EmptyInboxConfigPrompt mailbox={mailbox} />
            ) : (
              "Inbox fetcher (IMAP) is configured but the worker that pulls messages into the local store is queued in P-Email-2. No messages to show yet."
            )}
          </div>
        </div>

        {/* Right pane: empty until a message is selected */}
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
          <div className="text-center max-w-md">
            <Inbox className="mx-auto h-10 w-10 opacity-30" />
            <div className="mt-3">
              {configured
                ? "Pick a message from the inbox to read."
                : "Configure IMAP + SMTP to start pulling and sending mail."}
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive shadow">
          {error}
        </div>
      )}
    </>
  );
}

function EmptyInboxConfigPrompt({ mailbox }: { mailbox: MailboxOut }) {
  return (
    <div className="space-y-3">
      <div>
        Email is bound to the platform mailbox configured in{" "}
        <Link
          href="/settings/email-providers?tab=imap"
          className="underline text-foreground"
        >
          Settings → Email providers → IMAP
        </Link>
        .
      </div>
      <div className="rounded-md border bg-card p-3 text-xs">
        <div className="flex items-center justify-between">
          <span>IMAP (inbox)</span>
          <span
            className={mailbox.imap_active ? "text-emerald-600" : "text-amber-600"}
          >
            {mailbox.imap_active ? "active" : "not configured"}
          </span>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <span>SMTP (outbox)</span>
          <span
            className={mailbox.smtp_active ? "text-emerald-600" : "text-amber-600"}
          >
            {mailbox.smtp_active ? "active" : "not configured"}
          </span>
        </div>
      </div>
      <Link href="/settings/email-providers?tab=imap">
        <Button size="sm" variant="outline" className="w-full">
          <SettingsIcon className="h-3.5 w-3.5" /> Configure
        </Button>
      </Link>
    </div>
  );
}
