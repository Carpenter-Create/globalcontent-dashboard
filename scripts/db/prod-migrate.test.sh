#!/usr/bin/env bash
# Controlled tests for prod-migrate.sh and ordinary pgTAP inventory control.
# Never talks to production. Fake supabase binaries record mutating db push.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
# shellcheck source=scripts/db/prod-migrate.sh
source "$ROOT/scripts/db/prod-migrate.sh"

failures=0
pass() { echo "PASS $1"; }
fail() { echo "FAIL $1"; failures=$((failures + 1)); }

NINE_BODY="$(cat <<'EOF'
DRY RUN: migrations will *not* be pushed to the database.
Connecting to local database...
Would push these migrations:
 • 20260806000100_asset_kind_add_trailer.sql
 • 20260806000200_client_screener_share_links.sql
 • 20260806000300_unify_screener_links.sql
 • 20260806000400_attach_link_vendor.sql
 • 20260806000500_require_buyer_name.sql
 • 20260807000100_transcode_jobs.sql
 • 20260807000200_attach_link_vendor_default_null.sql
 • 20260808000100_hide_gc_unnamed_screener_links.sql
 • 20260808000200_portal_resolve_screener_asset_kind.sql
EOF
)"
FINISHED='Finished supabase db push.'
UPGRADE_L1='A new version of Supabase CLI is available: v2.114.0 (currently installed v2.102.0)'
UPGRADE_L2='We recommend updating regularly for new features and bug fixes: https://supabase.com/docs/guides/cli/getting-started#updating-the-supabase-cli'
UPGRADE="${UPGRADE_L1}
${UPGRADE_L2}"
NINE_DRY_RUN="${NINE_BODY}
${FINISHED}"
NINE_WITH_UPGRADE="${NINE_DRY_RUN}
${UPGRADE}"

NINE_NAMES=(
  20260806000100_asset_kind_add_trailer.sql
  20260806000200_client_screener_share_links.sql
  20260806000300_unify_screener_links.sql
  20260806000400_attach_link_vendor.sql
  20260806000500_require_buyer_name.sql
  20260807000100_transcode_jobs.sql
  20260807000200_attach_link_vendor_default_null.sql
  20260808000100_hide_gc_unnamed_screener_links.sql
  20260808000200_portal_resolve_screener_asset_kind.sql
)

expect_parse_fail() {
  local name="$1"
  local text="$2"
  if require_exact_pending_set_from_text "$text" 2>/dev/null; then
    fail "$name"
  else
    pass "$name"
  fi
}

if require_exact_pending_set_from_text "$NINE_DRY_RUN"; then
  pass 'exact_nine_with_completion_footer'
else
  fail 'exact_nine_with_completion_footer'
fi

expect_parse_fail 'nine_without_completion_footer_must_fail' "$NINE_BODY"
expect_parse_fail 'footer_missing_period_must_fail' "${NINE_BODY}
Finished supabase db push"
expect_parse_fail 'footer_with_suffix_must_fail' "${NINE_BODY}
Finished supabase db push. extra"
expect_parse_fail 'unexpected_line_before_plan_must_fail' "unexpected preamble
${NINE_DRY_RUN}"
expect_parse_fail 'unexpected_line_after_plan_must_fail' "${NINE_DRY_RUN}
unexpected trailing line"
expect_parse_fail 'two_completion_footers_must_fail' "${NINE_DRY_RUN}
${FINISHED}"
expect_parse_fail 'footer_cannot_replace_banner' "Connecting to local database...
Would push these migrations:
 • 20260806000100_asset_kind_add_trailer.sql
 • 20260806000200_client_screener_share_links.sql
 • 20260806000300_unify_screener_links.sql
 • 20260806000400_attach_link_vendor.sql
 • 20260806000500_require_buyer_name.sql
 • 20260807000100_transcode_jobs.sql
 • 20260807000200_attach_link_vendor_default_null.sql
 • 20260808000100_hide_gc_unnamed_screener_links.sql
 • 20260808000200_portal_resolve_screener_asset_kind.sql
${FINISHED}"
expect_parse_fail 'footer_cannot_replace_pending_list' "DRY RUN: migrations will *not* be pushed to the database.
Connecting to local database...
Would push these migrations:
${FINISHED}"
expect_parse_fail 'footer_with_prefix_must_fail' "${NINE_BODY}
Note: Finished supabase db push."

if require_exact_pending_set_from_text "${NINE_DRY_RUN}

"; then
  pass 'exact_nine_footer_then_blanks'
else
  fail 'exact_nine_footer_then_blanks'
fi

MID_LIST_AFTER_FIRST="$(cat <<EOF
DRY RUN: migrations will *not* be pushed to the database.
Connecting to local database...
Would push these migrations:
 • 20260806000100_asset_kind_add_trailer.sql
${FINISHED}
 • 20260806000200_client_screener_share_links.sql
 • 20260806000300_unify_screener_links.sql
 • 20260806000400_attach_link_vendor.sql
 • 20260806000500_require_buyer_name.sql
 • 20260807000100_transcode_jobs.sql
 • 20260807000200_attach_link_vendor_default_null.sql
 • 20260808000100_hide_gc_unnamed_screener_links.sql
 • 20260808000200_portal_resolve_screener_asset_kind.sql
