# P2.B — Next Product Area (Scope Doc)

Status: **draft** — written 2026-05-26 while P2.A3 is feature-complete
(merge backlog: PRs #20–#26 + the new fixes / f5 / FX cron landed in
this branch). Goal of this doc is to pick **one** product area as
P2.B and break it into a P2.A-style PR ladder so we can ship in 1–3
week increments.

## Where we are after P2.A

Customer-facing surface today:
- Multi-tenant onboarding + invites (P1)
- Admin cost catalog with per-provider markup rules (P2.A1)
- Self-serve subscription packages with billing intervals, provider
  gates, country scope (P2.A2)
- Wallet + ledger + usage records, Stripe + Paystack via Setup Intents,
  Stripe Elements + Paystack inline, per-tenant wallet drilldown,
  multi-currency wallets with FX (P2.A3 + follow-ups)

Internals that exist but aren't user-visible yet:
- Plugin install table (`installed_plugins`) — wired in P0/P1, no UI
  for tenants to browse or install yet
- Tenant `dograh_org_id` link — onboarding hooks Dograh's
  org structure but workflow / agent provisioning still comes from
  Dograh's own UI

## Candidate areas

Five candidates that build on what's in main today. Sized in **engineer-weeks**
(EW) for one person; assume ~one PR per EW.

### B1 — Plugin marketplace (3–5 EW)

What we ship:
- Admin catalog: a registry of installable plugins (already half-built
  on the gateway side — see `app/plugins/models.py`). Plugin metadata:
  slug, name, description, screenshots, pricing (one-time / monthly /
  per-call), required scopes, package gating.
- Tenant browse + install flow on app-ui. Click "Install" → charges
  the wallet (or kicks off subscription) → activates the plugin row
  on `installed_plugins`.
- Plugin runtime: a manifest schema (already drafted) that declares
  hooks the plugin participates in (`call.started`, `call.ended`,
  `workflow.transition`, etc.) plus a sandboxed endpoint or worker.

Why now: closes the loop on the `installed_plugins` table that's
already been schema'd, and the packages → plugins linkage already
exists (`package_plugins`). Customers asking for HubSpot/Salesforce
integrations would land here.

Risks: plugin runtime sandboxing is non-trivial. Likely we lean on
`api/services/integrations/` patterns from Dograh's existing code for
the runtime side.

### B2 — Enterprise SSO (2–3 EW)

What we ship:
- SAML 2.0 + OIDC providers (Okta, Azure AD, Google Workspace, generic
  OIDC) configurable per tenant.
- "Sign in with SSO" alongside the existing email/password flow.
- SCIM 2.0 for user provisioning (optional follow-up).

Why now: blocking deal-breaker for any enterprise tenant. Lowest
build complexity of the five (well-trodden libraries).

Risks: per-tenant cert/metadata management UI; just-in-time
provisioning logic touches the existing TenantMember table.

### B3 — Workflow templates (2–4 EW)

What we ship:
- An admin-managed library of "template" Dograh workflows that a
  tenant can clone-and-customize on signup.
- Vertical-specific templates: cold-call sales, lead qualification,
  customer support triage, debt collection, appointment reminder.
- The clone operation already exists in Dograh — we'd be wrapping
  it with our admin curation + tenant browse UI.

Why now: cuts time-to-first-call for new tenants from "build a graph
from scratch" to "pick a template and tweak". Marketing-friendly
("100+ templates"). Light technical risk.

Risks: tightest coupling to Dograh internals of any candidate — if
their workflow schema shifts under us we replatform the template
library.

### B4 — Reseller / agency mode (3–5 EW)

What we ship:
- Hierarchical tenants: a "parent" agency tenant owns N "child" client
  tenants. Agencies can apply their own markup on top of ours, brand
  the customer UI per child, and invoice their clients in one bill.
- Admin can flip a tenant to "agency" mode; agency dashboard shows
  every child's wallet + usage rolled up.
- The wallet/ledger plumbing from P2.A3 already supports child-level
  charging via the existing tenant scope.

Why now: opens a B2B2C channel. Agencies tend to spend more per
seat-equivalent than direct customers, and they bring their own sales
motion.

Risks: needs careful permission model (which agency users can do what
across which child tenants). Audit log + invoicing UX both touch
existing pages.

### B5 — Real-time call observability (2–3 EW)

What we ship:
- Live call list on tenant dashboard — every active call, with
  current node, duration ticking, ASR confidence, last user / agent
  utterance.
- Hot intervention: tenant operator can barge into a call, take it
  over, or hang it up.
- Per-call timeline view with full transcript + audio scrubber +
  cost-per-second breakdown (we already track this in
  `usage_records`).

Why now: differentiates from competitors whose dashboards are post-
hoc only. Visible ROI for sales — "watch your bot work" demos well.

Risks: WebSocket fan-out load. The gateway already proxies WS, but
hooking observers without affecting Dograh's pipeline performance
needs care.

## Recommendation

**Start with B2 (Enterprise SSO).** Reasoning:

1. Lowest build risk + well-defined scope — SAML/OIDC libraries are
   mature, the integration points (login screen, TenantMember
   provisioning) are isolated.
2. Unblocks enterprise sales motion. Anyone $30k+/yr is going to
   require it.
3. Doesn't touch the Dograh submodule — purely gateway + admin-ui +
   app-ui work.
4. Sets the multi-IDP infrastructure pattern (per-tenant secret
   storage, per-tenant config UI) that the plugin marketplace will
   need later anyway.

Then **B1 (Plugin marketplace)** because the schema is already half
in place and it converts long-tail integration asks into a self-serve
loop, freeing engineering from one-off integration work.

B3, B4, B5 are all defensible "next" picks but each has higher
coupling cost — to Dograh internals (B3), to a new permission system
(B4), or to load testing on a WS-heavy path (B5).

## Proposed P2.B PR ladder (if we pick B2)

| PR | Title | Scope |
|---|---|---|
| P2.B.1 | SSO config schema + admin CRUD | Migration: `tenant_sso_configs` table (idp_kind, metadata, cert, attribute_map JSONB). Admin endpoints. Settings UI. |
| P2.B.2 | OIDC sign-in flow | `python-jose` + httpx-based authorization-code dance. New `/api/auth/sso/{tenant_slug}/...` routes. Tenant login page gains "Sign in with SSO" button keyed on slug. |
| P2.B.3 | SAML 2.0 sign-in flow | `python3-saml` adapter or `pysaml2`. Same shape as B.2 but ACS endpoint. |
| P2.B.4 | Just-in-time provisioning | First-login auto-creates TenantMember with role mapped from IdP attributes. Configurable per tenant. |
| P2.B.5 (opt) | SCIM 2.0 provisioning | `/api/scim/v2/Users` + Groups endpoints. Bearer-token auth scoped per tenant. |

## Open questions to lock before starting

1. **OQ-B2-1** — Self-serve SSO setup or admin-assisted? Recommendation:
   admin-assisted for V1 (customer pastes metadata XML / OIDC discovery
   URL into a Settings page, super-admin reviews and activates). Self-
   serve is a follow-up.
2. **OQ-B2-2** — Force SSO or allow mixed? Recommendation: per-tenant
   `force_sso` boolean; default false; when true, the email/password
   login is hidden for that tenant's slug.
3. **OQ-B2-3** — Group → role mapping syntax. Recommendation: simple
   JSONB map of `{"<idp_group_name>": "<dograh_role>"}` with a
   `default_role` fallback. Anything more expressive can wait for
   real customer demand.
