#!/usr/bin/env bash
# Runs a pinned, self-hosted Switch server (switch-core + Postgres + Mattermost)
# from Switch's published standalone compose artifact. Local state lives in
# .data/switch/ and is never committed.
#
#   scripts/switch-local.sh init     fetch compose file, generate secrets
#   scripts/switch-local.sh up       start the stack (core + Mattermost bridge)
#   scripts/switch-local.sh down     stop it
#   scripts/switch-local.sh status   container status and API health
#   scripts/switch-local.sh env KEY  print one generated value
set -euo pipefail

SWITCH_VERSION="${SWITCH_VERSION:-0.31.0}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIR="$ROOT/.data/switch"
COMPOSE_URL="https://raw.githubusercontent.com/sandbox-quantum/switch/switch-v${SWITCH_VERSION}/deploy/local/standalone-docker-compose.yml"
PROJECT="reissue-switch"

compose() {
  docker compose -p "$PROJECT" --env-file "$DIR/.env" -f "$DIR/standalone-docker-compose.yml" --profile collab "$@"
}

rand() { openssl rand -hex "$1"; }

cmd_init() {
  mkdir -p "$DIR"
  curl -fsSL "$COMPOSE_URL" -o "$DIR/standalone-docker-compose.yml"
  if [[ -f "$DIR/.env" ]]; then
    echo "Keeping existing $DIR/.env"
    return
  fi
  cat > "$DIR/.env" <<ENV
SWITCH_VERSION=${SWITCH_VERSION}
SWITCH_BIND_ADDR=127.0.0.1
API_HOST_PORT=${SWITCH_API_PORT:-8000}
MATTERMOST_HOST_PORT=${SWITCH_MATTERMOST_PORT:-8065}
POSTGRES_HOST_PORT=${SWITCH_POSTGRES_PORT:-5452}
GATEWAY_HOST_PORT=${SWITCH_GATEWAY_PORT:-3300}
DB_USER=switch_app
DB_PASSWORD=$(rand 24)
DB_OWNER_USER=postgres
DB_OWNER_PASSWORD=$(rand 24)
DB_NAME=switch
ID_SERVER_NAME=localhost
AGENT_REGISTRATION_TOKEN=$(rand 24)
CONTROLLER_TOKEN_SECRET=$(rand 32)
FEATURE_FLAGS_ENABLED=follow_the_conversation,agent_management,agent_chats
SECRET_KEYS=reissue:$(rand 32)
GATEWAY_ADMIN_EMAIL=admin@switch.local
GATEWAY_ADMIN_PASSWORD=$(rand 16)
FRONTEND_BASE_URL=http://localhost:${SWITCH_API_PORT:-8000}
MATTERMOST_ADMIN_USER=admin
MATTERMOST_ADMIN_PASSWORD=$(rand 16)
MATTERMOST_TEAM_NAME=switch
MATTERMOST_USER=user
MATTERMOST_USER_PASSWORD=$(rand 16)
OUTBOUND_ALLOWED_PRIVATE_HOSTS=localhost,host.docker.internal
TELEMETRY_ENABLED=false
TELEGRAM_APP_BOT_TOKEN=${TELEGRAM_APP_BOT_TOKEN:-}
SLACK_APP_CLIENT_ID=${SLACK_APP_CLIENT_ID:-}
SLACK_APP_CLIENT_SECRET=${SLACK_APP_CLIENT_SECRET:-}
SLACK_APP_SIGNING_SECRET=${SLACK_APP_SIGNING_SECRET:-}
ENV
  chmod 600 "$DIR/.env"
  echo "Wrote $DIR/.env"
}

cmd_up() {
  [[ -f "$DIR/.env" ]] || cmd_init
  compose up -d
  local port; port="$(cmd_env API_HOST_PORT)"
  for _ in $(seq 1 90); do
    if curl -fsS "http://127.0.0.1:${port}/health" >/dev/null 2>&1; then
      echo "Switch API healthy on http://127.0.0.1:${port}"
      return
    fi
    sleep 2
  done
  echo "Switch API did not become healthy; see: docker compose -p $PROJECT logs switch" >&2
  exit 1
}

cmd_env() { grep -E "^$1=" "$DIR/.env" | head -1 | cut -d= -f2-; }

case "${1:-}" in
  init) cmd_init ;;
  up) cmd_up ;;
  down) compose down ;;
  status) compose ps; curl -fsS "http://127.0.0.1:$(cmd_env API_HOST_PORT)/health" && echo ;;
  env) cmd_env "$2" ;;
  logs) compose logs --tail "${2:-100}" switch ;;
  *) sed -n '2,12p' "$0"; exit 1 ;;
esac