EOF
)"
expect_parse_fail 'footer_after_first_before_remaining_eight_must_fail' "$MID_LIST_AFTER_FIRST"

MID_LIST_AFTER_EIGHT="$(cat <<EOF
DRY RUN: migrations will *not* be pushed to the database.
Connecting to local database...
Would push these migrations:
 • 20260806000100_asset_kind_add_trailer.sql
 • 20260806000200_client_screener_share_links.sql
 • 20260806000300_unify_screener_links.sql
 • 20260806000400_attach_link_vendor.sql
 • 20260806000500_require_buyer_name.sql
 • 20260807000100_transcode_jobs.sql
 • 20260807000200_attach_link_vendor_default_null.sql
 • 20260808000100_hide_gc_unnamed_screener_links.sql
${FINISHED}
 • 20260808000200_portal_resolve_screener_asset_kind.sql
EOF
)"
expect_parse_fail 'footer_after_eight_before_ninth_must_fail' "$MID_LIST_AFTER_EIGHT"

expect_parse_fail 'footer_then_extra_migration_must_fail' "${NINE_DRY_RUN}
 • 20260809000100_unexpected-extra.sql"
expect_parse_fail 'footer_then_info_line_must_fail' "${NINE_DRY_RUN}
Would push these migrations:"

if require_exact_pending_set_from_text "$NINE_WITH_UPGRADE"; then
  pass 'exact_nine_footer_official_upgrade_notice'
else
  fail 'exact_nine_footer_official_upgrade_notice'
fi
if require_exact_pending_set_from_text "${NINE_DRY_RUN}

${UPGRADE}

"; then
  pass 'exact_nine_footer_blank_upgrade_notice_blanks'
else
  fail 'exact_nine_footer_blank_upgrade_notice_blanks'
fi

expect_parse_fail 'migration_after_upgrade_line1_must_fail' "${NINE_DRY_RUN}
${UPGRADE_L1}
 • 20260809000100_unexpected-extra.sql
${UPGRADE_L2}"
expect_parse_fail 'migration_after_complete_upgrade_must_fail' "${NINE_WITH_UPGRADE}
 • 20260809000100_unexpected-extra.sql"
expect_parse_fail 'upgrade_line1_without_line2_must_fail' "${NINE_DRY_RUN}
${UPGRADE_L1}"
expect_parse_fail 'upgrade_line2_without_line1_must_fail' "${NINE_DRY_RUN}
${UPGRADE_L2}"
expect_parse_fail 'upgrade_lines_reversed_must_fail' "${NINE_DRY_RUN}
${UPGRADE_L2}
${UPGRADE_L1}"
expect_parse_fail 'text_between_upgrade_lines_must_fail' "${NINE_DRY_RUN}
${UPGRADE_L1}
please update
${UPGRADE_L2}"
expect_parse_fail 'text_after_complete_upgrade_must_fail' "${NINE_WITH_UPGRADE}
unexpected trailing line"
expect_parse_fail 'duplicate_upgrade_notice_must_fail' "${NINE_WITH_UPGRADE}
${UPGRADE}"
expect_parse_fail 'altered_recommendation_url_must_fail' "${NINE_DRY_RUN}
${UPGRADE_L1}
We recommend updating regularly for new features and bug fixes: https://example.invalid/cli"
expect_parse_fail 'altered_installed_version_must_fail' "${NINE_DRY_RUN}
A new version of Supabase CLI is available: v2.114.0 (currently installed v2.99.0)
${UPGRADE_L2}"
expect_parse_fail 'malformed_advertised_version_must_fail' "${NINE_DRY_RUN}
A new version of Supabase CLI is available: latest (currently installed v2.102.0)
${UPGRADE_L2}"
expect_parse_fail 'upgrade_notice_before_footer_must_fail' "${NINE_BODY}
${UPGRADE}
${FINISHED}"

EIGHT="$(printf '%s\n' "$NINE_BODY" | grep -v '20260808000200')
${FINISHED}"
expect_parse_fail 'eight_pending_must_fail' "$EIGHT"

TEN_CONVENTIONAL="${NINE_BODY}
 • 20260809000100_unexpected_extra.sql
${FINISHED}"
expect_parse_fail 'ten_conventional_must_fail' "$TEN_CONVENTIONAL"

TEN_HYPHEN="${NINE_BODY}
 • 20260809000100_unexpected-extra.sql
${FINISHED}"
expect_parse_fail 'ten_hyphenated_exploit_must_fail' "$TEN_HYPHEN"

TEN_DOT="${NINE_BODY}
 • 20260809000100_unexpected.extra.sql
${FINISHED}"
expect_parse_fail 'ten_dotted_must_fail' "$TEN_DOT"

TEN_SPACE="${NINE_BODY}
 • 20260809000100_unexpected extra.sql
${FINISHED}"
expect_parse_fail 'ten_spaced_must_fail' "$TEN_SPACE"

TEN_EMPTY="${NINE_BODY}
 • 20260809000100_.sql
${FINISHED}"
expect_parse_fail 'ten_empty_suffix_must_fail' "$TEN_EMPTY"

TEN_SHORTVER="${NINE_BODY}
 • 123_extra.sql
