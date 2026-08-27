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
  local pgbin pgdata logdir live
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

  # Logs go in a fresh mktemp -d (0700, unguessable name), not at fixed /tmp
  # paths. This function runs as root, and `>` follows symlinks: a fixed
  # /tmp/initdb.log a local process had pre-created as a link to something
  # else would be truncated as root (CWE-377). The postmaster's own log is the
  # exception — it lives in $pgdata, which postgres owns and which is where a
  # server log conventionally belongs anyway.
  logdir="$(mktemp -d 2>/dev/null)" \
    || { echo "session-start: cannot create a log directory; skipping database setup." >&2; return 0; }

  if [ ! -f "$pgdata/PG_VERSION" ]; then
    su postgres -c "$pgbin/initdb -D $pgdata -U postgres --auth=trust" >"$logdir/initdb.log" 2>&1 || {
      echo "session-start: initdb failed; see $logdir/initdb.log" >&2
      return 0
    }
  fi

  # Start only if OUR cluster is down. `pg_ctl status` reads
  # $pgdata/postmaster.pid, so it answers "is this data directory's own
  # postmaster up", not the much weaker "is anything listening on 5433".
  if ! su postgres -c "$pgbin/pg_ctl -D $pgdata status" >/dev/null 2>&1; then
    su postgres -c "$pgbin/pg_ctl -D $pgdata -o '-p 5433 -k /var/run/postgresql' -l $pgdata/postgres.log start" \
      >/dev/null 2>&1 || {
      echo "session-start: could not start Postgres on :5433; see $pgdata/postgres.log" >&2
      return 0
    }
  fi

  # Prove the server answering on 5433 is the one we just vouched for, before
  # creating a database or running a migration against it. `pg_ctl start`
  # fails when the port is already taken, and a bare readiness probe would
  # cheerfully succeed against the squatter — reproduced 2026-08-26 by
  # standing a second cluster on 5433: pg_ctl exited 1, pg_isready still said
  # yes, and `SHOW data_directory` was the only thing that noticed.
  live="$(psql -h 127.0.0.1 -p 5433 -U postgres -tAc 'SHOW data_directory' 2>/dev/null | tr -d '[:space:]')"
  if [ "$live" != "$pgdata" ]; then
    echo "session-start: :5433 is served by '${live:-nothing}', not $pgdata — refusing to migrate it." >&2
    return 0
  fi

  psql -h 127.0.0.1 -p 5433 -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='travel'" 2>/dev/null \
    | grep -q 1 \
    || psql -h 127.0.0.1 -p 5433 -U postgres -q -c "CREATE DATABASE travel" >/dev/null 2>&1 \
    || { echo "session-start: could not create the 'travel' database." >&2; return 0; }

  # Without this the first `db:reseed` of every session dies on
  # `relation "events" does not exist` — db-reset.mjs truncates tables that
  # only a migration creates.
  pnpm --filter web db:migrate >"$logdir/db-migrate.log" 2>&1 \
    || echo "session-start: db:migrate failed; run it by hand (see $logdir/db-migrate.log)." >&2
}

# The image ships Playwright's browsers at PLAYWRIGHT_BROWSERS_PATH, but the
# revision `@playwright/test` asks for and the revision that has a usable
# headless-shell binary are not always the same one — 2026-08-26, chromium
# 1228's chrome-headless-shell-linux64/ was present and empty while 1194's full
# chrome was fine, so every e2e run died on a missing executable until the two
# were linked by hand. That hand-fix does not survive the container, so it
# belongs here. Deliberately generic (any empty shell dir, any full chromium)
# so a Playwright bump does not silently reintroduce it.
link_playwright_shell() {
  browsers="${PLAYWRIGHT_BROWSERS_PATH:-/opt/pw-browsers}"
  [ -d "$browsers" ] || return 0

  fallback=""
  for candidate in "$browsers"/chromium-*/chrome-linux/chrome; do
    if [ -x "$candidate" ]; then fallback="$candidate"; break; fi
  done
  [ -n "$fallback" ] || return 0

  for shellroot in "$browsers"/chromium_headless_shell-*; do
    [ -d "$shellroot" ] || continue
    target="$shellroot/chrome-headless-shell-linux64/chrome-headless-shell"
    # -e follows the link, so an existing GOOD link is skipped and a dangling
    # one is repaired rather than left to fail at test time.
    [ -e "$target" ] && continue
    mkdir -p "$(dirname "$target")" 2>/dev/null || continue
    if ln -sfn "$fallback" "$target" 2>/dev/null; then
      echo "session-start: linked $(basename "$shellroot")'s missing headless shell -> $fallback"
    fi
  done

  # The loop above only repairs revision dirs that ALREADY EXIST — it matches
  # on an empty shell dir. That is not enough, and KI-32 was closed believing
  # it was: its verification deleted the *link* and left the directory, so 1228
  # looked repaired. On a fresh container the image ships only
  # chromium_headless_shell-1194 and the 1228 directory does not exist at all,
  # so the glob never yields it, nothing is linked, and the whole e2e suite
  # dies at auth.setup.ts on "Executable doesn't exist" — exactly the silent
  # reintroduction the entry claimed to have prevented (seen 2026-08-27).
  #
  # So ask Playwright which revision it actually wants rather than inferring it
  # from what happens to be on disk. browsers.json is playwright-core's own
  # manifest, so this keeps tracking a version bump instead of pinning 1228.
  pwcore=$(find "$PWD/node_modules/.pnpm" -maxdepth 4 -path '*/playwright-core/browsers.json' 2>/dev/null | head -1)
  [ -n "$pwcore" ] || return 0
  command -v node >/dev/null 2>&1 || return 0

  for rev in $(node -e '
    try {
      const m = require(process.argv[1]);
      const revs = new Set(
        (m.browsers || [])
          .filter((b) => b.name === "chromium" || b.name === "chromium-headless-shell")
          .map((b) => b.revision),
      );
      process.stdout.write([...revs].join(" "));
    } catch { /* no manifest, nothing to reconcile */ }
  ' "$pwcore" 2>/dev/null); do
    for target in \
      "$browsers/chromium_headless_shell-$rev/chrome-headless-shell-linux64/chrome-headless-shell" \
      "$browsers/chromium-$rev/chrome-linux/chrome"; do
      [ -e "$target" ] && continue
      mkdir -p "$(dirname "$target")" 2>/dev/null || continue
      if ln -sfn "$fallback" "$target" 2>/dev/null; then
        echo "session-start: created and linked Playwright's expected $(basename "$(dirname "$(dirname "$target")")") -> $fallback"
      fi
    done
  done
}

if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ]; then
  pnpm install
  pnpm run setup
  start_postgres
  link_playwright_shell
  exit 0
fi

# Local: never fail the session over this. A dirty lockfile mid-refactor is a
# normal working state, and a hook that aborts startup because of it is worse
# than a hook that stays quiet.
if ! pnpm install --frozen-lockfile --prefer-offline >/dev/null 2>&1; then
  echo "session-start: 'pnpm install --frozen-lockfile' did not succeed." >&2
  echo "session-start: if checks fail with TS2307 'cannot find module', run 'pnpm install' first." >&2
fi
