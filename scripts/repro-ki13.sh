#!/usr/bin/env bash
# Recreates KI-13's historical reproduction condition on purpose: saturates
# every core, then runs the apps/web unit suite. docs/known-issues.md's KI-13
# entry describes wall-clock waitFor/findBy* budgets starving under resource
# pressure as the SUSPECTED mechanism behind three earlier observations
# (2026-07-26 onward) — this is the 2026-08-16 reproduction condition,
# deliberately recreated so a future session doesn't have to reconstruct it
# by hand. As of 2026-08-23 (test-suite-overhaul Phase 4) this script does
# NOT reproduce a failure on this codebase, on either the pre- or
# post-Phase-1 vitest config — KI-13 is closed as no longer reproducible,
# explicitly not as root-caused. Read the KI-13 entry before assuming this
# script proves or disproves anything about a future failure.
#
# Usage: scripts/repro-ki13.sh (run from the repo root or apps/web)
set -euo pipefail

cd "$(dirname "$0")/.."

echo "machine state before saturating:"
ps aux --sort=-%cpu | head -5
echo

CORES=$(nproc)
echo "spinning $CORES CPU hogs..."
PIDS=()
for _ in $(seq 1 "$CORES"); do
  (while :; do :; done) &
  PIDS+=("$!")
done
trap 'kill "${PIDS[@]}" 2>/dev/null || true' EXIT

sleep 1
echo "machine state after saturating:"
ps aux --sort=-%cpu | head -"$((CORES + 3))"
echo

echo "running apps/web unit suite under saturation..."
pnpm --filter web exec vitest run -c vitest.unit.config.ts --reporter=dot
EXIT_CODE=$?

kill "${PIDS[@]}" 2>/dev/null || true
trap - EXIT

exit "$EXIT_CODE"