${FINISHED}"
expect_parse_fail 'ten_short_version_must_fail' "$TEN_SHORTVER"

TEN_UNICODE="${NINE_BODY}
 • 20260809000100_意外.sql
${FINISHED}"
expect_parse_fail 'ten_unicode_must_fail' "$TEN_UNICODE"

REPLACED="${NINE_BODY/20260808000200_portal_resolve_screener_asset_kind.sql/20260809000100_unexpected_swap.sql}
${FINISHED}"
expect_parse_fail 'replaced_version_must_fail' "$REPLACED"

REORDERED="$(cat <<EOF
DRY RUN: migrations will *not* be pushed to the database.
Would push these migrations:
 • 20260808000200_portal_resolve_screener_asset_kind.sql
 • 20260806000100_asset_kind_add_trailer.sql
 • 20260806000200_client_screener_share_links.sql
 • 20260806000300_unify_screener_links.sql
 • 20260806000400_attach_link_vendor.sql
 • 20260806000500_require_buyer_name.sql
 • 20260807000100_transcode_jobs.sql
 • 20260807000200_attach_link_vendor_default_null.sql
 • 20260808000100_hide_gc_unnamed_screener_links.sql
${FINISHED}
EOF
)"
expect_parse_fail 'invalid_order_must_fail' "$REORDERED"

DUP="${NINE_BODY}
 • 20260806000100_duplicate-name.sql
${FINISHED}"
expect_parse_fail 'duplicate_version_must_fail' "$DUP"

expect_parse_fail 'missing_banner_must_fail' 'Connecting to local database...'
expect_parse_fail 'up_to_date_must_fail' \
  $'DRY RUN: migrations will *not* be pushed to the database.\nLocal database is up to date.\n'
expect_parse_fail 'unparseable_must_fail' \
  $'DRY RUN: migrations will *not* be pushed to the database.\nConnecting...\nno filenames here\n'
expect_parse_fail 'ambiguous_sql_line_must_fail' \
  $'DRY RUN: migrations will *not* be pushed to the database.\nWould push these migrations:\n • not-a-migration.sql\n'

for name in \
  '20260809000100_unexpected-extra.sql' \
  '20260809000100_unexpected.extra.sql' \
  '20260809000100_unexpected extra.sql' \
  '20260809000100_.sql' \
  '123_extra.sql' \
  '20260809000100_意外.sql'
do
  if is_cli_migration_filename "$name"; then
    pass "cli_grammar_recognizes_${name}"
  else
    fail "cli_grammar_recognizes_${name}"
  fi
done

if grep -E '20\[0-9\]\{12\}_\[A-Za-z0-9_\]' "$ROOT/scripts/db/prod-migrate.sh" >/dev/null; then
  fail 'narrow_filename_grep_must_not_remain'
else
  pass 'narrow_filename_grep_must_not_remain'
fi

# --- CI-equivalent ordinary pgTAP inventory control (mirrors ci.yml) ---

# Fresh bash with set -e at top level, matching the isolation job step.
# Do not invoke this from a function-under-`if` in the same shell: bash
# then ignores errexit and can consume a failed helper's partial output.
run_ci_ordinary_pgtap_step() {
  local helper="$1"
  bash -c '
    set -euo pipefail
    helper="$1"
    inventory="$(mktemp "${TMPDIR:-/tmp}/ordinary-pgtap-inventory.XXXXXX")"
    cleanup_inventory() { rm -f "$inventory"; }
    trap cleanup_inventory EXIT
    "$helper" > "$inventory"
    files=()
    file_count=0
    while IFS= read -r f; do
      [[ -z "$f" ]] && continue
      files+=("$f")
      file_count=$((file_count + 1))
    done < "$inventory"
    test "$file_count" -gt 0
    supabase test db "${files[@]}"
  ' bash "$helper"
}

CI_FAKE="$(mktemp -d "${TMPDIR:-/tmp}/ordinary-pgtap-ci.XXXXXX")"
cat > "$CI_FAKE/supabase" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
printf '%s\n' "$*" >> "$here/invocations"
if [[ "${1:-}" == 'test' && "${2:-}" == 'db' ]]; then
  echo "test-db-ran" >> "$here/test_db_ran"
  exit "${FAKE_TEST_DB_RC:-0}"
fi
echo "unexpected fake supabase args: $*" >&2
exit 3
FAKE
chmod +x "$CI_FAKE/supabase"

cat > "$CI_FAKE/helper_exit_42" <<'H'
#!/usr/bin/env bash
echo 'supabase/tests/assets_test.sql'
exit 42
H
chmod +x "$CI_FAKE/helper_exit_42"

cat > "$CI_FAKE/helper_partial_fail" <<'H'
#!/usr/bin/env bash
echo 'supabase/tests/assets_test.sql'
echo 'supabase/tests/portal_test.sql'
exit 3
H
chmod +x "$CI_FAKE/helper_partial_fail"

cat > "$CI_FAKE/helper_empty" <<'H'
#!/usr/bin/env bash
exit 0
H
chmod +x "$CI_FAKE/helper_empty"

