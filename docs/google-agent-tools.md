# Google agent tools — integration contract

How a Dograh agent tool (Calendar / Docs / Contacts) obtains a tenant's live
Google access token and which scopes it may use.

## Where the pieces live

| Concern | Owner |
| --- | --- |
| Platform Google OAuth app (client id/secret) | Gateway — Settings → Integrations |
| Per-tenant linked account + OAuth tokens | Gateway — `google_links` (encrypted) |
| Which services are enabled (Calendar/Docs/Contacts) | Gateway — per-service toggles → derived scopes |
| Agent tool runtime | Dograh — `api/services/integrations/<name>/` node packages |

Dograh only knows its `organization_id`; the OAuth tokens live in the gateway
keyed by our `tenant_id`. The **token broker** bridges the two.

## Token broker (gateway)

```
GET /internal/integrations/google/token?org_id=<dograh_org_id>
Header: X-Internal-Token: <GATEWAY internal_api_token>
```

Response:

```json
{
  "access_token": "ya29....",
  "expires_at": "2026-05-30T10:00:00+00:00",
  "google_email": "user@gmail.com",
  "services": ["contacts.readonly", "calendar", "documents"]
}
```

- Resolves `org_id → tenant → google_links`, **refreshing the access token**
  if it has expired (using the stored refresh token).
- `services` lists the scopes the super-admin enabled, so a tool can decide
  whether it's permitted to call Calendar / Docs.
- Errors: `401` (bad/missing internal token), `404` (no tenant for org / not
  linked), `409` (refresh failed — tenant must reconnect), `400` (integration
  disabled platform-wide).

The shared secret is `settings.internal_api_token` (env `INTERNAL_API_TOKEN`);
the broker is reachable over the docker network (gateway:8080) and never
exposed publicly.

## Building a Dograh Calendar/Docs node (follow-up)

Per `dograh/api/services/integrations/AGENTS.md`, create a package
`api/services/integrations/google_calendar/` (and `google_docs/`) that:

1. Defines a node model + spec (`BaseNodeData`, `@node_spec`, `build_spec`,
   `IntegrationNodeRegistration`) — no secrets stored on the node; the token
   comes from the broker at runtime.
2. At runtime resolves the workflow's `organization_id`, calls the broker with
   the internal token to get a fresh `access_token`, checks `services`
   includes `calendar` / `documents`, then calls the Google Calendar / Docs
   REST API.
3. Registers via `register_package(IntegrationPackageSpec(...))`.

Contacts import already runs in the gateway (Settings → Integrations →
console import); Calendar/Docs are agent-tool nodes that consume the broker.

> Live runs require a real Google Cloud OAuth app with the People/Calendar/
> Docs APIs enabled and the redirect URI registered (shown on the Settings →
> Integrations page).
