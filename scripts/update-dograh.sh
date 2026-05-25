#!/usr/bin/env bash
# Bump the dograh submodule to a new upstream release tag and align the
# UPSTREAM_TAG in build files. Run from the repo root:
#
#   bash scripts/update-dograh.sh dograh-v1.32.0
#
# After this script:
#   1. Review the diff (especially dograh/CHANGELOG.md and docker-compose.yaml).
#   2. Rebuild: docker compose build ui
#   3. Restart: docker compose up -d
#   4. Commit: git add dograh Dockerfile.ui docker-compose.override.yaml \
#              && git commit -m "chore: bump dograh to <tag>"

set -euo pipefail

TAG="${1:-}"
if [[ -z "$TAG" ]]; then
  echo "usage: $0 <dograh-vX.Y.Z>" >&2
  echo "list available tags:" >&2
  echo "  git -C dograh fetch --tags && git -C dograh tag -l 'dograh-v*' | tail -10" >&2
  exit 1
fi

# Verify we're at repo root
if [[ ! -f docker-compose.yaml || ! -d dograh ]]; then
  echo "error: run from repo root (the folder containing docker-compose.yaml and dograh/)" >&2
  exit 1
fi

echo ">>> Fetching upstream tags"
git -C dograh fetch --tags origin

echo ">>> Checking $TAG exists"
if ! git -C dograh rev-parse --verify "refs/tags/$TAG" >/dev/null 2>&1; then
  echo "error: tag $TAG not found upstream" >&2
  exit 1
fi

echo ">>> Checking out dograh @ $TAG"
git -C dograh checkout "$TAG"
git -C dograh submodule update --init --recursive

echo ">>> Aligning UPSTREAM_TAG in Dockerfile.ui and docker-compose.override.yaml"
# In-place edit with portable sed (works on GNU sed; on macOS use 'sed -i ""').
sed -i "s|^ARG UPSTREAM_TAG=.*|ARG UPSTREAM_TAG=$TAG|" Dockerfile.ui
sed -i "s|UPSTREAM_TAG: dograh-v[0-9.]\+|UPSTREAM_TAG: $TAG|" docker-compose.override.yaml

echo ">>> Done. Submodule pinned to $TAG."
echo ""
echo "Next steps:"
echo "  1. Inspect upstream changelog:  cat dograh/CHANGELOG.md | head -100"
echo "  2. Check compose drift:         diff docker-compose.yaml dograh/docker-compose.yaml"
echo "  3. Rebuild custom UI:           docker compose build ui"
echo "  4. Restart stack:               docker compose up -d"
echo "  5. Commit:                      git add dograh Dockerfile.ui docker-compose.override.yaml"
echo "                                  git commit -m \"chore: bump dograh to $TAG\""
