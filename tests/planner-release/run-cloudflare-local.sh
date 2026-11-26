#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
if [[ $# -ne 5 || ( "$2" != on && "$2" != off ) ]]; then
  printf '%s\n' 'usage: run-cloudflare-local.sh BUILD_DIR on|off NEW_EVIDENCE_DIR PAGES_PORT WORKER_PORT' >&2
  exit 2
fi
build=$(realpath -- "$1")
mode=$2
work=$(realpath -m -- "$3")
export PLANNER_CF_PAGES_PORT=$4 PLANNER_CF_WORKER_PORT=$5
for port in "$PLANNER_CF_PAGES_PORT" "$PLANNER_CF_WORKER_PORT"; do
  [[ "$port" =~ ^[1-9][0-9]{0,4}$ ]] && (( port < 65536 ))
done
test "$PLANNER_CF_PAGES_PORT" != "$PLANNER_CF_WORKER_PORT"
wrangler=$(realpath -- "${WRANGLER_CLI:?Set WRANGLER_CLI to local Wrangler bin/wrangler.js}")
input="$build/cloudflare-$mode"
test -f "$input/parent/_worker.js"
test -f "$input/child/wrangler.json"
mkdir -p -- "$(dirname "$work")"
mkdir -- "$work"
mkdir -- "$work"/{tls,screens,logs,profiles,config}
ln -s -- "$build/production-$mode" "$work/profiles/production-$mode"
# Wrangler may write temporary bundles beside its config.
cp -R -- "$input/parent" "$input/child" "$work/"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=planner-cloudflare-loopback \
  -keyout "$work/tls/key.pem" -out "$work/tls/cert.pem" 2>"$work/logs/tls-generator.log"
export WRANGLER_SEND_METRICS=false XDG_CONFIG_HOME="$work/config"
tls=(--local-protocol https --https-key-path "$work/tls/key.pem" --https-cert-path "$work/tls/cert.pem")
cd "$work"
WRANGLER_LOG_PATH="$work/logs/pages-debug.log" node "$wrangler" pages dev "$work/parent" \
  --ip 127.0.0.1 --inspector-port 0 --port "$PLANNER_CF_PAGES_PORT" --compatibility-date 2026-11-25 \
  --persist-to "$work/pages-state" "${tls[@]}" >"$work/logs/pages.log" 2>&1 &
pages_pid=$!
WRANGLER_LOG_PATH="$work/logs/worker-debug.log" node "$wrangler" dev --local --config "$work/child/wrangler.json" \
  --ip 127.0.0.1 --inspector-port 0 --port "$PLANNER_CF_WORKER_PORT" \
  --persist-to "$work/worker-state" "${tls[@]}" >"$work/logs/worker.log" 2>&1 &
worker_pid=$!
trap 'kill "$pages_pid" "$worker_pid" 2>/dev/null || true; wait "$pages_pid" "$worker_pid" 2>/dev/null || true' EXIT

ready=false
for ((attempt=0; attempt<120; attempt++)); do
  if curl --noproxy '*' -kfsS --max-time 1 -H 'Host: hosei-tsukyo-media.com' \
    "https://127.0.0.1:$PLANNER_CF_PAGES_PORT/planner" -o /dev/null 2>/dev/null &&
    curl --noproxy '*' -kfsS --max-time 1 -H 'Host: planner.hosei-tsukyo-media.com' \
    "https://127.0.0.1:$PLANNER_CF_WORKER_PORT/child" -o /dev/null 2>/dev/null; then
    ready=true
    break
  fi
  kill -0 "$pages_pid" "$worker_pid" 2>/dev/null || break
  sleep .25
done
if [[ "$ready" != true ]]; then
  cat "$work/logs/pages.log" "$work/logs/worker.log" >&2
  exit 1
fi
exit_status=0
for width in 390 1280; do
  if node "$root/tests/planner-release/scenario.mjs" "$width" production "$mode" "$work" \
    >"$work/logs/browser-$width.log" 2>&1; then
    printf 'Cloudflare %s %s PASS\n' "$mode" "$width"
  else
    printf 'Cloudflare %s %s FAIL\n' "$mode" "$width" >&2
    tail -n 30 "$work/logs/browser-$width.log" >&2
    exit_status=1
  fi
done
exit "$exit_status"
