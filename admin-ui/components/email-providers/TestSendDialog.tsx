"use client";

import { useState } from "react";

import { api, type EmailProvider } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  provider: EmailProvider;
  onClose: () => void;
};

export function TestSendDialog({ provider, onClose }: Props) {
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("SalesChimp test email");
  const [body, setBody] = useState(
    "This is a test email from your SalesChimp email provider config."
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const r = await api<{ provider: string; message_id: string | null }>(
        `/api/admin/email-providers/${provider.id}/test-send`,
        { method: "POST", body: JSON.stringify({ to, subject, body }) }
      );
      setOk(`Sent via ${r.provider}${r.message_id ? ` (id: ${r.message_id})` : ""}.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send test email</DialogTitle>
          <DialogDescription>
            Via <code className="font-mono">{provider.provider}</code> ·{" "}
            {provider.scope_kind === "platform" ? "platform" : `tenant #${provider.scope_id}`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Recipient</Label>
            <Input
              type="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="you@example.com"
            />
          </div>
          <div>
            <Label>Subject</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div>
            <Label>Body</Label>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
            />
          </div>
          {error && (
            <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          )}
          {ok && (
            <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              {ok}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button onClick={send} disabled={busy || !to}>
            {busy ? "Sending…" : "Send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
