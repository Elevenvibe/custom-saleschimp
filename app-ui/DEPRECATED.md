# app-ui — DEPRECATED 2026-05-27

This directory is the legacy customer-facing Next.js app that ran on
port 3030. Everything it served is now part of `console/` (port 3040,
fronted by nginx at `http://localhost:8081/console/*`):

| Old route (port 3030) | New route                                  |
|-----------------------|--------------------------------------------|
| `/`                   | `http://localhost:8081/` (Dograh)          |
| `/dashboard`          | `http://localhost:8081/console`            |
| `/billing`            | `http://localhost:8081/console/billing`    |
| `/billing/plans`      | `http://localhost:8081/console/billing/plans` |
| `/marketplace`        | `http://localhost:8081/console/marketplace`|
| `/signup`             | `http://localhost:8081/console/signup`     |
| `/login`              | `http://localhost:8081/console/login`      |
| `/verify`             | `http://localhost:8081/console/verify`     |
| `/accept-invite`      | `http://localhost:8081/console/accept-invite` |

## Why this is still here

Kept as a tombstone for git history + a rollback path while the
console migration settles. The container is no longer in docker-compose.

## How to delete safely

Once you've verified the unified URL works end-to-end across signup
→ verify → onboarding → billing → marketplace → invite-accept, do:

```bash
git rm -r app-ui/
git commit -m "chore: remove deprecated app-ui (migrated to console/)"
```

That's it. Nothing in the rest of the codebase imports from `app-ui/`.
