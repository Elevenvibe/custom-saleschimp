# custom-saleschimp

Customized [Dograh](https://github.com/dograh-hq/dograh) deployment for
voice.mysaleschimp.com.

## Contributing

`main` is protected. All changes go through PRs:

```bash
git switch -c feat/your-change
# ...edit...
git commit -am "feat: describe the change"
git push -u origin feat/your-change
gh pr create --fill
```

The `no-dograh-edits` workflow (`.github/workflows/no-dograh-edits.yml`) runs
on every PR and **fails if the diff touches any file under `dograh/`** — that
folder is a submodule and must only change via the submodule pointer
(see [docs/saas-architecture.md §3](docs/saas-architecture.md)). Need to patch
Dograh source? Fork `dograh-hq/dograh` under Elevenvibe and repoint the
submodule URL.

Force-pushes and branch deletion on `main` are disabled. The owner can merge
without an approving review (solo-dev mode); raise the bar later by bumping
`required_approving_review_count` in the branch protection rule.

## How this repo is organized

```
.
├── docker-compose.yaml              # upstream-equivalent base compose
├── docker-compose.override.yaml     # our overrides (custom UI image build)
├── Dockerfile.ui                    # extends upstream dograh-ui with our branding
├── .env.example                     # template for environment config
│
├── custom/                          # 🔒 YOUR CODE — upstream never touches this
│   ├── README.md
│   ├── ui/public/                   # overlays /app/public/ in the UI image
│   ├── api/                         # (reserved)
│   └── nginx/                       # (reserved)
│
├── scripts/
│   └── update-dograh.sh             # bump dograh submodule to a new upstream tag
│
└── dograh/                          # 📦 SUBMODULE → dograh-hq/dograh
    └── (read-only upstream source — never edit directly)
```

## The customization model

`dograh/` is a [git submodule](https://git-scm.com/book/en/v2/Git-Tools-Submodules)
pinned to an exact upstream release tag (currently `dograh-v1.31.0`). Pulling
new upstream releases moves only this pointer — your customizations in
`custom/`, `Dockerfile.ui`, and `docker-compose.override.yaml` are physically
outside it and cannot be touched by upstream updates.

The custom UI image is built locally by extending the official
`ghcr.io/dograh-hq/dograh-ui:<tag>` image and `COPY`ing files from
`custom/ui/public/` over the defaults. See [Dockerfile.ui](Dockerfile.ui).

## Day-to-day commands

```bash
# First-time clone elsewhere (e.g. on a new server)
git clone --recurse-submodules https://github.com/Elevenvibe/custom-saleschimp.git
cd custom-saleschimp
cp .env.example .env   # then edit

# Run (Compose auto-merges override on top of base)
docker compose up -d

# Apply UI branding changes
# 1. edit/replace files in custom/ui/public/
docker compose build ui
docker compose up -d ui

# Tail logs
docker compose logs -f api ui
```

## Pulling upstream updates

When dograh ships a new release (e.g. `dograh-v1.32.0`):

```bash
bash scripts/update-dograh.sh dograh-v1.32.0
# review the changelog the script points you at, then:
docker compose build ui
docker compose up -d
git add dograh Dockerfile.ui docker-compose.override.yaml
git commit -m "chore: bump dograh to v1.32.0"
git push
```

The script only changes:
- the `dograh/` submodule commit pointer
- `UPSTREAM_TAG` in `Dockerfile.ui` and `docker-compose.override.yaml`

Everything in `custom/` stays exactly as you left it.

## Going beyond branding (deeper customization)

`COPY` into `/app/public/` only handles static assets. For React component
changes, copy text, or backend prompt changes you have two paths:

1. **Layer more overlays.** Add more `COPY` lines in `Dockerfile.ui` that
   overwrite specific files inside `/app/.next/...`. Fragile across upstream
   refactors, but simple.
2. **Fork dograh.** Fork `dograh-hq/dograh` under your org, repoint the
   submodule URL at your fork, make changes in `dograh/ui/` or `dograh/api/`,
   and build images from source. This is the standard escape hatch.

Start with overlays; move to a fork only when overlays stop being enough.