(
  export PATH="$CI_FAKE:$PATH"
  unset FAKE_TEST_DB_RC
  rm -f "$CI_FAKE/test_db_ran"
  if run_ci_ordinary_pgtap_step "$CI_FAKE/helper_exit_42"; then
    fail 'ci_helper_exit_42_must_fail'
  else
    pass 'ci_helper_exit_42_must_fail'
  fi
  if [[ -f "$CI_FAKE/test_db_ran" ]]; then
    fail 'ci_helper_exit_42_must_not_run_pgtap'
  else
    pass 'ci_helper_exit_42_must_not_run_pgtap'
  fi

  rm -f "$CI_FAKE/test_db_ran"
  if run_ci_ordinary_pgtap_step "$CI_FAKE/helper_partial_fail"; then
    fail 'ci_helper_partial_then_fail_must_fail'
  else
    pass 'ci_helper_partial_then_fail_must_fail'
  fi
  if [[ -f "$CI_FAKE/test_db_ran" ]]; then
    fail 'ci_helper_partial_then_fail_must_not_run_pgtap'
  else
    pass 'ci_helper_partial_then_fail_must_not_run_pgtap'
  fi

  rm -f "$CI_FAKE/test_db_ran"
  if run_ci_ordinary_pgtap_step "$CI_FAKE/helper_empty"; then
    fail 'ci_helper_no_files_must_fail'
  else
    pass 'ci_helper_no_files_must_fail'
  fi
  if [[ -f "$CI_FAKE/test_db_ran" ]]; then
    fail 'ci_helper_no_files_must_not_run_pgtap'
  else
    pass 'ci_helper_no_files_must_not_run_pgtap'
  fi

  export FAKE_TEST_DB_RC=1
  rm -f "$CI_FAKE/test_db_ran"
  if run_ci_ordinary_pgtap_step "$ROOT/scripts/db/ordinary-pgtap-files.sh"; then
    fail 'ci_ordinary_pgtap_nonzero_must_fail'
  else
    pass 'ci_ordinary_pgtap_nonzero_must_fail'
  fi
  if [[ ! -f "$CI_FAKE/test_db_ran" ]]; then
    fail 'ci_ordinary_pgtap_nonzero_must_invoke_test_db'
  else
    pass 'ci_ordinary_pgtap_nonzero_must_invoke_test_db'
  fi

  export FAKE_TEST_DB_RC=0
  rm -f "$CI_FAKE/test_db_ran"
  if run_ci_ordinary_pgtap_step "$ROOT/scripts/db/ordinary-pgtap-files.sh"; then
    pass 'ci_ordinary_helper_and_pgtap_success'
  else
    fail 'ci_ordinary_helper_and_pgtap_success'
  fi
  if [[ ! -f "$CI_FAKE/test_db_ran" ]]; then
    fail 'ci_ordinary_success_must_invoke_test_db'
  else
    pass 'ci_ordinary_success_must_invoke_test_db'
  fi
)

if grep -F '< <(scripts/db/ordinary-pgtap-files.sh)' "$ROOT/.github/workflows/ci.yml" >/dev/null; then
  fail 'ci_must_not_use_process_substitution_for_helper'
else
  pass 'ci_must_not_use_process_substitution_for_helper'
fi
if grep -F 'ordinary-pgtap-files.sh > "$inventory"' "$ROOT/.github/workflows/ci.yml" >/dev/null; then
  pass 'ci_helper_is_normal_redirected_command'
else
  fail 'ci_helper_is_normal_redirected_command'
fi

# --- End-to-end real wrapper --apply against a disposable repo + fake CLI ---

WORK_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/prod-migrate-e2e.XXXXXX")"
cleanup() {
  rm -rf "$WORK_ROOT" "$CI_FAKE"
}
trap cleanup EXIT

write_fake_cli() {
  local fake="$1"
  mkdir -p "$fake"
  echo '2.102.0' > "$fake/version"
  echo 1 > "$fake/dry_n"
  printf '%s\n' "$NINE_DRY_RUN" > "$fake/dry_first"
  printf '%s\n' "$NINE_DRY_RUN" > "$fake/dry_second"
  cat > "$fake/supabase" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
printf '%s\n' "$*" >> "$here/invocations"
if [[ "${1:-}" == '--version' ]]; then
  cat "$here/version"
  exit 0
fi
if [[ "${1:-}" == 'db' && "${2:-}" == 'push' ]]; then
  dry=0
  for a in "$@"; do
    if [[ "$a" == '--dry-run' ]]; then dry=1; fi
  done
  if [[ "$dry" -eq 1 ]]; then
    n="$(cat "$here/dry_n")"
    echo "$((n + 1))" > "$here/dry_n"
    if [[ -f "$here/dry_fail_${n}" ]]; then
      echo 'error: fake dry-run failed' >&2
      exit 7
    fi
    if [[ "$n" -ge 2 && -f "$here/dry_second" ]]; then
      cat "$here/dry_second"
      exit 0
    fi
    cat "$here/dry_first"
    exit 0
  fi
  echo 'MUTATING_DB_PUSH' >> "$here/mutated"
  printf '%s\n' "$*" >> "$here/mutated_args"
  exit 0
fi
echo "unexpected fake supabase args: $*" >&2
exit 3
FAKE
  chmod +x "$fake/supabase"
}

