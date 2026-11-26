#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
cd "$root"
if [[ $# -gt 1 ]]; then
  printf '%s\n' 'usage: run.sh [new evidence directory]' >&2
  exit 2
fi
if [[ $# -eq 1 ]]; then
  work=$(realpath -m -- "$1")
  mkdir -p -- "$(dirname "$work")"
  mkdir -- "$work"
else
  work=$(mktemp -d)
fi
printf 'Planner browser evidence: %s\n' "$work"
mkdir "$work/tls" "$work/screens" "$work/logs"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=planner-ci-loopback \
  -keyout "$work/tls/key.pem" -out "$work/tls/cert.pem" 2>"$work/logs/tls-generator.log"

# Pinned public reference. Used only to render the dev comparison view.
dev_commit=ae59d713f63dd895b66c2acbefdf1850e22d6342
dev_tree=90038dfa982b2da211b901a803d82a887868498a
git init -q "$work/dev-objects"
GIT_TERMINAL_PROMPT=0 git -C "$work/dev-objects" fetch --no-tags --depth=1 \
  https://github.com/wata-0911/housei-media.git "$dev_commit"
test "$(git -C "$work/dev-objects" rev-parse FETCH_HEAD)" = "$dev_commit"
test "$(git -C "$work/dev-objects" rev-parse 'FETCH_HEAD^{tree}')" = "$dev_tree"
mkdir "$work/dev-source"
git -C "$work/dev-objects" archive FETCH_HEAD | tar -xf - -C "$work/dev-source"
(
  cd "$work/dev-source"
  npm ci --ignore-scripts --no-audit --no-fund
  node node_modules/vite/bin/vite.js build --outDir "$work/dev-dist"
) | tee "$work/logs/dev-build.log"

bash scripts/planner-release/build.sh "$work/profiles" --test-profiles | tee "$work/logs/release-build.log"
failed=0
passed=0
for profile in dev staging production; do
  case "$profile" in
    dev) modes=(on) ;;
    staging) modes=(on off) ;;
    production) modes=(on off ad) ;;
  esac
  for mode in "${modes[@]}"; do
    for width in 390 1280; do
      label="$profile-$mode-$width"
      if node tests/planner-release/scenario.mjs "$width" "$profile" "$mode" "$work" 2>&1 | tee "$work/logs/$label.log"; then
        passed=$((passed + 1))
        printf '%s PASS\n' "$label"
      else
        failed=$((failed + 1))
        printf '%s FAIL\n' "$label" >&2
      fi
    done
  done
done
printf 'Browser profiles: %s/12 pass, %s fail\n' "$passed" "$failed"
test "$passed" -eq 12 && test "$failed" -eq 0
