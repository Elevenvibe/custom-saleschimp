"use client";

/**
 * Per-tenant SSO admin (P2.B.1).
 *
 * Mirrors the Settings → Payment gateways shape: paste-once secrets,
 * status reads expose `has_client_secret` only. SAML is in the schema
 * but the form below currently focuses on OIDC — SAML's metadata-XML
 * paste-box is reachable via the kind dropdown but expects the next
 * iteration (P2.B.3) to flesh out the upstream parser.
 */

import { use, useEffect, useState } from "react";
import Link from "next/link";

import { api } from "@/lib/api";
import { PageDescription, PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, KeyRound, Trash2 } from "lucide-react";

type SsoConfig = {
  id: number;
  tenant_id: number;
  idp_kind: "oidc" | "saml";
  display_name: string;
  issuer: string;
  client_id: string;
  has_client_secret: boolean;
  discovery_url: string | null;
  has_metadata_xml: boolean;
  force_sso: boolean;
  attribute_map: Record<string, string>;
  active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export default function TenantSsoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const tenantId = Number(id);

  const [cfg, setCfg] = useState<SsoConfig | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Form state — initialized from `cfg` on first load. We never prefill
  // `client_secret` so the input field is paste-only.
  const [idpKind, setIdpKind] = useState<"oidc" | "saml">("oidc");
  const [displayName, setDisplayName] = useState("");
  const [issuer, setIssuer] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [discoveryUrl, setDiscoveryUrl] = useState("");
  const [metadataXml, setMetadataXml] = useState("");
  const [forceSso, setForceSso] = useState(false);
  const [active, setActive] = useState(true);
  const [notes, setNotes] = useState("");
  const [mapJson, setMapJson] = useState('{"_default":"user"}');

  function load() {
    setError(null);
    api<SsoConfig | null>(`/api/admin/tenants/${tenantId}/sso`)
      .then((c) => {
        setCfg(c);
        if (c) {
          setIdpKind(c.idp_kind);
          setDisplayName(c.display_name);
          setIssuer(c.issuer);
          setClientId(c.client_id);
          setDiscoveryUrl(c.discovery_url ?? "");
          // metadata_xml is never returned (could be huge); admin re-pastes if changing kind
          setMetadataXml("");
          setForceSso(c.force_sso);
          setActive(c.active);
          setNotes(c.notes ?? "");
          setMapJson(JSON.stringify(c.attribute_map, null, 2));
        }
      })
      .catch((e) => setError(e.message));
  }
  useEffect(load, [tenantId]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      let attribute_map: Record<string, string> | null = null;
      try {
        attribute_map = mapJson.trim() ? JSON.parse(mapJson) : null;
      } catch {
        throw new Error("attribute_map must be valid JSON");
      }
      const body = {
        idp_kind: idpKind,
        display_name: displayName,
        issuer,
        client_id: clientId,
        client_secret: clientSecret,
        discovery_url: idpKind === "oidc" ? discoveryUrl : null,
        metadata_xml: idpKind === "saml" ? metadataXml : null,
        force_sso: forceSso,
        attribute_map,
        active,
        notes,
      };
      await api(`/api/admin/tenants/${tenantId}/sso`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      setClientSecret("");
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Remove SSO config for tenant #${tenantId}? Users must use email/password until reconfigured.`)) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/admin/tenants/${tenantId}/sso`, { method: "DELETE" });
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title={`Tenant #${tenantId} — SSO`}
        action={
          <Link href={`/tenants/${tenantId}`}>
            <Button variant="ghost" size="sm">
              <ArrowLeft className="size-4" /> Back to tenant
            </Button>
          </Link>
        }
      />
      <div className="p-8 max-w-3xl space-y-6">
        <PageDescription>
          Configure SSO sign-in for this tenant. Client secrets are Fernet-encrypted at rest and never returned
          over the API. SAML and OIDC end-to-end sign-in flows ship in P2.B.2 / P2.B.3 — this page enables the
          per-tenant config that those flows read.
        </PageDescription>

        {cfg === undefined && (
          <div className="text-sm text-muted-foreground">Loading…</div>
        )}
        {error && (
          <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
        )}

        {cfg !== undefined && (
          <>
            <div className="rounded-lg border bg-card p-4">
              <div className="flex items-center gap-2">
                <KeyRound className="size-4 text-muted-foreground" />
                <span className="text-sm font-medium">Current status</span>
                {cfg ? (
                  <Badge variant={cfg.active ? "default" : "secondary"}>
                    {cfg.active ? "Active" : "Inactive"}
                  </Badge>
                ) : (
                  <Badge variant="secondary">Not configured</Badge>
                )}
                {cfg?.force_sso && <Badge>force SSO</Badge>}
              </div>
              {cfg && (
                <div className="mt-2 text-xs text-muted-foreground">
                  {cfg.idp_kind.toUpperCase()} · {cfg.display_name} · client_id <code>{cfg.client_id}</code> ·{" "}
                  secret {cfg.has_client_secret ? "set" : "missing"}
                </div>
              )}
            </div>

            <div className="rounded-lg border bg-card p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>IdP kind</Label>
                  <Select value={idpKind} onValueChange={(v) => setIdpKind(v as "oidc" | "saml")}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="oidc">OIDC</SelectItem>
                      <SelectItem value="saml">SAML 2.0 (P2.B.3)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Display name</Label>
                  <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Acme Okta" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Issuer</Label>
                  <Input value={issuer} onChange={(e) => setIssuer(e.target.value)} placeholder="https://acme.okta.com" />
                </div>
                <div>
                  <Label>Client ID</Label>
                  <Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="0oa…" />
                </div>
              </div>
              <div>
                <Label>Client secret {cfg?.has_client_secret && <span className="text-xs text-muted-foreground">(leave blank to keep current)</span>}</Label>
                <Input
                  type="password"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  placeholder={cfg?.has_client_secret ? "•••• (stored)" : "paste fresh secret"}
                  autoComplete="off"
                />
              </div>
              {idpKind === "oidc" ? (
                <div>
                  <Label>Discovery URL</Label>
                  <Input
                    value={discoveryUrl}
                    onChange={(e) => setDiscoveryUrl(e.target.value)}
                    placeholder="https://acme.okta.com/.well-known/openid-configuration"
                  />
                </div>
              ) : (
                <div>
                  <Label>SAML metadata XML</Label>
                  <Textarea
                    rows={5}
                    value={metadataXml}
                    onChange={(e) => setMetadataXml(e.target.value)}
                    placeholder="<EntityDescriptor …>"
                  />
                </div>
              )}
              <div>
                <Label>Attribute map (JSON)</Label>
                <Textarea
                  rows={5}
                  value={mapJson}
                  onChange={(e) => setMapJson(e.target.value)}
                  className="font-mono text-xs"
                  placeholder='{"acme-admins":"org_admin","_default":"user"}'
                />
                <div className="mt-1 text-xs text-muted-foreground">
                  Map IdP group names → tenant roles. <code>_default</code> is the fallback when no group matches.
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={forceSso}
                    onChange={(e) => setForceSso(e.target.checked)}
                  />
                  Force SSO (hides email/password login for this tenant)
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={(e) => setActive(e.target.checked)}
                  />
                  Active
                </label>
              </div>
              <div>
                <Label>Notes</Label>
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="optional" />
              </div>
              <div className="flex justify-between gap-2">
                {cfg ? (
                  <Button variant="ghost" onClick={remove} disabled={busy}>
                    <Trash2 className="size-4" /> Remove
                  </Button>
                ) : <span />}
                <Button onClick={save} disabled={busy || !displayName || !issuer || !clientId}>
                  {busy ? "Saving…" : cfg ? "Update" : "Create config"}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