init_temp_repo() {
  local work="$1"
  mkdir -p "$work/scripts/db" "$work/supabase/migrations"
  cp "$ROOT/scripts/db/prod-migrate.sh" "$work/scripts/db/prod-migrate.sh"
  chmod +x "$work/scripts/db/prod-migrate.sh"
  local name
  for name in "${NINE_NAMES[@]}"; do
    : > "$work/supabase/migrations/$name"
  done
  (
    cd "$work"
    GIT_TEMPLATE_DIR= git init >/dev/null
    git checkout -B main >/dev/null 2>&1
    git add scripts supabase
    git -c core.hooksPath=/dev/null -c commit.gpgsign=false \
      -c user.name='prod-migrate-test' -c user.email='prod-migrate-test@example.invalid' \
      commit -m 'temp' >/dev/null
  )
}

mutation_count() {
  local fake="$1"
  if [[ -f "$fake/mutated" ]]; then
    wc -l < "$fake/mutated" | tr -d '[:space:]'
  else
    echo 0
  fi
}

run_apply() {
  local work="$1"
  local fake="$2"
  (
    cd "$work"
    export PATH="$fake:$PATH"
    if [[ -n "${GC_PROD_APPROVED_SHA+x}" ]]; then
      export GC_PROD_APPROVED_SHA
    else
      unset GC_PROD_APPROVED_SHA
    fi
    ./scripts/db/prod-migrate.sh --apply --target local
  )
}

reset_fake() {
  local fake="$1"
  rm -f "$fake/invocations" "$fake/mutated" "$fake/mutated_args" "$fake/dry_fail_1" "$fake/dry_fail_2"
  echo 1 > "$fake/dry_n"
  echo '2.102.0' > "$fake/version"
  printf '%s\n' "$NINE_DRY_RUN" > "$fake/dry_first"
  printf '%s\n' "$NINE_DRY_RUN" > "$fake/dry_second"
}

WORK="$WORK_ROOT/repo"
FAKE="$WORK_ROOT/fake"
mkdir -p "$WORK"
write_fake_cli "$FAKE"
init_temp_repo "$WORK"
APPROVED="$(cd "$WORK" && git rev-parse HEAD)"

# Successful controlled path: exactly one fake mutating push.
reset_fake "$FAKE"
if printf '%s\n' 'APPLY NINE MIGRATIONS' | \
    GC_PROD_APPROVED_SHA="$APPROVED" run_apply "$WORK" "$FAKE" >/dev/null; then
  if [[ "$(mutation_count "$FAKE")" == '1' ]]; then
    pass 'e2e_success_one_fake_mutation'
  else
    fail "e2e_success_one_fake_mutation (mutations=$(mutation_count "$FAKE"))"
  fi
else
  fail 'e2e_success_one_fake_mutation'
fi
if grep -F 'db push --dry-run --local' "$FAKE/invocations" >/dev/null \
  && [[ "$(grep -c 'db push --dry-run --local' "$FAKE/invocations" || true)" == '2' ]] \
  && [[ "$(grep -c '^db push --local$' "$FAKE/invocations" || true)" == '1' ]]; then
  pass 'e2e_success_two_dry_runs_then_one_push'
else
  fail 'e2e_success_two_dry_runs_then_one_push'
fi

# Success B: same control flow with the official two-line upgrade notice.
reset_fake "$FAKE"
printf '%s\n' "$NINE_WITH_UPGRADE" > "$FAKE/dry_first"
printf '%s\n' "$NINE_WITH_UPGRADE" > "$FAKE/dry_second"
if printf '%s\n' 'APPLY NINE MIGRATIONS' | \
    GC_PROD_APPROVED_SHA="$APPROVED" run_apply "$WORK" "$FAKE" >/dev/null; then
  if [[ "$(mutation_count "$FAKE")" == '1' ]]; then
    pass 'e2e_success_with_upgrade_notice_one_mutation'
  else
    fail "e2e_success_with_upgrade_notice_one_mutation (mutations=$(mutation_count "$FAKE"))"
  fi
else
  fail 'e2e_success_with_upgrade_notice_one_mutation'
fi
if [[ "$(grep -c 'db push --dry-run --local' "$FAKE/invocations" || true)" == '2' ]] \
  && [[ "$(grep -c '^db push --local$' "$FAKE/invocations" || true)" == '1' ]]; then
  pass 'e2e_success_with_upgrade_notice_two_dry_runs_then_one_push'
else
  fail 'e2e_success_with_upgrade_notice_two_dry_runs_then_one_push'
fi

# Second dry-run contains an extra migration after confirmation.
reset_fake "$FAKE"
printf '%s\n' "$TEN_HYPHEN" > "$FAKE/dry_second"
if printf '%s\n' 'APPLY NINE MIGRATIONS' | \
    GC_PROD_APPROVED_SHA="$APPROVED" run_apply "$WORK" "$FAKE" >/dev/null 2>&1; then
  fail 'e2e_second_plan_changed_must_fail'
else
  pass 'e2e_second_plan_changed_must_fail'
fi
if [[ "$(mutation_count "$FAKE")" == '0' ]]; then
  pass 'e2e_second_plan_changed_zero_mutation'
else
  fail 'e2e_second_plan_changed_zero_mutation'
fi

