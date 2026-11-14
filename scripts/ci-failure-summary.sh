#!/usr/bin/env bash
# Runs a CI test command and, when it fails, writes what failed to one `::error`
# annotation, which the REST API can read, and to the step summary
# ($GITHUB_STEP_SUMMARY), which only the run's web page shows.
#
#   bash scripts/ci-failure-summary.sh "<job name>" <command> [args...]
#
# Why: a job's log cannot be read from a cloud session — the log hosts are
# refused by the agent proxy (KI-2026-10-13-f) — so a red job whose only
# annotation is "Process completed with exit code 1" is triaged blind. Vitest's
# `github-actions` reporter annotates failed assertions, but not an unhandled
# error, a crashed worker, a package that died before its reporter ran
# (KI-2026-10-14-c), or a `node --test` run, which has no such reporter.
# Playwright's `github` reporter annotates each failed test, but not a web
# server that never came up or a global setup that threw. So on failure this
# greps the log for the lines that name a failure and publishes them. It was
# inline in `test / unit` first; every test job uses it now.
#
# The annotation is the copy a session reads. The check run's `output.summary`
# is null on a job whose step summary this filled (`test / unit`, check run
# 130854188487, 2026-11-14): GitHub does not serve step summaries over REST.
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
  # node --test: `✖ <test>` and `not ok`. All: `Error: ` / `AssertionError`.
  # Playwright's `line` reporter: the `  1) <spec>:3:1 › <title>` header of each
  # failure, the `  2 failed` / `flaky` tally, and the indented `<spec> › <title>`
  # list under it. Its `[1/9] <spec> › <title>` progress lines start at column 0
  # and name passing tests too, so they are left out. The `──` rule Playwright
  # pads a title with is dropped.
  hits=$(printf '%s\n' "$plain" \
    | grep -aE 'FAIL |✖ |not ok |originated in "|Uncaught Exception|Unhandled Rejection|Error: |AssertionError|Worker exited|Test timed out|heap out of memory|ERR_PNPM|Test Files |^ +[0-9]+\) |^ +[0-9]+ (failed|flaky|interrupted|did not run)|^    [^ ].*:[0-9]+:[0-9]+ › ' \
    | grep -v '^::' | sed 's/ \(─\)*$//' | cut -c1-300 | head -n 40)
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
