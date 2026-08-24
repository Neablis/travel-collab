#!/bin/bash
# SessionStart hook for Claude Code on the web: installs workspace
# dependencies and creates apps/web/.env.local so typecheck/lint/unit tests
# (`pnpm check`) work out of the box in a fresh remote session.
#
# Deliberately does NOT start docker-compose/Postgres or install Playwright
# browsers — remote sessions have no docker daemon, and integration/e2e
# tests need real infra anyway (see docs/guidelines/quality-enforcement.md).
# Run `pnpm test:int` / `pnpm --filter web test:e2e` manually when needed.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

pnpm install
pnpm run setup
