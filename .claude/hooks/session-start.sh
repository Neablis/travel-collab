#!/bin/bash
# SessionStart hook. Two jobs, split by environment:
#
#   Remote (Claude Code on the web): full install, `pnpm run setup` (which
#   creates apps/web/.env.local so `pnpm check` works out of the box), and a
#   running, migrated Postgres — see "Postgres" below.
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
# --- Postgres (remote only) ---
# This hook used to skip Postgres entirely, on the reasoning that "remote
# sessions have no docker daemon". The daemon part is still true; the
# conclusion was not. Postgres 16 is in the remote base image and needs no
# docker at all — measured 2026-08-26 in a web session: initdb 859ms,
# pg_ctl start 127ms, db:migrate ~1.9s. Roughly three seconds buys every
# session a database, instead of each one hand-rolling a cluster before it
# can seed, run `test:int`, or open a single page that reads a trip.
#
# Two things the binaries make awkward, both handled below: only `psql` is on
# PATH (initdb/pg_ctl live in /usr/lib/postgresql/<v>/bin), and Postgres
# refuses to run as root, hence `su postgres`.
#
# Port 5433 and the `travel` database name are not chosen here — they are
# what apps/web/.env.example's DATABASE_URL already points at, so this brings
# up exactly the database the app is already configured to reach.
#
# Deliberately still NOT done here: seeding. `db:seed` needs the dev server
# running (it POSTs through the real command API on purpose) and takes far
# too long to sit in front of every session start. Run it yourself:
#
#   pnpm dev                          # one terminal
#   pnpm --filter web db:reseed       # another, once the server is up
#
# Playwright browsers are likewise not installed — the remote image already
# ships Chromium at $PLAYWRIGHT_BROWSERS_PATH.
set -euo pipefail

cd "$CLAUDE_PROJECT_DIR"

# Never fail the session over the database. A missing binary, a port already
# taken, or a half-initialised data directory are all recoverable by hand;
# aborting startup over any of them is worse than a warning and a working
# shell. Every step below is therefore advisory, and says what it skipped.
start_postgres() {
  local pgbin pgdata
  pgbin="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"
  if [ -z "$pgbin" ] || [ ! -x "$pgbin/initdb" ]; then
    echo "session-start: no Postgres in this image; skipping database setup." >&2
    return 0
  fi
  pgdata=/var/lib/postgresql/travel

  # Guarded, like every other step here: this file runs under `set -e`, so an
  # unguarded failure would abort the whole hook and fail session start — the
  # exact opposite of this function's "never fail the session over the
  # database" contract. A read-only path, or an image without a `postgres`
  # user, should cost you a database, not a session.
  mkdir -p "$pgdata" /var/run/postgresql 2>/dev/null \
    || { echo "session-start: cannot create $pgdata; skipping database setup." >&2; return 0; }
  chown -R postgres:postgres "$pgdata" /var/run/postgresql 2>/dev/null \
    || { echo "session-start: cannot chown $pgdata to postgres; skipping database setup." >&2; return 0; }

  if [ ! -f "$pgdata/PG_VERSION" ]; then
    su postgres -c "$pgbin/initdb -D $pgdata -U postgres --auth=trust" >/tmp/initdb.log 2>&1 || {
      echo "session-start: initdb failed; see /tmp/initdb.log" >&2
      return 0
    }
  fi

  # `pg_ctl start` on an already-running cluster exits non-zero; treat it as
  # success and let the readiness check below be the real verdict.
  su postgres -c "$pgbin/pg_ctl -D $pgdata -o '-p 5433 -k /var/run/postgresql' -l /tmp/postgres.log start" \
    >/dev/null 2>&1 || true

  if ! "$pgbin/pg_isready" -h 127.0.0.1 -p 5433 -q 2>/dev/null; then
    echo "session-start: Postgres did not come up on :5433; see /tmp/postgres.log" >&2
    return 0
  fi

  psql -h 127.0.0.1 -p 5433 -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='travel'" 2>/dev/null \
    | grep -q 1 \
    || psql -h 127.0.0.1 -p 5433 -U postgres -q -c "CREATE DATABASE travel" >/dev/null 2>&1 \
    || { echo "session-start: could not create the 'travel' database." >&2; return 0; }

  # Without this the first `db:reseed` of every session dies on
  # `relation "events" does not exist` — db-reset.mjs truncates tables that
  # only a migration creates.
  pnpm --filter web db:migrate >/tmp/db-migrate.log 2>&1 \
    || echo "session-start: db:migrate failed; run it by hand (see /tmp/db-migrate.log)." >&2
}

if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ]; then
  pnpm install
  pnpm run setup
  start_postgres
  exit 0
fi

# Local: never fail the session over this. A dirty lockfile mid-refactor is a
# normal working state, and a hook that aborts startup because of it is worse
# than a hook that stays quiet.
if ! pnpm install --frozen-lockfile --prefer-offline >/dev/null 2>&1; then
  echo "session-start: 'pnpm install --frozen-lockfile' did not succeed." >&2
  echo "session-start: if checks fail with TS2307 'cannot find module', run 'pnpm install' first." >&2
fi
