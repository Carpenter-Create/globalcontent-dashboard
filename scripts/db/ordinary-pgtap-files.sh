#!/usr/bin/env bash
# List ordinary local pgTAP files in deterministic order, excluding only the
# privileged two-session concurrency harness. Future supabase/tests/*.sql files
# are included automatically. Used by CI isolation and local reproduction.
#
# Fail-closed: no process-substitution producer whose exit status can be lost.
# Emits one path per line. Exit nonzero produces no usable inventory.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

tests_dir='supabase/tests'
if [[ ! -d "$tests_dir" ]]; then
  echo "error: $tests_dir is not a directory" >&2
  exit 1
fi
if [[ ! -r "$tests_dir" ]]; then
  echo "error: $tests_dir is not readable" >&2
  exit 1
fi

shopt -s nullglob
candidates=( "$tests_dir"/*.sql )
shopt -u nullglob

ordinary=()
for f in "${candidates[@]}"; do
  if [[ ! -f "$f" ]]; then
    echo "error: ordinary pgTAP path is not a regular file; refusing" >&2
    exit 1
  fi
  base="${f##*/}"
  if [[ "$base" == *$'\n'* || "$base" == *$'\r'* ]]; then
    echo "error: unsupported test filename (newline/CR); refusing" >&2
    exit 1
  fi
  if [[ "$base" == 'screener_concurrency_test.sql' ]]; then
    continue
  fi
  ordinary+=("$f")
done

if [[ "${#ordinary[@]}" -lt 1 ]]; then
  echo "error: no ordinary pgTAP files found" >&2
  exit 1
fi

inventory="$(mktemp "${TMPDIR:-/tmp}/ordinary-pgtap.XXXXXX")"
sorted="$(mktemp "${TMPDIR:-/tmp}/ordinary-pgtap.XXXXXX")"
cleanup() { rm -f "$inventory" "$sorted"; }
trap cleanup EXIT

printf '%s\n' "${ordinary[@]}" > "$inventory"
LC_ALL=C sort -o "$sorted" "$inventory"

count="$(wc -l < "$sorted" | tr -d '[:space:]')"
if [[ "$count" -ne "${#ordinary[@]}" ]]; then
  echo "error: ordinary pgTAP inventory sort lost or gained lines" >&2
  exit 1
fi

if grep -F 'screener_concurrency_test.sql' "$sorted" >/dev/null; then
  echo "error: concurrency harness leaked into the ordinary pgTAP list" >&2
  exit 1
fi

cat "$sorted"
