#!/usr/bin/env bash
# Typecheck and test every plugin from its own locked dependency tree.
set -euo pipefail

cd "$(dirname "$0")/.."

for dir in plugins/*/; do
  [ -f "${dir}package.json" ] || continue
  echo "== ${dir}"
  (
    cd "$dir"
    npm ci --ignore-scripts
    npm run typecheck
    npm run test --if-present
  )
done
