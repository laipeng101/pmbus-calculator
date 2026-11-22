#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."

# This Ubuntu image pins the system rendering libraries and fonts as well as
# the Playwright browsers. Refresh it and review the snapshots together.
image=mcr.microsoft.com/playwright:v1.59.1-noble@sha256:b0ab6f3cb99aa7803adbc14d9027ec1785fc6e433b97e134e0f8fe61683b6b53
node_root=$(node -p 'require("node:path").resolve(process.execPath, "../..")')
[[ -x "$node_root/bin/node" && -x "$node_root/bin/npm" ]] || {
  echo 'Visual tests require the pinned Linux Node distribution with its bundled npm.' >&2
  exit 1
}

# Rootless Docker maps container root to the caller. On GitHub's rootful
# runner, use the caller's UID/GID so reports and fixtures remain writable.
security_options=$(docker info --format '{{json .SecurityOptions}}')
user_args=()
if [[ "$security_options" != *'"name=rootless"'* ]]; then
  user_args=(--user "$(id -u):$(id -g)")
fi

# Keep dependency optimization and bundled Vite configs off the host filesystem.
mkdir -p -- node_modules/.vite node_modules/.vite-temp

# Extract the reports as the caller, including when the cloud Docker daemon
# runs as a different UID. Keep stdout reserved for the archive.
rm -rf -- test-results/visual playwright-report/visual
docker run --rm --init --platform linux/amd64 --network none --shm-size 1g \
  "${user_args[@]}" \
  --tmpfs /work/node_modules/.vite:mode=1777 \
  --tmpfs /work/node_modules/.vite-temp:mode=1777 \
  --mount "type=bind,source=$PWD,target=/work" \
  --mount "type=bind,source=$node_root,target=/opt/pmbus-node,readonly" \
  --workdir /work \
  --env CI=true \
  --env PATH=/opt/pmbus-node/bin:/usr/local/bin:/usr/bin:/bin \
  --env npm_config_cache=/tmp/pmbus-npm-cache \
  --env PMBUS_VISUAL_ARTIFACTS=/tmp/pmbus-visual \
  "$image" bash -c '
    set -e
    mkdir -p "$PMBUS_VISUAL_ARTIFACTS"
    status=0
    node node_modules/@playwright/test/cli.js test --config playwright.visual.config.ts "$@" >&2 || status=$?
    tar -C "$PMBUS_VISUAL_ARTIFACTS" -cf - .
    exit "$status"
  ' bash "$@" | tar --no-same-owner --no-overwrite-dir -xf -
