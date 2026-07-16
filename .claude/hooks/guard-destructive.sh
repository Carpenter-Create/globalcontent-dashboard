#!/usr/bin/env bash
# guard-destructive.sh — PreToolUse guardrail for Claude Code.
#
# Runs BEFORE the Bash tool executes. If the command matches a destructive pattern,
# it exits 2 to BLOCK the call (the stderr message is shown to Claude as the reason).
# Exit 0 = allow. Works even under --dangerously-skip-permissions.
#
# This is a BACKSTOP, not a guarantee. Keep it as one layer of defense-in-depth:
# hook + deny rules + a git commit before risky work. Test it before trusting it (see bottom).
#
# Parse errors exit 0 (fail-open) so a bug here can't brick your workflow. To fail-closed
# (block on any error) instead, change the two "exit 0" fallbacks below to "exit 2".

set -euo pipefail
payload="$(cat)"

if command -v jq >/dev/null 2>&1; then
  tool="$(printf '%s' "$payload" | jq -r '.tool_name // empty' 2>/dev/null || true)"
  cmd="$(printf '%s' "$payload"  | jq -r '.tool_input.command // empty' 2>/dev/null || true)"
else
  tool=""
  cmd="$payload"
fi

case "$tool" in
  Bash|"") : ;;
  *) exit 0 ;;
esac
[ -z "${cmd:-}" ] && exit 0

patterns=(
  'rm[[:space:]]+-[a-z]*r[a-z]*f'
  'sudo[[:space:]]+rm'
  'drop[[:space:]]+table'
  'drop[[:space:]]+database'
  'drop[[:space:]]+policy'
  'truncate[[:space:]]'
  'delete[[:space:]]+from'
  'alter[[:space:]]+table'
  'supabase[[:space:]]+db[[:space:]]+reset'
  'supabase[[:space:]]+db[[:space:]]+push'
  'supabase[[:space:]]+migration[[:space:]]+up'
  'git[[:space:]]+push[[:space:]].*--force'
  'git[[:space:]]+reset[[:space:]]+--hard'
)

for p in "${patterns[@]}"; do
  if printf '%s' "$cmd" | grep -Eiq "$p"; then
    echo "BLOCKED by guard-destructive.sh: matches a destructive pattern ('$p')." >&2
    echo "Show me the exact SQL/command and get my explicit approval first." >&2
    exit 2
  fi
done
exit 0

# TEST (run once):
#   chmod +x .claude/hooks/guard-destructive.sh
#   echo '{"tool_name":"Bash","tool_input":{"command":"drop table users"}}' | .claude/hooks/guard-destructive.sh ; echo "exit=$?"   # expect BLOCKED, exit=2
#   echo '{"tool_name":"Bash","tool_input":{"command":"npm test"}}'         | .claude/hooks/guard-destructive.sh ; echo "exit=$?"   # expect exit=0
