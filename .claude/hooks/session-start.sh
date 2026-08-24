#!/bin/bash
# SessionStart hook. Two jobs, split by environment:
#
#   Remote (Claude Code on the web): full install plus `pnpm run setup`, which
#   creates apps/web/.env.local so typecheck/lint/unit tests (`pnpm check`)
#   work out of the box in a fresh container.
#
#   Local: dependency reconciliation only. Git worktrees do NOT share
#   node_modules, so a worktree created before a dependency landed keeps a
#   stale tree indefinitely — this hook previously exited early on local
#   sessions, and a worktree was found on 2026-08-24 whose node_modules
#   predated @tc/factories by 16 days, failing `typecheck` with a pile of
#   TS2307 "cannot find module" errors that read like real type errors.
#   An already-current install costs well under a second, so this runs
#   unconditionally rather than trying to detect staleness.
#
# Deliberately does NOT start docker-compose/Postgres or install Playwright
# browsers — remote sessions have no docker daemon, and integration/e2e
# tests need real infra anyway (see docs/guidelines/quality-enforcement.md).
# Run `pnpm test:int` / `pnpm --filter web test:e2e` manually when needed.
set -euo pipefail

cd "$CLAUDE_PROJECT_DIR"

if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ]; then
  pnpm install
  pnpm run setup
  exit 0
fi

# Local: never fail the session over this. A dirty lockfile mid-refactor is a
# normal working state, and a hook that aborts startup because of it is worse
# than a hook that stays quiet.
if ! pnpm install --frozen-lockfile --prefer-offline >/dev/null 2>&1; then
  echo "session-start: 'pnpm install --frozen-lockfile' did not succeed." >&2
  echo "session-start: if checks fail with TS2307 'cannot find module', run 'pnpm install' first." >&2
fi