# Migration after the terminal footer.
reset_fake "$FAKE"
printf '%s\n' "${NINE_DRY_RUN}
 • 20260809000100_unexpected-extra.sql" > "$FAKE/dry_first"
if printf '%s\n' 'APPLY NINE MIGRATIONS' | \
    GC_PROD_APPROVED_SHA="$APPROVED" run_apply "$WORK" "$FAKE" >/dev/null 2>&1; then
  fail 'e2e_migration_after_footer_must_fail'
else
  pass 'e2e_migration_after_footer_must_fail'
fi
if [[ "$(mutation_count "$FAKE")" == '0' ]]; then
  pass 'e2e_migration_after_footer_zero_mutation'
else
  fail 'e2e_migration_after_footer_zero_mutation'
fi

# Partial upgrade notice (line 1 only).
reset_fake "$FAKE"
printf '%s\n' "${NINE_DRY_RUN}
${UPGRADE_L1}" > "$FAKE/dry_first"
if printf '%s\n' 'APPLY NINE MIGRATIONS' | \
    GC_PROD_APPROVED_SHA="$APPROVED" run_apply "$WORK" "$FAKE" >/dev/null 2>&1; then
  fail 'e2e_partial_upgrade_notice_must_fail'
else
  pass 'e2e_partial_upgrade_notice_must_fail'
fi
if [[ "$(mutation_count "$FAKE")" == '0' ]]; then
  pass 'e2e_partial_upgrade_notice_zero_mutation'
else
  fail 'e2e_partial_upgrade_notice_zero_mutation'
fi

# Altered installed version in the upgrade notice.
reset_fake "$FAKE"
printf '%s\n' "${NINE_DRY_RUN}
A new version of Supabase CLI is available: v2.114.0 (currently installed v2.99.0)
${UPGRADE_L2}" > "$FAKE/dry_first"
if printf '%s\n' 'APPLY NINE MIGRATIONS' | \
    GC_PROD_APPROVED_SHA="$APPROVED" run_apply "$WORK" "$FAKE" >/dev/null 2>&1; then
  fail 'e2e_altered_installed_version_must_fail'
else
  pass 'e2e_altered_installed_version_must_fail'
fi
if [[ "$(mutation_count "$FAKE")" == '0' ]]; then
  pass 'e2e_altered_installed_version_zero_mutation'
else
  fail 'e2e_altered_installed_version_zero_mutation'
fi

# Arbitrary post-footer text.
reset_fake "$FAKE"
printf '%s\n' "${NINE_DRY_RUN}
unexpected trailing line" > "$FAKE/dry_first"
if printf '%s\n' 'APPLY NINE MIGRATIONS' | \
    GC_PROD_APPROVED_SHA="$APPROVED" run_apply "$WORK" "$FAKE" >/dev/null 2>&1; then
  fail 'e2e_arbitrary_post_footer_must_fail'
else
  pass 'e2e_arbitrary_post_footer_must_fail'
fi
if [[ "$(mutation_count "$FAKE")" == '0' ]]; then
  pass 'e2e_arbitrary_post_footer_zero_mutation'
else
  fail 'e2e_arbitrary_post_footer_zero_mutation'
fi

# First dry-run has the footer mid-list (after migration 1).
reset_fake "$FAKE"
printf '%s\n' "$MID_LIST_AFTER_FIRST" > "$FAKE/dry_first"
if printf '%s\n' 'APPLY NINE MIGRATIONS' | \
    GC_PROD_APPROVED_SHA="$APPROVED" run_apply "$WORK" "$FAKE" >/dev/null 2>&1; then
  fail 'e2e_mid_list_footer_must_fail'
else
  pass 'e2e_mid_list_footer_must_fail'
fi
if [[ "$(mutation_count "$FAKE")" == '0' ]]; then
  pass 'e2e_mid_list_footer_zero_mutation'
else
  fail 'e2e_mid_list_footer_zero_mutation'
fi

# Hyphenated extra on the first plan — the reproduced exploit.
reset_fake "$FAKE"
printf '%s\n' "$TEN_HYPHEN" > "$FAKE/dry_first"
if printf '%s\n' 'APPLY NINE MIGRATIONS' | \
    GC_PROD_APPROVED_SHA="$APPROVED" run_apply "$WORK" "$FAKE" >/dev/null 2>&1; then
  fail 'e2e_hyphenated_exploit_must_fail'
else
  pass 'e2e_hyphenated_exploit_must_fail'
fi
if [[ "$(mutation_count "$FAKE")" == '0' ]]; then
  pass 'e2e_hyphenated_exploit_zero_mutation'
else
  fail 'e2e_hyphenated_exploit_zero_mutation'
fi

# Release gates through the real executable.
reset_fake "$FAKE"
if printf '%s\n' 'APPLY NINE MIGRATIONS' | \
    env -u GC_PROD_APPROVED_SHA PATH="$FAKE:$PATH" \
    "$WORK/scripts/db/prod-migrate.sh" --apply --target local >/dev/null 2>&1; then
  fail 'e2e_missing_sha_must_fail'
else
  pass 'e2e_missing_sha_must_fail'
fi
if [[ "$(mutation_count "$FAKE")" == '0' ]]; then
  pass 'e2e_missing_sha_zero_mutation'
