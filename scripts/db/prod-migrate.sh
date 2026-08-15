#!/usr/bin/env bash
# prod-migrate.sh — founder-executed wrapper for the nine 20260806–20260808 migrations.
#
# Requires Supabase CLI exactly 2.102.0 on PATH. Never invokes npx.
# Default is rehearsal: repository checks only. No database connection.
# A proven 2.102.0 rehearsal against a database is:
#   supabase db push --dry-run --local
#   supabase db push --dry-run --linked
# Do not invent other dry-run flags. This script never embeds credentials.
#
# --apply requires GC_PROD_APPROVED_SHA, supplied by the founder immediately
# before production execution. The script never defaults that value from HEAD.
#
# Usage:
#   scripts/db/prod-migrate.sh
#   scripts/db/prod-migrate.sh --target local
#   scripts/db/prod-migrate.sh --target linked
#   GC_PROD_APPROVED_SHA=<40-char sha> scripts/db/prod-migrate.sh --apply --target linked
#
# --apply writes the remote (or local) database. Founder-only. Requires typing
# APPLY NINE MIGRATIONS. Agents must not pass --apply.

set -euo pipefail

REQUIRED_CLI='2.102.0'
PENDING_VERSIONS=(
  20260806000100
  20260806000200
  20260806000300
  20260806000400
  20260806000500
  20260807000100
  20260807000200
  20260808000100
  20260808000200
)

TARGET=''
APPLY=0

usage() {
  cat <<'EOF'
Usage: scripts/db/prod-migrate.sh [--target local|linked] [--apply]

Default (no flags): rehearsal. Verifies CLI 2.102.0, git state, and the nine
pending migration files. Does not connect to any database and does not apply.

  --target local    supabase db push --dry-run --local
  --target linked   supabase db push --dry-run --linked
  --apply           actually push (requires --target, GC_PROD_APPROVED_SHA,
                    clean main at that SHA, and typed confirmation)

--apply requires the founder-approved production release SHA in
GC_PROD_APPROVED_SHA (40-character hexadecimal commit). The script will not
derive that value from HEAD. The variable must name an existing commit that
equals the currently checked-out HEAD.

Never uses npx. Never embeds credentials.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      TARGET="${2:-}"
      shift 2
      ;;
    --apply)
      APPLY=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "error: unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -n "$TARGET" && "$TARGET" != 'local' && "$TARGET" != 'linked' ]]; then
  echo "error: --target must be local or linked" >&2
  exit 2
fi

if [[ "$APPLY" -eq 1 && -z "$TARGET" ]]; then
  echo "error: --apply requires --target local or --target linked" >&2
  exit 2
fi

resolve_cli() {
  local path
  path="$(command -v supabase || true)"
  if [[ -z "$path" ]]; then
    echo "error: supabase CLI not found on PATH" >&2
    exit 1
  fi
  if [[ "$path" == *'/npx'* || "$path" == *'npx' ]]; then
    echo "error: refusing to invoke supabase via npx ($path)" >&2
    exit 1
  fi
  if [[ "$(basename "$path")" == 'npx' ]]; then
    echo "error: refusing to invoke supabase via npx" >&2
    exit 1
  fi
  printf '%s' "$path"
}

# Founder-supplied release SHA. Never default from HEAD.
require_approved_release_sha() {
  local raw approved
  if [ -z "${GC_PROD_APPROVED_SHA+x}" ]; then
    echo "error: GC_PROD_APPROVED_SHA is required for --apply" >&2
    echo "export the founder-approved 40-character commit SHA immediately before production execution" >&2
    echo "this script will not derive it from HEAD" >&2
    exit 1
  fi
  raw="$GC_PROD_APPROVED_SHA"
  if [[ -z "$raw" ]]; then
    echo "error: GC_PROD_APPROVED_SHA is empty" >&2
    exit 1
  fi
  if [[ ! "$raw" =~ ^[0-9a-fA-F]{40}$ ]]; then
    echo "error: GC_PROD_APPROVED_SHA must be a 40-character hexadecimal commit SHA" >&2
    exit 1
  fi
  approved="$(printf '%s' "$raw" | tr 'A-F' 'a-f')"
  if ! git cat-file -e "${approved}^{commit}" 2>/dev/null; then
    echo "error: GC_PROD_APPROVED_SHA is not a commit in this repository" >&2
    exit 1
  fi
  if [[ "$HEAD" != "$approved" ]]; then
    echo "error: GC_PROD_APPROVED_SHA does not match checked-out HEAD" >&2
    echo "approved: $approved" >&2
    echo "HEAD:     $HEAD" >&2
    exit 1
  fi
}

CLI="$(resolve_cli)"
CLI_VERSION="$("$CLI" --version | head -n 1 | tr -d '[:space:]')"
if [[ "$CLI_VERSION" != "$REQUIRED_CLI" ]]; then
  echo "error: supabase CLI must be exactly $REQUIRED_CLI (found $CLI_VERSION at $CLI)" >&2
  exit 1
fi

echo "supabase CLI $CLI_VERSION at $CLI"

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

BRANCH="$(git branch --show-current)"
HEAD="$(git rev-parse HEAD)"
DIRTY="$(git status --porcelain)"

echo "branch: $BRANCH"
echo "HEAD:   $HEAD"

if [[ "$APPLY" -eq 1 ]]; then
  require_approved_release_sha
fi

if [[ -n "$DIRTY" ]]; then
  echo "error: working tree is not clean" >&2
  git status --porcelain >&2
  exit 1
fi

if [[ "$APPLY" -eq 1 ]]; then
  if [[ "$BRANCH" != 'main' ]]; then
    echo "error: --apply requires branch main (on $BRANCH)" >&2
    exit 1
  fi
fi

echo "pending migration files:"
for ver in "${PENDING_VERSIONS[@]}"; do
  match="$(find supabase/migrations -maxdepth 1 -name "${ver}_*.sql" -print)"
  if [[ -z "$match" ]]; then
    echo "error: missing migration file for $ver" >&2
    exit 1
  fi
  echo "  $match"
done

if [[ "$APPLY" -eq 0 && -z "$TARGET" ]]; then
  echo "rehearsal complete (no database connection)."
  echo "CLI 2.102.0 supported rehearsal: supabase db push --dry-run --local|--linked"
  exit 0
fi

if [[ "$APPLY" -eq 0 ]]; then
  echo "running: $CLI db push --dry-run --$TARGET"
  "$CLI" db push --dry-run "--$TARGET"
  exit 0
fi

echo "APPLY will run: $CLI db push --$TARGET"
echo "This writes the selected database. Type APPLY NINE MIGRATIONS to continue."
read -r -p '> ' CONFIRM
if [[ "$CONFIRM" != 'APPLY NINE MIGRATIONS' ]]; then
  echo "error: confirmation mismatch; nothing applied" >&2
  exit 1
fi

# Never --include-roles. Do not grant dblink from a roles file; the local
# postgres role is not superuser and cannot own that grant.
"$CLI" db push "--$TARGET"
