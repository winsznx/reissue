#!/usr/bin/env bash
# One-time local setup: dependencies, secrets, support services, database, builds.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing $1. $2" >&2; exit 1; }; }
need node "Install Node.js 22 or newer."
need pnpm "Install pnpm (corepack enable)."
need docker "Install Docker Desktop and start it."
need uv "Install uv (https://docs.astral.sh/uv/)."
command -v tesseract >/dev/null 2>&1 || echo "Note: tesseract not found. Scanned documents need it locally (brew install tesseract), or run the document worker container."

pnpm install

if [[ ! -f .env ]]; then
  cp .env.example .env
  sed -i.bak "s|^WORKBENCH_ACCESS_CODE=.*|WORKBENCH_ACCESS_CODE=$(openssl rand -hex 6)|; s|^APP_SESSION_SECRET=.*|APP_SESSION_SECRET=$(openssl rand -hex 32)|" .env
  rm -f .env.bak
  chmod 600 .env
  echo "Created .env (Workbench access code: $(grep ^WORKBENCH_ACCESS_CODE= .env | cut -d= -f2))"
fi

docker compose up -d --wait postgres redis object-store
(cd apps/document-worker && uv sync --frozen)
pnpm --filter "./packages/**" build
pnpm db:migrate
echo
echo "Ready. Next:"
echo "  scripts/stack.sh start            # API, worker, document worker (+ Switch agents when configured)"
echo "  scripts/switch-local.sh up && pnpm --filter @reissue/switch-coordinator setup:local   # local Switch"