else
  fail 'e2e_missing_sha_zero_mutation'
fi

reset_fake "$FAKE"
if printf '%s\n' 'APPLY NINE MIGRATIONS' | \
    GC_PROD_APPROVED_SHA='notasha' run_apply "$WORK" "$FAKE" >/dev/null 2>&1; then
  fail 'e2e_malformed_sha_must_fail'
else
  pass 'e2e_malformed_sha_must_fail'
fi
if [[ "$(mutation_count "$FAKE")" == '0' ]]; then
  pass 'e2e_malformed_sha_zero_mutation'
else
  fail 'e2e_malformed_sha_zero_mutation'
fi

(
  cd "$WORK"
    git -c core.hooksPath=/dev/null -c commit.gpgsign=false \
      -c user.name='prod-migrate-test' -c user.email='prod-migrate-test@example.invalid' \
      commit --allow-empty -m 'second' >/dev/null
)
HEAD2="$(cd "$WORK" && git rev-parse HEAD)"
reset_fake "$FAKE"
if printf '%s\n' 'APPLY NINE MIGRATIONS' | \
    GC_PROD_APPROVED_SHA="$APPROVED" run_apply "$WORK" "$FAKE" >/dev/null 2>&1; then
  fail 'e2e_wrong_sha_must_fail'
else
  pass 'e2e_wrong_sha_must_fail'
fi
if [[ "$(mutation_count "$FAKE")" == '0' ]]; then
  pass 'e2e_wrong_sha_zero_mutation'
else
  fail 'e2e_wrong_sha_zero_mutation'
fi
# Restore HEAD to the approved commit for later success-shaped fixtures.
(
  cd "$WORK"
  git checkout -B main "$APPROVED" >/dev/null 2>&1
)

reset_fake "$FAKE"
echo dirty > "$WORK/dirty.txt"
if printf '%s\n' 'APPLY NINE MIGRATIONS' | \
    GC_PROD_APPROVED_SHA="$APPROVED" run_apply "$WORK" "$FAKE" >/dev/null 2>&1; then
  fail 'e2e_dirty_tree_must_fail'
else
  pass 'e2e_dirty_tree_must_fail'
fi
if [[ "$(mutation_count "$FAKE")" == '0' ]]; then
  pass 'e2e_dirty_tree_zero_mutation'
else
  fail 'e2e_dirty_tree_zero_mutation'
fi
rm -f "$WORK/dirty.txt"

(
  cd "$WORK"
  git checkout -B not-main >/dev/null 2>&1
)
reset_fake "$FAKE"
if printf '%s\n' 'APPLY NINE MIGRATIONS' | \
    GC_PROD_APPROVED_SHA="$APPROVED" run_apply "$WORK" "$FAKE" >/dev/null 2>&1; then
  fail 'e2e_non_main_must_fail'
else
  pass 'e2e_non_main_must_fail'
fi
if [[ "$(mutation_count "$FAKE")" == '0' ]]; then
  pass 'e2e_non_main_zero_mutation'
else
  fail 'e2e_non_main_zero_mutation'
fi
(
  cd "$WORK"
  git checkout -B main "$APPROVED" >/dev/null 2>&1
)

reset_fake "$FAKE"
echo '2.99.0' > "$FAKE/version"
if printf '%s\n' 'APPLY NINE MIGRATIONS' | \
    GC_PROD_APPROVED_SHA="$APPROVED" run_apply "$WORK" "$FAKE" >/dev/null 2>&1; then
  fail 'e2e_wrong_cli_version_must_fail'
else
  pass 'e2e_wrong_cli_version_must_fail'
fi
if [[ "$(mutation_count "$FAKE")" == '0' ]]; then
  pass 'e2e_wrong_cli_version_zero_mutation'
else
  fail 'e2e_wrong_cli_version_zero_mutation'
fi
echo '2.102.0' > "$FAKE/version"

reset_fake "$FAKE"
: > "$FAKE/dry_fail_1"
if printf '%s\n' 'APPLY NINE MIGRATIONS' | \
    GC_PROD_APPROVED_SHA="$APPROVED" run_apply "$WORK" "$FAKE" >/dev/null 2>&1; then
  fail 'e2e_dry_run_failure_must_fail'
else
  pass 'e2e_dry_run_failure_must_fail'
fi
if [[ "$(mutation_count "$FAKE")" == '0' ]]; then
  pass 'e2e_dry_run_failure_zero_mutation'
else
  fail 'e2e_dry_run_failure_zero_mutation'
fi

reset_fake "$FAKE"
printf '%s\n' $'DRY RUN: migrations will *not* be pushed to the database.\nConnecting...\nno filenames here\n' \
  > "$FAKE/dry_first"
if printf '%s\n' 'APPLY NINE MIGRATIONS' | \
    GC_PROD_APPROVED_SHA="$APPROVED" run_apply "$WORK" "$FAKE" >/dev/null 2>&1; then
  fail 'e2e_malformed_plan_must_fail'
else
  pass 'e2e_malformed_plan_must_fail'
fi
if [[ "$(mutation_count "$FAKE")" == '0' ]]; then
  pass 'e2e_malformed_plan_zero_mutation'
else
  fail 'e2e_malformed_plan_zero_mutation'
