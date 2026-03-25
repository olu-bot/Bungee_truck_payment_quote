#!/usr/bin/env bash
# Run from repo root: bash scripts/check-project.sh
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
MISS=0
need() {
  if [[ ! -f "$1" ]]; then
    echo "MISSING: $1"
    MISS=1
  fi
}
need package.json
need package-lock.json
need vite.config.ts
need tsconfig.json
need server/index.ts
need server/storage.ts
need server/vite.ts
need server/static.ts
need shared/schema.ts
need client/src/main.tsx
if [[ ! -d .git ]]; then
  echo "NOTE: No .git here — use git clone or init + remote to restore history."
fi
if [[ $MISS -eq 0 ]]; then
  echo "OK: Core scaffold files look present. Try: npm ci && npm run dev"
else
  echo ""
  echo "This folder is not a complete checkout. npm/git restore cannot fix missing files."
  echo "Restore the full project from your Git remote, a zip backup, or another machine."
  exit 1
fi
