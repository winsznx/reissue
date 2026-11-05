#!/usr/bin/env bash
# Runs the Reissue application processes locally with pid files and logs in .data/run.
#
#   scripts/stack.sh start [service...]   start all (or named) services
#   scripts/stack.sh stop [service...]    stop all (or named) services
#   scripts/stack.sh restart [service...]
#   scripts/stack.sh status
#   scripts/stack.sh logs <service>       follow one service's log
#
# Services: worker-docs api worker coordinator examiner liaison web
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN="$ROOT/.data/run"
mkdir -p "$RUN"
ALL=(worker-docs api worker coordinator examiner liaison web)

command_for() {
  case "$1" in
    worker-docs) echo "cd $ROOT/apps/document-worker && exec uv run --env-file $ROOT/.env uvicorn reissue_worker.api:app --host 127.0.0.1 --port 4220" ;;
    api) echo "cd $ROOT/apps/api && exec npx tsx --env-file=$ROOT/.env src/main.ts" ;;
    worker) echo "cd $ROOT/apps/worker && exec npx tsx --env-file=$ROOT/.env src/main.ts" ;;
    coordinator) echo "cd $ROOT/apps/switch-coordinator && exec npx tsx --env-file=$ROOT/.env src/main.ts" ;;
    examiner) echo "cd $ROOT/apps/agent-runtime && exec npx tsx --env-file=$ROOT/.env src/main.ts examiner" ;;
    liaison) echo "cd $ROOT/apps/agent-runtime && exec npx tsx --env-file=$ROOT/.env src/main.ts liaison" ;;
    web) echo "cd $ROOT/apps/web && exec npx next dev -p 3210" ;;
    *) echo "unknown service $1" >&2; return 1 ;;
  esac
}

running() { [[ -f "$RUN/$1.pid" ]] && kill -0 "$(cat "$RUN/$1.pid")" 2>/dev/null; }

start() {
  local s="$1"
  if running "$s"; then echo "$s already running (pid $(cat "$RUN/$s.pid"))"; return; fi
  if [[ "$s" == coordinator || "$s" == examiner || "$s" == liaison ]] && ! grep -qE '^SWITCH_BASE_URL=.+' "$ROOT/.env"; then
    echo "$s skipped: SWITCH_BASE_URL is not set in .env"; return
  fi
  nohup bash -c "$(command_for "$s")" >>"$RUN/$s.log" 2>&1 &
  echo $! >"$RUN/$s.pid"
  echo "$s started (pid $!, log .data/run/$s.log)"
}

stop() {
  local s="$1"
  if running "$s"; then
    local pid; pid="$(cat "$RUN/$s.pid")"
    pkill -TERM -P "$pid" 2>/dev/null || true
    kill -TERM "$pid" 2>/dev/null || true
    for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.25; done
    echo "$s stopped"
  fi
  rm -f "$RUN/$s.pid"
}

services() { if [[ $# -gt 0 ]]; then echo "$@"; else echo "${ALL[@]}"; fi; }

cmd="${1:-status}"; shift || true
case "$cmd" in
  start) for s in $(services "$@"); do start "$s"; done ;;
  stop) for s in $(services "$@"); do stop "$s"; done ;;
  restart) for s in $(services "$@"); do stop "$s"; start "$s"; done ;;
  status) for s in "${ALL[@]}"; do if running "$s"; then echo "up    $s (pid $(cat "$RUN/$s.pid"))"; else echo "down  $s"; fi; done ;;
  logs) tail -f "$RUN/${1:?service}.log" ;;
  *) sed -n '2,11p' "$0"; exit 1 ;;
esac
