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
# --apply also requires the target's complete pending set (from
# `db push --dry-run`) to equal the approved nine, in order, both before
# typed confirmation and again immediately before the mutating push.
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
PENDING_ACTUAL=()

usage() {
  cat <<'EOF'
Usage: scripts/db/prod-migrate.sh [--target local|linked] [--apply]

Default (no flags): rehearsal. Verifies CLI 2.102.0, git state, and the nine
pending migration files. Does not connect to any database and does not apply.

  --target local    supabase db push --dry-run --local
  --target linked   supabase db push --dry-run --linked
  --apply           actually push (requires --target, GC_PROD_APPROVED_SHA,
                    clean main at that SHA, exact pending nine, and typed
                    confirmation)

--apply requires the founder-approved production release SHA in
GC_PROD_APPROVED_SHA (40-character hexadecimal commit). The script will not
derive that value from HEAD. The variable must name an existing commit that
equals the currently checked-out HEAD.

--apply asks CLI 2.102.0 `db push --dry-run` what it would apply, requires
that complete ordered set to be exactly the approved nine, then asks again
after typed confirmation before any mutating push.

Never uses npx. Never embeds credentials.
EOF
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

# Pinned CLI 2.102.0 migration filename grammar (must not be narrower):
#   ^([0-9]+)_(.*)\.sql$
# Version is any length of digits. Suffix may be empty, hyphenated, dotted,
# spaced, or Unicode. Do not grep -o a conventional 14-digit 20… name.
is_cli_migration_filename() {
  [[ "$1" =~ ^([0-9]+)_(.*)\.sql$ ]]
}

is_expected_dry_run_info_line() {
  case "$1" in
    'DRY RUN: migrations will *not* be pushed to the database.') return 0 ;;
    'Connecting to local database...') return 0 ;;
    'Connecting to remote database...') return 0 ;;
    'Would push these migrations:') return 0 ;;
    'Would push this migration:') return 0 ;;
    '') return 0 ;;
  esac
  return 1
}

# Root Execute() upgrade notice after a successful command. Installed version
# is pinned to v2.102.0. Advertised version is a bounded three-part semver.
CLI_UPGRADE_LINE1_PREFIX='A new version of Supabase CLI is available: '
CLI_UPGRADE_LINE1_SUFFIX=' (currently installed v2.102.0)'
CLI_UPGRADE_LINE2='We recommend updating regularly for new features and bug fixes: https://supabase.com/docs/guides/cli/getting-started#updating-the-supabase-cli'

is_cli_upgrade_notice_line1() {
  local line="$1"
  local mid
  case "$line" in
    "${CLI_UPGRADE_LINE1_PREFIX}"*"${CLI_UPGRADE_LINE1_SUFFIX}") ;;
    *) return 1 ;;
  esac
  mid="${line#"${CLI_UPGRADE_LINE1_PREFIX}"}"
  mid="${mid%"${CLI_UPGRADE_LINE1_SUFFIX}"}"
  [[ "$mid" =~ ^v?[0-9]+\.[0-9]+\.[0-9]+$ ]]
}

is_cli_upgrade_notice_line2() {
  [[ "$1" == "$CLI_UPGRADE_LINE2" ]]
}

