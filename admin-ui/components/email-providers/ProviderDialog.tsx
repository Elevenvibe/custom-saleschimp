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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type ProviderName = "resend" | "ses" | "postmark" | "smtp";

type Props = {
  mode: "create" | "edit";
  existing: EmailProvider | null;
  onClose: () => void;
  onSaved: () => void;
};

export function ProviderDialog({ mode, existing, onClose, onSaved }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [provider, setProvider] = useState<ProviderName>(
    (existing?.provider as ProviderName) || "resend"
  );
  const [scopeKind] = useState<"platform" | "tenant">(existing?.scope_kind ?? "platform");
  const [fromEmail, setFromEmail] = useState(existing?.from_email ?? "noreply@example.com");
  const [fromName, setFromName] = useState(existing?.from_name ?? "");
  const [isActive, setIsActive] = useState(existing?.is_active ?? true);

  // Provider-specific secret fields. Empty on edit means "don't change secrets".
  const [resendKey, setResendKey] = useState("");
  const [sesRegion, setSesRegion] = useState("us-east-1");
  const [sesKey, setSesKey] = useState("");
  const [sesSecret, setSesSecret] = useState("");
  const [postmarkToken, setPostmarkToken] = useState("");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState(587);
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [smtpTls, setSmtpTls] = useState(true);

  function buildPayload(): Record<string, unknown> {
    const base: Record<string, unknown> = {
      from_email: fromEmail,
      from_name: fromName || null,
      is_active: isActive,
    };
    if (mode === "create") {
      base.scope_kind = scopeKind;
      base.provider = provider;
    }
    const wantSecrets = mode === "create" || hasSecrets();
    if (wantSecrets) {
      if (provider === "resend") base.resend = { api_key: resendKey };
      else if (provider === "ses")
        base.ses = {
          region: sesRegion,
          access_key_id: sesKey,
          secret_access_key: sesSecret,
        };
      else if (provider === "postmark") base.postmark = { server_token: postmarkToken };
      else if (provider === "smtp")
        base.smtp = {
          host: smtpHost,
          port: smtpPort,
          username: smtpUser || null,
          password: smtpPass || null,
          use_tls: smtpTls,
        };
    }
    return base;
  }

  function hasSecrets(): boolean {
    if (provider === "resend") return !!resendKey;
    if (provider === "ses") return !!(sesRegion && sesKey && sesSecret);
    if (provider === "postmark") return !!postmarkToken;
    if (provider === "smtp") return !!smtpHost;
    return false;
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const body = buildPayload();
      if (mode === "create") {
        await api("/api/admin/email-providers", {
          method: "POST",
          body: JSON.stringify(body),
        });
      } else if (existing) {
        await api(`/api/admin/email-providers/${existing.id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      }
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "Configure email provider" : "Edit provider"}
          </DialogTitle>
          <DialogDescription>
            {mode === "edit" &&
              "Leave secret fields blank to keep the existing values. Filling any field replaces all secrets for this provider."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {mode === "create" && (
            <div>
              <Label>Provider</Label>
              <Select
                value={provider}
                onValueChange={(v) => setProvider(v as ProviderName)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="resend">Resend</SelectItem>
                  <SelectItem value="ses">Amazon SES</SelectItem>
                  <SelectItem value="postmark">Postmark</SelectItem>
                  <SelectItem value="smtp">Generic SMTP</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>From email</Label>
              <Input
                type="email"
                value={fromEmail}
                onChange={(e) => setFromEmail(e.target.value)}
              />
            </div>
            <div>
              <Label>From name (optional)</Label>
              <Input value={fromName} onChange={(e) => setFromName(e.target.value)} />
            </div>
          </div>

          {/* Provider-specific fields */}
          {provider === "resend" && (
            <div>
              <Label>API key</Label>
              <Input
                type="password"
                placeholder={mode === "edit" ? "leave blank to keep" : "re_..."}
                value={resendKey}
                onChange={(e) => setResendKey(e.target.value)}
              />
            </div>
          )}

          {provider === "ses" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Region</Label>
                  <Input
                    placeholder="us-east-1"
                    value={sesRegion}
                    onChange={(e) => setSesRegion(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Access key ID</Label>
                  <Input
                    placeholder={mode === "edit" ? "leave blank to keep" : "AKIA..."}
                    value={sesKey}
                    onChange={(e) => setSesKey(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <Label>Secret access key</Label>
                <Input
                  type="password"
                  placeholder={mode === "edit" ? "leave blank to keep" : ""}
                  value={sesSecret}
                  onChange={(e) => setSesSecret(e.target.value)}
                />
              </div>
            </>
          )}

          {provider === "postmark" && (
            <div>
              <Label>Server token</Label>
              <Input
                type="password"
                placeholder={mode === "edit" ? "leave blank to keep" : ""}
                value={postmarkToken}
                onChange={(e) => setPostmarkToken(e.target.value)}
              />
            </div>
          )}

          {provider === "smtp" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Host</Label>
                  <Input
                    placeholder="smtp.example.com"
                    value={smtpHost}
                    onChange={(e) => setSmtpHost(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Port</Label>
                  <Input
                    type="number"
                    value={smtpPort}
                    onChange={(e) => setSmtpPort(parseInt(e.target.value || "587", 10))}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Username</Label>
                  <Input value={smtpUser} onChange={(e) => setSmtpUser(e.target.value)} />
                </div>
                <div>
                  <Label>Password</Label>
                  <Input
                    type="password"
                    placeholder={mode === "edit" ? "leave blank to keep" : ""}
                    value={smtpPass}
                    onChange={(e) => setSmtpPass(e.target.value)}
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={smtpTls}
                  onChange={(e) => setSmtpTls(e.target.checked)}
                />
                Use TLS (STARTTLS on 587, implicit on 465)
              </label>
            </>
          )}

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            Active (deactivates any other active config in this scope)
          </label>

          {error && (
            <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? "Saving…" : mode === "create" ? "Create" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
