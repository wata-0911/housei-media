#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
scripts="$root/scripts/planner-release"
fixtures="$root/tests/fixtures/planner-release"
output=$(realpath -m -- "$root/dist/planner-release")
test_profiles=false
if [[ $# -gt 0 ]]; then
  output=$(realpath -m -- "$1")
  shift
fi
if [[ "$*" == '--test-profiles' ]]; then
  test_profiles=true
elif [[ $# -ne 0 ]]; then
  printf '%s\n' 'usage: build.sh [new output directory] [--test-profiles]' >&2
  exit 2
fi
mkdir -p -- "$(dirname "$output")"
mkdir -- "$output"
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
(cd "$fixtures" && sha256sum --check SHA256SUMS)
cd "$root"

build() {
  local mode=$1 name=$2 staging_edit=$3 production_edit=$4
  VITE_PLANNER_2026_URL=/planner VITE_PLANNER_2026_ISOLATED_EDIT=1 \
    VITE_PLANNER_2026_STAGING_EDIT="$staging_edit" VITE_PLANNER_2026_PRODUCTION_EDIT="$production_edit" \
    node node_modules/vite/bin/vite.js build --mode "$mode" --outDir "$work/$name"
}

unset VITE_PLANNER_2026_PARENT_ORIGIN VITE_PLANNER_2026_CHILD_ORIGIN
unset VITE_SITE_AD_IMAGE VITE_SITE_AD_ALT VITE_SITE_AD_URL
build stage69-parent staging-parent 0 0
build stage69-child staging-child-on 1 0
build stage69-child staging-child-off 0 0
build main-planner-parent production-parent 0 0
build main-planner-child production-child-off 0 0

for edit in on off; do
  node "$scripts/stage69-package.mjs" "$work/staging-parent" "$work/staging-child-$edit" "$work/staging-raw-$edit"
  python3 "$scripts/assemble-staging.py" "$work/staging-raw-$edit" "$fixtures" "$output/staging-$edit"
done
python3 "$scripts/assemble-production.py" "$work/production-parent" "$work/production-child-off" "$output/production-off"

if [[ "$test_profiles" == true ]]; then
  build main-planner-child production-child-on 0 1
  python3 "$scripts/assemble-production.py" "$work/production-parent" "$work/production-child-on" "$output/production-on"
  VITE_SITE_AD_IMAGE=/ads-fixture.png VITE_SITE_AD_ALT='合成素材・配置確認のみ' \
    VITE_SITE_AD_URL=https://ads-placement-fixture.example.test/ build main-planner-parent production-parent-ad 0 0
  python3 "$root/tests/planner-release/mock-banner.py" "$work/production-parent-ad/ads-fixture.png"
  python3 "$scripts/assemble-production.py" "$work/production-parent-ad" "$work/production-child-on" "$output/production-ad"
fi
(cd "$output" && find . -type f -print0 | sort -z | xargs -0 sha256sum) > "$work/manifest"
cp "$work/manifest" "$output/SHA256SUMS"
cat "$output/SHA256SUMS"
