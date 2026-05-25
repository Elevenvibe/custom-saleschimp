# SaaS Architecture Plan

Turning Dograh into a multi-tenant SaaS with a WordPress-style plugin system,
without ever modifying upstream Dograh source.

> Status: **planning draft** — approved decisions are marked ✅; open items are
> in [Open Questions](#open-questions). Update this doc as decisions land.

## 1. Goals

1. Run Dograh as the voice-agent engine for many customer organizations on one
   shared instance.
2. Extend Dograh with first-party features delivered as **plugins** — installed,
   activated, and assigned via a super-admin UI.
3. Attach plugins to **packages** (subscription tiers) and/or to specific
   organizations.
4. Keep all customization physically outside `dograh/` so upstream upgrades
   never collide with our work.
5. Provide proper SaaS onboarding: extended signup, org creation, email invites,
   role-based access.

## 2. Non-goals (for v1)

- ❌ Third-party / marketplace plugins (decision: first-party only — sandboxing
  added later if/when needed).
- ❌ Stripe billing integration (decision: defer; packages are assigned manually
  in super-admin first).
- ❌ One-Dograh-per-customer (silo) deployments (decision: pool model — one
  shared Dograh).
- ❌ Patching Dograh source. Ever. If a need arises that can only be met by
  patching, the escape hatch is forking `dograh-hq/dograh` under our org and
  repointing the submodule — not editing in place.

## 3. Non-negotiable constraints

- `dograh/` submodule is **read-only**. CI should enforce this with a check
  that fails on any commit touching files under `dograh/` other than the
  submodule pointer.
- Anything that smells like "monkey-patching Dograh" is out. We integrate
  via its public HTTP API, its DB (read-only for plugin queries — we have our
  own schemas for writes), and HTML/script injection at the edge.
- Plugin code never imports Dograh modules directly. Plugins talk to Dograh
  only through the gateway's published client SDK.

## 4. High-level architecture

```
                       Customer browser
                              │
                              ▼
                   ┌─────────────────────┐
                   │   Edge (nginx)      │   TLS, top-level routing
                   └──────────┬──────────┘
                              ▼
                   ┌─────────────────────────────────────┐
                   │   SaaS Gateway (NEW)                │
                   │  • Auth: super-admin + org users    │
                   │  • JWT issuer (augmented claims)    │
                   │  • Plugin registry / loader         │
                   │  • Package & entitlement engine     │
                   │  • Onboarding, invites              │
                   │  • HTML/JS injection into UI        │
                   │  • API middleware (route, gate)     │
                   │  • Event bus (poll → fan-out)       │
                   └─┬──────────┬───────────────┬────────┘
                     │          │               │
              ┌──────▼─────┐ ┌──▼────────┐ ┌───▼──────────────┐
              │ Dograh UI  │ │ Dograh API│ │ Plugin services  │
              │ (untouched)│ │(untouched)│ │ (N containers,   │
              └────────────┘ └─────┬─────┘ │  one per plugin  │
                                   │       │  that has a      │
                                   ▼       │  backend)        │
                            ┌──────────────┐└─────┬───────────┘
                            │ Dograh DB    │      │
                            │ (postgres)   │      │
                            └──────────────┘      │
                            ┌──────────────┐ ◄────┘
                            │ Control DB   │   separate schema or DB:
                            │ (NEW)        │   tenants, packages,
                            └──────────────┘   plugin install state,
                                               invites, audit log.
                            Per-plugin schemas: plugin_<id>.*
```

### Why a front-gateway (not a sidecar behind Dograh)

The gateway must sit *in front of* Dograh because it needs to:
- mint JWTs with augmented claims before Dograh sees the request,
- gate API calls by plugin entitlement,
- inject script tags into HTML responses before they hit the browser,
- route plugin-specific URLs (`/api/x/*`, `/x/*`) to plugin services without
  Dograh knowing they exist.

A sidecar/behind-Dograh approach can't do most of these without patching Dograh.

## 5. Repository layout

```
voice.mysaleschimp.com/
├── dograh/                  📦 submodule (READ-ONLY)
├── custom/                  🔒 branding overlay (existing)
├── gateway/                 🆕 SaaS Gateway service
│   ├── Dockerfile
│   ├── pyproject.toml
│   ├── app/
│   │   ├── main.py
│   │   ├── auth/            (login, JWT issue/verify, invites)
│   │   ├── tenants/         (orgs, users, onboarding)
│   │   ├── packages/        (tier definitions, assignment)
│   │   ├── plugins/         (registry, loader, lifecycle)
│   │   ├── dograh_client/   (typed client for Dograh's API)
│   │   ├── inject/          (HTML/script injection middleware)
│   │   ├── proxy/           (API + UI reverse-proxy logic)
│   │   ├── events/          (poller, fan-out to plugin webhooks)
│   │   └── admin/           (super-admin REST surface)
│   ├── alembic/             (Control DB migrations)
│   └── tests/
├── plugins/                 🆕 each subfolder = one plugin
│   ├── _template/           scaffold + README
│   ├── example-call-export/
│   │   ├── plugin.json
│   │   ├── backend/
│   │   ├── frontend/
│   │   └── migrations/
│   └── ...
├── slot-runtime/            🆕 tiny JS lib injected into UI to mount plugin slots
├── docs/
│   └── saas-architecture.md   ← this file
├── docker-compose.yaml
├── docker-compose.override.yaml   (adds gateway + plugin services)
└── scripts/
    ├── update-dograh.sh           (existing)
    └── new-plugin.sh              🆕 scaffold a new plugin from _template
```

## 6. Control DB schema (v1)

Lives in a separate Postgres database (or schema) from Dograh's. Never modify
Dograh tables. We may *read* a few via foreign data wrappers or the API.

```
-- Identity (super-admins live only here; org users are mirrored from Dograh)
platform_users
  id, email, password_hash, role, created_at, last_login_at
  role IN ('super_admin', 'super_admin_staff')

-- Tenant mirror (1:1 with dograh.organizations)
tenants
  id, dograh_org_id, name, slug, owner_email, status, created_at,
  signup_metadata JSONB    -- extended signup fields (company size, use case, etc.)

tenant_members
  id, tenant_id, dograh_user_id, email, role, invited_by, joined_at
  role IN ('org_owner', 'org_admin', 'org_member')

invites
  id, tenant_id, email, role, token_hash, expires_at, accepted_at,
  invited_by_user_id

-- Packages & entitlements
packages
  id, slug, name, description, monthly_price_cents, limits JSONB, created_at
  -- limits example: {"max_users": 10, "calls_per_month": 5000}

package_plugins
  package_id, plugin_id    -- plugins included in this tier
  PRIMARY KEY (package_id, plugin_id)

tenant_packages
  tenant_id PK, package_id, started_at, ends_at, source
  source IN ('manual', 'stripe', 'trial')

tenant_plugin_overrides
  tenant_id, plugin_id, granted_by, granted_at, note
  -- per-tenant additions outside of their package

-- Plugin lifecycle
installed_plugins
  plugin_id PK, version, manifest JSONB, installed_at, status
  status IN ('installed', 'active', 'inactive', 'broken')

plugin_tenant_config
  tenant_id, plugin_id, config JSONB, updated_at
  PRIMARY KEY (tenant_id, plugin_id)

-- Audit
audit_log
  id, actor_user_id, actor_kind, action, target_kind, target_id,
  payload JSONB, ip, ua, created_at
```

Each plugin owns its own schema `plugin_<id>` for any custom tables. Plugin
migrations run against that schema only.

## 7. Plugin specification

### 7.1 Folder structure

```
plugins/<plugin-id>/
├── plugin.json              # manifest (required)
├── README.md
├── backend/                 # optional: containerized service
│   ├── Dockerfile
│   └── ...
├── frontend/                # optional: UI extension bundle
│   ├── src/
│   ├── dist/
│   └── manifest.json
└── migrations/              # optional: alembic-style migrations for plugin_<id> schema
```

### 7.2 Manifest (`plugin.json`)

```json
{
  "id": "call-recording-export",
  "name": "Call Recording Export",
  "version": "1.2.0",
  "author": "saleschimp",
  "category": "calls",
  "description": "Export call recordings to S3, GCS, or email.",
  "compatibility": { "dograh": ">=1.30 <2" },
  "permissions": ["read:calls", "read:recordings", "write:storage"],
  "ui": {
    "slots": [
      { "slot": "call-detail-actions", "component": "ExportButton" },
      { "slot": "org-admin-sidebar",
        "label": "Recording Export",
        "icon": "download",
        "path": "/x/recording-export" }
    ],
    "bundle": "frontend/dist/main.js"
  },
  "backend": {
    "image": "saleschimp/plugin-call-export:1.2.0",
    "port": 8080,
    "health": "/healthz",
    "env": ["AWS_REGION"]
  },
  "events": ["call.completed", "call.failed"],
  "config_schema": {
    "type": "object",
    "properties": {
      "destination": { "enum": ["s3", "gcs", "email"] },
      "bucket": { "type": "string" }
    },
    "required": ["destination"]
  },
  "default_tier": "professional"
}
```

### 7.3 Lifecycle

| State | How you reach it | Effect |
|---|---|---|
| **installed** | Drop folder under `plugins/`, gateway scans on boot or via "Rescan" button. | Manifest validated; UI shows it in super-admin Plugins page. No tenant impact yet. |
| **active** | Super-admin clicks Activate. | Gateway starts the plugin's backend container (Compose dynamic add), runs its migrations, registers proxy routes, subscribes to declared events. |
| **assigned** | Super-admin adds plugin to a package, or grants override to a tenant. | Tenant's JWT now includes the plugin in `plugins` claim; gateway gates routes accordingly. |
| **deactivated** | Super-admin clicks Deactivate. | Stop backend container; remove proxy routes; UI bundle no longer injected. Data retained. |
| **uninstalled** | Super-admin clicks Uninstall (then confirms). | Remove from packages/overrides; optional drop of `plugin_<id>` schema; remove folder marker. |

### 7.4 Plugin runtime contract

A plugin backend MUST:
- Expose `GET <health>` returning 200 when ready.
- Validate JWT on every request using the gateway's JWKS endpoint
  (`/.well-known/jwks.json`), and trust the `org_id` claim.
- Never assume direct DB access to Dograh tables — read via the gateway's
  Dograh SDK.
- Migrate its own schema `plugin_<id>.*` via the migrations folder.

A plugin frontend MUST:
- Be a single ES module that calls `window.__saleschimp__.registerSlot(...)`.
- Only render into slots declared in its manifest.
- Communicate with its backend via `/api/x/<plugin-id>/...` (the gateway
  proxies; no CORS issues).

## 8. UI extension: slot injection

The gateway proxies HTML responses from Dograh UI and rewrites the `<head>` to
inject:

```html
<script>window.__saleschimp__ = { jwt: "...", plugins: [...] };</script>
<script type="module" src="/slot-runtime.js"></script>
<script type="module" src="/x/call-recording-export/main.js"></script>
<script type="module" src="/x/salesforce-sync/main.js"></script>
<!-- one <script> per active plugin the user is entitled to -->
```

The slot runtime (`slot-runtime/`) is a ~5 KB module we own. It:
1. Reads `window.__saleschimp__`.
2. Mounts a MutationObserver to detect when each named slot's DOM container
   appears in the Dograh UI.
3. Calls registered plugin components with `(element, ctx) => unmount()`.

**Defined slots (v1):**
| Slot ID | Location in Dograh UI | Use |
|---|---|---|
| `org-admin-sidebar` | Settings/admin nav | Add custom admin pages |
| `call-detail-actions` | Call detail page action bar | Per-call buttons |
| `workflow-toolbar` | Workflow editor toolbar | Custom tools |
| `dashboard-widgets` | Main dashboard grid | Stats cards |
| `user-menu` | Top-right user menu | Plugin links/actions |

**Risk:** these locations are identified by DOM selectors we choose. A Dograh
UI refactor can break a slot's mount point. Mitigation:
- Keep the selector list in one file (`slot-runtime/slots.ts`).
- On `update-dograh.sh`, run a slot-health check against the new UI image.
- Plugins must gracefully no-op if their slot fails to mount.

If brittle in practice, escape hatch is to fork Dograh UI and add proper slot
divs (an explicit, opt-in design choice).

## 9. Auth, identity, and roles

### 9.1 Token model

Dograh issues JWTs with the minimal payload `{sub, email, exp, iat}`, signed
HS256 with `OSS_JWT_SECRET`.

**Our gateway becomes the JWT issuer for all browser sessions** and signs with
the same secret so Dograh accepts the tokens. Augmented payload:

```json
{
  "sub": "123",                      // Dograh user id (super-admins use "p_<id>")
  "email": "user@acme.com",
  "exp": 1716700000,
  "iat": 1716696400,

  "tenant_kind": "customer",         // "customer" | "platform"
  "org_id": "42",                    // Dograh org id (omitted for platform)
  "role": "org_admin",
  "tier": "professional",
  "plugins": ["call-export", "salesforce-sync"],
  "scopes": ["dograh:user"]
}
```

Dograh validates and uses `sub`/`exp` as today. Our gateway middleware reads
the additional claims for entitlement checks.

### 9.2 Roles

| Role | Lives in | Can do |
|---|---|---|
| `super_admin` | `platform_users` only | Everything on the platform: manage tenants, packages, plugins, view all audit. Never appears in a tenant's Dograh org. |
| `super_admin_staff` | `platform_users` | Scoped subset (e.g. support: read tenant data, no destructive actions). |
| `org_owner` | Dograh `users` + `tenant_members` link | Full control of one org; manage billing, invite admins, uninstall org. |
| `org_admin` | Same | Manage org settings + invite members; no billing. |
| `org_member` | Same | Standard Dograh user. |

Dograh's existing `superuser.py` route is **for tenant-level admin within
Dograh's own UX**. Our `super_admin` is a different, higher-level concept that
lives in the gateway, *not* in Dograh. We will not map our super-admins onto
Dograh's superusers; they're orthogonal.

### 9.3 Onboarding flow (extended signup)

1. Public marketing page → `POST /api/auth/signup` on the gateway with extended
   fields:
   - email, password, full name, company name, company size, role/title,
     phone, primary use case, expected call volume, referral source.
2. Gateway:
   a. Validates + creates record in `tenants` (status `pending_verification`).
   b. Sends email verification token.
   c. On verification: creates Dograh org via API (`POST /api/v1/organizations`),
      creates Dograh user, links in `tenant_members` with role `org_owner`.
   d. Assigns default package (e.g. "free" or "trial").
   e. Issues augmented JWT; redirects to onboarding wizard.
3. Onboarding wizard (gateway-rendered, not in Dograh):
   - confirm brand (logo upload — saved into per-tenant overrides),
   - pick a starter workflow template,
   - optional: invite first teammates.
4. Done → hand off to Dograh UI with the JWT set.

### 9.4 Invite flow

1. `org_owner`/`org_admin` opens "Invite users" in our gateway-rendered admin
   page (lives at `/x/admin/users`, in the `org-admin-sidebar` slot).
2. Enters email + role.
3. Gateway creates `invites` row, sends signed link
   `https://app/x/accept-invite?token=...`.
4. Recipient lands on a gateway-served page:
   - if not signed up: shortened signup form (skips company fields),
   - if signed up: confirms accept.
5. Gateway adds them to the Dograh org via API and creates `tenant_members`
   row.

## 10. Packages & entitlement

A package is a named bundle: included plugins + numeric limits.

```
free:           plugins: [base-analytics]; limits: {users: 2, calls/mo: 100}
starter:        plugins: [base-analytics, call-export]; limits: {users: 5, calls/mo: 1000}
professional:   plugins: [...everything in starter, ..., salesforce-sync]; limits: ...
enterprise:     all; custom limits
```

**Effective plugin set per tenant:**
```
enabled(tenant) = package.plugins ∪ tenant_plugin_overrides[tenant]
```

**Where entitlement is enforced:**
- In the JWT (claims drive UI gating: plugin bundles are only injected if the
  user is entitled).
- In the gateway proxy: requests to `/api/x/<plugin-id>/...` and `/x/<plugin-id>/...`
  are rejected with 403 if plugin not in effective set.
- Defense-in-depth in plugin backends: re-verify the `plugins` claim.

**Limits enforcement (Phase 2+):**
- Calls/month: cron job aggregates Dograh's existing `organization_usage`
  table; gateway middleware refuses new call starts when exceeded.
- Users: gateway invite endpoint refuses new invites past the cap.

## 11. Phased delivery roadmap

| Phase | Scope | Estimated effort | Hard dependencies |
|---|---|---|---|
| **P0 — Foundation** | Gateway service skeleton (FastAPI + Postgres). Control DB schema + migrations. Reverse-proxy Dograh UI + API with no behavior change. Super-admin login (platform_users). Audit log. CI guard against `dograh/` modifications. | 1–2 weeks | None. |
| **P1 — Multi-tenant onboarding** | Extended signup, email verification, org creation via Dograh API, invite flow, role enforcement. Onboarding wizard. | 2–3 weeks | P0. |
| **P2 — Packages & entitlement (manual)** | Packages CRUD in super-admin. Tenant → package assignment. JWT augmentation with `plugins` claim. Gateway gating of `/api/x/*` and `/x/*` routes. | 1–2 weeks | P1. |
| **P3 — Plugin runtime: backend** | Manifest spec + validator. Plugin registry. Compose dynamic add of plugin services. Event bus (start: poll Dograh DB or API; later: CDC). Example plugin `example-webhook-fan-out`. | 3–4 weeks | P2. **Risk:** event delivery — see below. |
| **P4 — Plugin runtime: UI slots** | Slot runtime JS lib. HTML injection middleware. Define & document 5 slots. Example UI plugin. | 2–3 weeks | P3. **Risk:** slot brittleness — spike first. |
| **P5 — Super-admin Plugins page** | Install/Activate/Assign UI. Per-tenant config UI generated from `config_schema`. Health/status of running plugin containers. | 2 weeks | P3+P4. |
| **P6 — Polishing** | Impersonation ("view as tenant"), better observability, plugin marketplace browsing (still first-party), rate limits, quotas dashboard. | ongoing | All prior. |

**Recommendation:** spike P4 (UI injection feasibility against current Dograh UI)
before committing to the full P3 scope. If injection proves too brittle,
re-scope to "iframe panels" instead of inline slots.

## 11.5 Email subsystem (multi-provider)

Closes [OQ2](#open-questions). The gateway ships a small mail abstraction so
any feature that sends email (verification, invites, plugin notifications,
billing receipts) is provider-agnostic.

### Providers

The gateway includes adapters for:
- **Resend** — simplest, cheap, modern API.
- **Amazon SES** — best fit if the deployment is in AWS.
- **Postmark** — best deliverability for transactional mail.
- **Generic SMTP** — fallback for self-hosted MTAs.

All adapters implement one interface:

```python
class MailProvider(Protocol):
    async def send(self, msg: OutgoingMail) -> SendResult: ...
```

### Configuration model

Two scopes, with tenant overriding platform:

```
email_provider_configs
  id, scope_kind, scope_id, provider, config_encrypted JSONB,
  from_email, from_name, is_active, created_at, updated_at
  -- scope_kind IN ('platform', 'tenant')
  -- scope_id IS NULL when scope_kind='platform'
  -- only one row per (scope_kind, scope_id) is active at a time
```

`config_encrypted` holds provider-specific secrets (Resend API key, SES
key/secret, Postmark server token, SMTP credentials), encrypted at rest with
a KMS-derived key.

### Resolution

```python
def get_provider(tenant_id: int | None) -> MailProvider:
    if tenant_id:
        cfg = active_config(scope='tenant', scope_id=tenant_id)
        if cfg:
            return build(cfg)
    cfg = active_config(scope='platform')
    if cfg:
        return build(cfg)
    raise NoEmailProviderConfigured()
```

- **Platform default**: super-admin configures one provider in the admin app at
  `admin.mysaleschimp.com/settings/email`. This is used for all platform mail
  (verification, signup, admin notifications) and as the default for every
  tenant.
- **Per-tenant override**: org_owner can set their own provider under
  org settings ("Use our own SMTP / Resend / SES / Postmark"). Once active,
  all mail sent on behalf of that tenant uses their provider. Falls back to
  platform default if their config breaks (with alert to org_owner).

### Sender identity & deliverability

- Platform mail uses `noreply@mysaleschimp.com`; the super-admin sets the
  display name.
- Tenant mail uses the tenant's configured `from_email` — they're responsible
  for DKIM/SPF on their own domain. The admin UI surfaces a DNS-check tool
  before letting them activate the override.

### Templating

Templates live in `gateway/app/email/templates/` as Jinja files. Each template
has an `html` and `text` variant. Tenant overrides for templates (custom
branding in invite emails, etc.) are stored as overlay strings in
`plugin_tenant_config` or a dedicated `tenant_email_overrides` table — TBD in
P1.

### Roadmap impact

- **P1** scope grows slightly: ship Resend adapter + platform-only config to
  unblock verification emails. SES + Postmark + SMTP land in P1.5 (or as part
  of the super-admin admin app build).
- Per-tenant override UI lands in P2 alongside the org admin pages.

## 12. Risks & open questions

### Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Dograh has no internal event/webhook bus we can subscribe to. Plugins that react to call events need us to build polling/CDC. | Start with polling Dograh's `calls` table for completed events. Move to logical replication or Debezium if scale demands. |
| R2 | Slot injection couples to Dograh UI DOM. Upstream UI refactors can break slot mount points. | Centralize selectors; CI slot-health check on every `update-dograh.sh`; plugins fail-soft; iframe fallback. |
| R3 | Dograh JWT validation tied to `OSS_JWT_SECRET`. If Dograh changes auth (e.g. moves to RS256), our augmented-JWT trick breaks. | Pin `compatibility` in plugin manifests; integration test the auth round-trip on every Dograh bump. |
| R4 | Multi-tenant isolation in Dograh is our trust boundary. If Dograh leaks data across orgs, our SaaS is broken. | Audit Dograh's org-scoping in API routes during P0; add periodic cross-tenant smoke tests. |
| R5 | Plugin backend containers may starve resources or crash and affect the platform. | Per-plugin resource limits in Compose/K8s; circuit-breaker in gateway proxy; health-driven auto-disable. |

### Open Questions

- **OQ1** ✅ **Decided:** super-admin UI is a separate Next.js app served at
  `admin.mysaleschimp.com`. Lives in `admin-ui/` at the repo root, deployed as
  a separate container, talks to the gateway only via REST (no shared code
  with the customer UI). Built during P1.

- **OQ2** ✅ **Decided:** **multi-provider** — Resend + SES + Postmark + SMTP
  adapters all ship. Super-admin sets a platform-wide default; orgs can
  override with their own provider. See [§11.5](#115-email-subsystem-multi-provider).

- **OQ3**: Do we store passwords for platform users in Control DB, or push them
  through Dograh's auth too? **Lean:** Control DB only, hashed bcrypt, with
  optional SSO later.

- **OQ4**: Plugin config schema rendering — write our own JSON Schema → form
  renderer, or use `react-jsonschema-form`? **Lean:** RJSF.

- **OQ5**: Where do per-tenant secrets (e.g. plugin API keys) live? **Lean:**
  encrypted column in `plugin_tenant_config`, KMS-derived key.

- **OQ6**: Compose vs. Kubernetes for plugin orchestration. Compose is enough
  for v1 single-host deployments. Plan a clean abstraction in the gateway's
  plugin orchestrator so we can swap to K8s when we go multi-host.

## 13. Appendix: minimum viable repo additions

To get P0 going, this repo gains:

```
gateway/
  Dockerfile
  pyproject.toml
  app/main.py              # FastAPI app, mounts /api/auth, /api/admin, etc.
  app/proxy.py             # default route: proxy / and /api/v1 to dograh
  app/email/               # MailProvider abstraction + Resend adapter
  alembic/                 # control db migrations
admin-ui/                  # (P1) Next.js super-admin app for admin.mysaleschimp.com
docker-compose.override.yaml
  + adds 'gateway' service, fronts ui+api on a new ingress port (e.g. 8080)
  + reuses existing postgres with a new logical database 'control'
docs/saas-architecture.md  ← this file
.github/workflows/no-dograh-edits.yml
  CI check: fails if any committed file path is under dograh/ except the
  submodule pointer itself.
```

P0 ships when:
- Browsing the new ingress port renders Dograh UI exactly as it does today.
- Super-admin can log in to a placeholder admin endpoint.
- Audit log captures the login.
- CI rejects a sample PR that tries to edit `dograh/api/app.py`.
