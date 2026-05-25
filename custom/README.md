# Customization Zone

Everything in this folder is **yours**. Upstream Dograh updates never touch it.

## Layout

| Folder | What it overlays | How it's applied |
|---|---|---|
| `ui/public/` | `/app/public/` in the `dograh-ui` image | `COPY` in [Dockerfile.ui](../Dockerfile.ui) |
| `api/` | (reserved) custom prompts, configs, modules | not wired yet — add when needed |
| `nginx/` | (reserved) custom server blocks, TLS | not wired yet — add when needed |

## How to customize the UI right now

1. Drop replacement assets into `custom/ui/public/`. Filenames must match what the UI expects:
   - `favicon.ico` — browser tab icon
   - `axiom_icon.svg` — primary app icon shown in the sidebar
   - any other svg/png referenced by the UI
2. Rebuild & restart:
   ```bash
   docker compose build ui
   docker compose up -d ui
   ```
3. The override compose file ([docker-compose.override.yaml](../docker-compose.override.yaml)) tells Compose to use the custom Dockerfile instead of pulling the upstream image directly.

## Going deeper (component-level UI changes)

`COPY` into `/app/public/` only covers static assets. If you need to change React components, Tailwind theme, or app name text:

- **Option A (quick & hacky):** add more `COPY` lines to [Dockerfile.ui](../Dockerfile.ui) that overwrite specific files inside `/app/.next/...`. Fragile; breaks on UI refactors.
- **Option B (proper):** fork `dograh-hq/dograh` under Elevenvibe, repoint the submodule URL at your fork, make changes in `dograh/ui/`, build the UI image yourself from source. This is the standard escape hatch for non-trivial customization.

Start with Option A; switch to a fork only when overlays stop being enough.
