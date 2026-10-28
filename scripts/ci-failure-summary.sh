#!/usr/bin/env bash
# Runs a CI test command and, when it fails, writes what failed where the REST
# API can read it: the step summary ($GITHUB_STEP_SUMMARY) and one `::error`
# annotation.
#
#   bash scripts/ci-failure-summary.sh "<job name>" <command> [args...]
#
# Why: a job's log cannot be read from a cloud session — the log hosts are
# refused by the agent proxy (KI-2026-10-13-f) — so a red job whose only
# annotation is "Process completed with exit code 1" is triaged blind. Vitest's
# `github-actions` reporter annotates failed assertions, but not an unhandled
# error, a crashed worker, a package that died before its reporter ran
# (KI-2026-10-14-c), or a `node --test` run, which has no such reporter. So on
# failure this greps the log for the lines that name a failure and publishes
# them. It was inline in `test / unit` first; the other test jobs use it too.
#
# Exits with the command's own status, so the job's verdict is unchanged.
set -uo pipefail

title=$1
shift
log="${RUNNER_TEMP:-/tmp}/ci-failure-summary.$$.log"
"$@" 2>&1 | tee "$log"
status=${PIPESTATUS[0]}
if [ "$status" -ne 0 ]; then
  plain=$(sed 's/\x1b\[[0-9;]*m//g' "$log")
  # vitest: `FAIL `, `Test Files `, worker and unhandled-error lines.
  # node --test: `✖ <test>` and `not ok`. Both: `Error: ` / `AssertionError`.
  hits=$(printf '%s\n' "$plain" \
    | grep -aE 'FAIL |✖ |not ok |originated in "|Uncaught Exception|Unhandled Rejection|Error: |AssertionError|Worker exited|Test timed out|heap out of memory|ERR_PNPM|Test Files ' \
    | grep -v '^::' | cut -c1-300 | head -n 40)
  [ -n "$hits" ] || hits=$(printf '%s\n' "$plain" | tail -n 40)
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    {
      echo "### ${title} exited ${status}"
      echo '```'
      echo "$hits"
      echo '```'
    } >> "$GITHUB_STEP_SUMMARY"
  fi
  # One annotation, not one per line: a step keeps only 10 errors.
  msg=$(printf '%s' "$hits" | sed 's/%/%25/g; s/\r/%0D/g' | awk 'BEGIN{ORS="%0A"} {print}')
  echo "::error title=${title} exited ${status}::${msg}"
fi
rm -f "$log"
exit "$status"