# Strip a CLI list marker or single-migration prose prefix. Remainder must be
# a CLI filename or this is not a recognized list entry.
normalize_pending_list_line() {
  local line="$1"
  case "$line" in
    $'•'*)
      line="${line#?}"
      line="${line#"${line%%[![:space:]]*}"}"
      ;;
    '-'[[:space:]]*|'*'[[:space:]]*)
      line="${line:2}"
      line="${line#"${line%%[![:space:]]*}"}"
      ;;
  esac
  if [[ "$line" == 'Would push migration '* ]]; then
    line="${line#Would push migration }"
    if [[ "$line" == *'...' ]]; then
      line="${line%...}"
    fi
    line="${line%"${line##*[![:space:]]}"}"
  fi
  if [[ "$line" == */* ]]; then
    line="${line##*/}"
  fi
  printf '%s' "$line"
}

# Exact pinned CLI 2.102.0 dry-run completion footer. Not a prefix match.
CLI_DRY_RUN_FINISHED='Finished supabase db push.'

# Parse CLI 2.102.0 `db push --dry-run` text into PENDING_ACTUAL (version
# numbers in listed order).
#
# State A: command plan — banner/info and pending filenames.
# State B: exact terminal footer `Finished supabase db push.`
# State C: optional one complete two-line root upgrade notice.
# After the footer, no migration or command-plan line is accepted.
# Does not read application rows.
parse_pending_versions() {
  local text="$1"
  local -a found=()
  local raw line candidate
  local footer_seen=0
  local epilogue=0
  PENDING_ACTUAL=()

  if [[ "$text" != *"DRY RUN: migrations will *not* be pushed to the database."* ]]; then
    echo "error: dry-run output missing required non-mutating banner; refusing to parse" >&2
    return 1
  fi
  if [[ "$text" == *" is up to date."* ]]; then
    echo "error: dry-run reports database up to date; pending set is empty, not the approved nine" >&2
    return 1
  fi

  while IFS= read -r raw || [[ -n "$raw" ]]; do
    raw="${raw%$'\r'}"
    line="${raw#"${raw%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"

    if [[ -z "$line" ]]; then
      continue
    fi

    if [[ "$footer_seen" -eq 1 ]]; then
      if is_cli_upgrade_notice_line1 "$line"; then
        if [[ "$epilogue" -ne 0 ]]; then
          echo "error: duplicate or out-of-order CLI upgrade notice; refusing" >&2
          return 1
        fi
        epilogue=1
        continue
      fi
      if is_cli_upgrade_notice_line2 "$line"; then
        if [[ "$epilogue" -ne 1 ]]; then
          echo "error: CLI upgrade notice line 2 without line 1; refusing" >&2
          return 1
        fi
        epilogue=2
        continue
      fi
      echo "error: dry-run content after terminal '${CLI_DRY_RUN_FINISHED}'; refusing" >&2
      return 1
    fi

    if [[ "$line" == "$CLI_DRY_RUN_FINISHED" ]]; then
      if [[ "${#found[@]}" -eq 0 ]]; then
        echo "error: dry-run completion footer appeared before any pending migration; refusing" >&2
        return 1
      fi
      footer_seen=1
      continue
    fi

    if is_expected_dry_run_info_line "$line"; then
      continue
    fi

    candidate="$(normalize_pending_list_line "$line")"
    if is_cli_migration_filename "$candidate"; then
      found+=("${BASH_REMATCH[1]}")
      continue
    fi

    echo "error: unexpected or ambiguous dry-run line; refusing to assume the pending set is complete" >&2
    return 1
  done <<< "$text"

  if [[ "$footer_seen" -ne 1 ]]; then
    echo "error: dry-run must contain exactly one '${CLI_DRY_RUN_FINISHED}' completion line" >&2
    return 1
  fi
  if [[ "$epilogue" -eq 1 ]]; then
    echo "error: CLI upgrade notice line 1 without the required recommendation line; refusing" >&2
    return 1
  fi

  if [[ "${#found[@]}" -eq 0 ]]; then
    echo "error: dry-run banner present but no pending migration filenames could be parsed" >&2
    return 1
  fi

  local i j
  for i in "${!found[@]}"; do
    for j in "${!found[@]}"; do
      if [[ "$i" -lt "$j" && "${found[$i]}" == "${found[$j]}" ]]; then
        echo "error: dry-run listed duplicate pending version ${found[$i]}" >&2
        return 1
      fi
    done
  done

  PENDING_ACTUAL=("${found[@]}")
  return 0
}

assert_pending_equals_approved() {
  local expected actual
  expected="$(printf '%s\n' "${PENDING_VERSIONS[@]}")"
  actual="$(printf '%s\n' "${PENDING_ACTUAL[@]}")"
  if [[ "$expected" != "$actual" ]]; then
    echo "error: complete pending set is not the approved nine (exact versions and order required)" >&2
    echo "expected (${#PENDING_VERSIONS[@]}):" >&2
    printf '  %s\n' "${PENDING_VERSIONS[@]}" >&2
    echo "actual (${#PENDING_ACTUAL[@]}):" >&2
    printf '  %s\n' "${PENDING_ACTUAL[@]}" >&2
    return 1
  fi
  return 0
}

require_exact_pending_set_from_text() {
  parse_pending_versions "$1" || return 1
  assert_pending_equals_approved
}

require_exact_pending_set_from_cli() {
  local out rc
  if [[ -z "${CLI:-}" ]]; then
    echo "error: CLI is unset; cannot dry-run" >&2
    return 1
  fi
  if [[ "$TARGET" != 'local' && "$TARGET" != 'linked' ]]; then
    echo "error: pending-set check requires --target local or linked" >&2
    return 1
  fi
  set +e
  out="$("$CLI" db push --dry-run "--$TARGET" 2>&1)"
  rc=$?
  set -e
  if [[ $rc -ne 0 ]]; then
    echo "error: supabase db push --dry-run --${TARGET} failed (exit ${rc}); nothing applied" >&2
    return 1
  fi
  require_exact_pending_set_from_text "$out" || return 1
}

pending_fingerprint() {
  printf '%s\n' "${PENDING_ACTUAL[@]}"
}

# Sourced by scripts/db/prod-migrate.test.sh. Does not run apply.
if [[ "${BASH_SOURCE[0]}" != "${0}" ]]; then
  return 0
fi

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

echo "checking complete pending set via $CLI db push --dry-run --$TARGET"
require_exact_pending_set_from_cli
FIRST_PENDING_FP="$(pending_fingerprint)"
echo "pending set matches the approved nine."

echo "APPLY will run: $CLI db push --$TARGET"
echo "This writes the selected database. Type APPLY NINE MIGRATIONS to continue."
read -r -p '> ' CONFIRM
if [[ "$CONFIRM" != 'APPLY NINE MIGRATIONS' ]]; then
  echo "error: confirmation mismatch; nothing applied" >&2
  exit 1
fi

echo "rechecking complete pending set before mutation"
require_exact_pending_set_from_cli
if [[ "$(pending_fingerprint)" != "$FIRST_PENDING_FP" ]]; then
  echo "error: pending set changed between confirmation and apply; nothing applied" >&2
  exit 1
fi

# Never --include-roles. Do not grant dblink from a roles file; the local
# postgres role is not superuser and cannot own that grant.
"$CLI" db push "--$TARGET"