fi

reset_fake "$FAKE"
if printf '%s\n' 'NOPE' | \
    GC_PROD_APPROVED_SHA="$APPROVED" run_apply "$WORK" "$FAKE" >/dev/null 2>&1; then
  fail 'e2e_wrong_confirmation_must_fail'
else
  pass 'e2e_wrong_confirmation_must_fail'
fi
if [[ "$(mutation_count "$FAKE")" == '0' ]]; then
  pass 'e2e_wrong_confirmation_zero_mutation'
else
  fail 'e2e_wrong_confirmation_zero_mutation'
fi

reset_fake "$FAKE"
: > "$FAKE/dry_fail_2"
if printf '%s\n' 'APPLY NINE MIGRATIONS' | \
    GC_PROD_APPROVED_SHA="$APPROVED" run_apply "$WORK" "$FAKE" >/dev/null 2>&1; then
  fail 'e2e_second_dry_run_failure_must_fail'
else
  pass 'e2e_second_dry_run_failure_must_fail'
fi
if [[ "$(mutation_count "$FAKE")" == '0' ]]; then
  pass 'e2e_second_dry_run_failure_zero_mutation'
else
  fail 'e2e_second_dry_run_failure_zero_mutation'
fi

# Load-bearing source order: first check, confirm, second check, then mutate.
SRC="$ROOT/scripts/db/prod-migrate.sh"
first_line="$(grep -n 'checking complete pending set via' "$SRC" | head -n 1 | cut -d: -f1)"
confirm_line="$(grep -n 'Type APPLY NINE MIGRATIONS' "$SRC" | head -n 1 | cut -d: -f1)"
second_line="$(grep -n 'rechecking complete pending set before mutation' "$SRC" | head -n 1 | cut -d: -f1)"
push_line="$(grep -n '"\$CLI" db push "--\$TARGET"' "$SRC" | tail -n 1 | cut -d: -f1)"
if [[ -n "$first_line" && -n "$confirm_line" && -n "$second_line" && -n "$push_line" \
  && "$first_line" -lt "$confirm_line" && "$confirm_line" -lt "$second_line" \
  && "$second_line" -lt "$push_line" ]]; then
  pass 'source_order_check_confirm_recheck_push'
else
  fail 'source_order_check_confirm_recheck_push'
fi

# Mutation-quality: a copy missing the second check would mutate on plan change.
MUT_WORK="$WORK_ROOT/mut-repo"
MUT_FAKE="$WORK_ROOT/mut-fake"
mkdir -p "$MUT_WORK"
write_fake_cli "$MUT_FAKE"
init_temp_repo "$MUT_WORK"
python3 - "$MUT_WORK/scripts/db/prod-migrate.sh" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1])
text = p.read_text()
old = '''echo "rechecking complete pending set before mutation"
require_exact_pending_set_from_cli
if [[ "$(pending_fingerprint)" != "$FIRST_PENDING_FP" ]]; then
  echo "error: pending set changed between confirmation and apply; nothing applied" >&2
  exit 1
fi
'''
if old not in text:
    raise SystemExit('second-check block not found for mutation copy')
p.write_text(text.replace(old, '', 1))
PY
MUT_SHA="$(cd "$MUT_WORK" && git rev-parse HEAD)"
# The copy is dirty after python edit; commit so SHA/clean/main gates pass.
(
  cd "$MUT_WORK"
  git add scripts/db/prod-migrate.sh
  git -c core.hooksPath=/dev/null -c commit.gpgsign=false \
    -c user.name='prod-migrate-test' -c user.email='prod-migrate-test@example.invalid' \
    commit -m 'mutate' >/dev/null
)
MUT_SHA="$(cd "$MUT_WORK" && git rev-parse HEAD)"
reset_fake "$MUT_FAKE"
printf '%s\n' "$TEN_HYPHEN" > "$MUT_FAKE/dry_second"
if printf '%s\n' 'APPLY NINE MIGRATIONS' | \
    GC_PROD_APPROVED_SHA="$MUT_SHA" run_apply "$MUT_WORK" "$MUT_FAKE" >/dev/null 2>&1; then
  :
fi
if [[ "$(mutation_count "$MUT_FAKE")" != '0' ]]; then
  pass 'mutation_copy_without_second_check_would_mutate'
else
  fail 'mutation_copy_without_second_check_would_mutate'
fi

# Remaining load-bearing gates: copies that drop SHA / dirty / main still exist
# in the real file; the e2e negatives above fail if those guards disappear.
if grep -F 'GC_PROD_APPROVED_SHA does not match checked-out HEAD' "$SRC" >/dev/null \
  && grep -F 'working tree is not clean' "$SRC" >/dev/null \
  && grep -F -- '--apply requires branch main' "$SRC" >/dev/null \
  && grep -F 'require_exact_pending_set_from_cli' "$SRC" >/dev/null; then
  pass 'load_bearing_guards_present_in_real_wrapper'
else
  fail 'load_bearing_guards_present_in_real_wrapper'
fi

if [[ "$failures" -ne 0 ]]; then
  echo "prod-migrate / inventory tests: $failures failed" >&2
  exit 1
fi
echo 'prod-migrate / inventory tests: all passed'
