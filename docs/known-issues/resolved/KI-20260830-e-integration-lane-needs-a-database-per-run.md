### KI-2026-08-30-e — The integration lane needs a schema or database per run; scoping test data cannot finish the job, because `rebuildProjections()` is global by design — RESOLVED, a database per run cloned from a migrated template, and both exclusive leases are gone
- **Severity:** reliability (of the test lane and of parallel agent work) — no product impact; `rebuildProjections()` is correct and its global scope is the point
- **Area:** `apps/web/src/server/projections.ts` (`rebuildProjections`), `apps/web/src/server/db/client.ts`, `apps/web/vitest.config.ts` (the integration lane), `.github/workflows/ci.yml`'s Postgres service, `.claude/protocol/ADAPTER.md`'s exclusive-resources table.
- **Why scoping test data is not enough, which is the whole point of this entry.** KI-69 and KI-89 removed seven whole-table truncations and scoped every assertion to the ids each test creates. That was the right fix and it is done. What it cannot reach is `rebuildProjections()` itself: it does `readAll(tx)` over **every** event in the database, then `tx.delete(tripSummaries)` and `tx.delete(tripDetails)` with no `where`, and re-projects the lot. That is not a defect — invariant 2 says projections are disposable and rebuildable from the log, and this is the function that proves it. A `tripIds` parameter used only by tests would make the golden test exercise a scoped variant rather than the real path, which trades the invariant's guarantee for test convenience. **Rejected on those grounds.**
- **The consequence, observed rather than predicted.** Three suites call it — `commands`, `projections`, `anchors`. With the truncations gone, every row any earlier test left behind is re-projected on each call, so **any foreign or legacy event row is inside the blast radius of every suite that rebuilds**. KI-89's unit hit this directly: while deliberately malformed events were in the table, `rebuildProjections()` threw `ZodError … path: ["payload","createdBy"] … Required` from `projectTripSummaries` and failed **two otherwise-unrelated tests**.
- **What it costs today, beyond flakiness:** `postgres` has to be an exclusive resource in `ADAPTER.md`, so exactly one agent may run `test:int` at a time. On the 2026-08-30 sweep that capped a four-agent batch at one Postgres user — the other three were explicitly barred from the integration lane and from `pnpm check`. The lane being exclusive is a throughput ceiling on parallel work, not only a correctness worry.
- **The fix (KI-69's second, untaken path):** a schema or database per run. `CREATE SCHEMA test_$RUN`, point the run's `search_path`/connection at it, drop at teardown. Every run is then isolated, `rebuildProjections()` stays honestly global and keeps proving invariant 2 on the real code path, and `test:int` stops needing an exclusive lease.
- **Estimated 1-2 days**, and it is not a one-file change: `db/client.ts` (connection/search_path), the integration lane's setup and teardown, CI's Postgres service configuration, and a decision about how migrations are applied per schema. It wants its own reviewed step rather than being appended to a sweep branch.
- **Approved in principle by Mitchell, 2026-08-30**, as the safer of the two options put to him — the other being the scoped-variant shortcut rejected above. Filed here rather than started, so the work is visible and the reasoning survives.
- **Cross-reference:** KI-69 (resolved — six suites scoped; names this as its second fix path), KI-89 (resolved — the seventh, and where the ZodError was observed), KI-13 (resolved — parallel-load flakiness, the same family), `.claude/protocol/ADAPTER.md`.
- **First noted:** 2026-08-30, from KI-89's report.
- **Fix (2026-09-04): `apps/web/scripts/with-test-db.mjs`, a wrapper process — no application
  change at all.** The entry's approved path was a schema per run; this is a *database* per
  run, which is the same isolation bought more cheaply, and it needed none of the four edits
  the estimate listed. `db/client.ts` builds its pool from `DATABASE_URL` at import time,
  `drizzle.config.ts` reads the same value, and `playwright.config.ts` forwards it into
  `webServer.env` — so a parent process that rewrites `DATABASE_URL` isolates the whole lane
  while the code under test stays byte-for-byte the code that runs in production.
  `rebuildProjections()` is untouched and still global, which is what this entry refused to
  trade away.
- **Why a template rather than migrating each run.** Measured on Postgres 16, this repo's 16
  migrations: `drizzle-kit migrate` into an empty database **1578 ms**, versus
  `CREATE DATABASE … TEMPLATE` at **81–93 ms** (the migrated database is 7983 kB). So the
  wrapper migrates once per distinct migration set into `tc_tmpl_<fingerprint>` — the
  fingerprint being a hash of `drizzle/*.sql` plus `meta/_journal.json` — and every run after
  that is a file-level copy. A branch with different migrations gets its own template rather
  than fighting over one, which is the case a shared schema would have handled worst.
- **Three Postgres behaviours the flow is built around, verified rather than assumed:**
  four concurrent clones of one template all succeed; cloning a template that has a live
  connection fails with `55006` (hence the advisory lock around template construction, and
  the retry); and `DROP DATABASE` fails the same way while a connection is open, so teardown
  uses `WITH (FORCE)`. A half-migrated template can never be adopted — the migration runs
  into `…_building` and is renamed only on success.
- **Nothing to provision and nothing to remember.** Run databases are named
  `tc_test_<epoch>_<rand>`, dropped when the command exits (including on Ctrl-C, which the
  wrapper catches so teardown is not skipped), and swept by a later run if a process was
  SIGKILLed. `KEEP_TEST_DB=1` keeps one and prints its URL. The sweep deliberately never
  touches another fingerprint's template: a second worktree on another branch legitimately
  has a different migration set.
- **The exclusive resources this entry paid for are both gone.** `postgres` and `dev-server`
  are removed from `.claude/protocol/adapter.json` and `ADAPTER.md`, so the four-agent batch
  this entry describes — capped at one Postgres user, three agents barred from the lane — is
  no longer capped. The `dev-server` half needed the other flag the wrapper carries:
  `--with-port` picks a free port into `WEB_PORT`, which `src/config.ts` already threads into
  both the dev command and Playwright's `baseURL`.
- **Proven, not assumed (2026-09-04):** `pnpm --filter web test:int` twice **concurrently**
  from one checkout — 39 files / 445 tests green in both, on two databases that existed at
  the same time (`tc_test_1788507172055_2uvjde`, `tc_test_1788507172069_lrjkb6`), with the
  shared `travel` database untouched at 0 events and no leftovers afterwards.
- **Scope note:** this covers the local and CI lanes. Vercel preview deployments still share
  the single Neon `preview` branch — that is by design (`docs/guidelines/environments-and-
  deploys.md`) and is not what this entry was about.
