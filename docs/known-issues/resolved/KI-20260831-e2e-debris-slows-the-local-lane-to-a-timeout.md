### KI-20260831 — Repeated local e2e runs leave debris that eventually times a spec out, and it looks exactly like a defect in your diff — RESOLVED, the local lane now gets the fresh database per run CI always had
- **Severity:** reliability of the local test lane (CI is unaffected — it gets a fresh database per run)
- **Area:** `apps/web/e2e/global.teardown.ts`, `apps/web/e2e/m11-saved-days.spec.ts`, the `saved_days` / `trip_invites` / `trip_shares` / `trip_details` tables
- **How it presents:** `m11-saved-days.spec.ts:27` ("keep a day out of one trip, and drop it into another") fails on
  `page.waitForResponse: Test timeout of 90000ms exceeded`, waiting for `POST /api/saved-days`. It appears after
  **several full-suite runs in one session**, not on a first run, and correlates with nothing in the diff.
- **Why the usual discriminator points the wrong way.** `CLAUDE.md` says a failure whose location *moves* between
  runs is a timeout, and one that fails in the same place every time is a real defect. This one fails in the same
  place every time — including run in isolation, including on a retry — so the heuristic says "real defect in your
  change", and it is not one. What separates it: it reproduces **identically on `origin/main`** against the same
  database, and it disappears completely on a reset one.
- **The numbers, measured 2026-08-31.** After ~8 full `test:e2e:ci-like` runs in one session the local database held
  168 `saved_days`, 517 `trip_invites`, 255 `trip_shares` and 113 `trip_details`. The spec timed out at 90s. After
  `db:reset`, the same spec on the same commit passed in **12.4 seconds**. Not marginal — two orders of magnitude.
- **Why it accumulates.** `global.teardown.ts` sweeps trips whose name carries the `[e2e]` prefix, and nothing else.
  `m11-saved-days.spec.ts` says so in its own comment — *"A saved day, not a trip — no `[e2e]` prefix
  (global.teardown.ts only sweeps trips)"* — so saved days were known to survive; what was not recorded is that
  enough of them (together with invites and shares, which survive for the same reason) make a spec time out rather
  than merely leave clutter.
- **Diagnosis:**
  ```bash
  cd apps/web && node --env-file-if-exists=.env.local -e "
  const { Client } = require('pg');
  (async () => { const c = new Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
    for (const t of ['saved_days','trip_invites','trip_shares','trip_details'])
      console.log(t, (await c.query('select count(*)::int n from '+t)).rows[0].n);
    await c.end(); })();"
  ```
- **Fix, locally:** `pnpm --filter web db:reset --yes` (then `db:seed` if you want the `[Seed]` trips back).
- **The durable fix, which someone should decide deliberately.** Widening the teardown to sweep saved days, invites
  and shares runs into the same objection KI-83 records against giving the e2e hooks a database client: both hooks
  are HTTP-only by design. A saved day has no owner-scoped delete endpoint today, so an HTTP-only sweep would need
  one — a real API addition for a test-lane concern. Recorded rather than done.
- **Cross-reference:** KI-83 (the same shape — a persisted resource that survives restarts and makes a later run
  fail for no reason in the diff — with the AI quota instead of row counts), KI-27 (the other "a red lane is not a
  defect" trap), KI-28 (the home grid's per-card fetch, why debris makes runs slower).
- **Found by:** the 2026-08-30 design pass (PR #98), after a spec that had passed 8 times went red, reproducing it
  on `origin/main` in a second worktree against the same database, and then measuring the same spec at 12.4s on a
  reset one.
- **First noted:** 2026-08-31.
- **Fix (2026-09-04): none of the three options this entry weighed.** It framed the durable
  fix as widening `global.teardown.ts` to sweep saved days, invites and shares — which needed
  an owner-scoped delete endpoint, a real API addition for a test-lane concern, and ran into
  KI-83's objection that both e2e hooks are HTTP-only by design. That whole argument is moot:
  `pnpm --filter web test:e2e` now runs under `scripts/with-test-db.mjs` (KI-2026-08-30-e), so
  every run gets a private database cloned from a migrated template and dropped when the run
  ends. This entry's own first line said CI is unaffected *because it gets a fresh database
  per run*; the local lane now has the same thing, which is why no endpoint is needed.
- **What that means for the debris itself.** `global.teardown.ts` still sweeps only
  `[e2e]`-prefixed trips, and saved days, invites and shares still survive it — but nothing
  survives the run, so the counts this entry measured (168 `saved_days`, 517 `trip_invites`,
  255 `trip_shares`, 113 `trip_details` after ~8 runs) cannot accumulate. The hooks were not
  touched and did not need to be.
- **Still true and worth keeping:** the discriminator this entry records. A failure that
  reproduces identically on `origin/main` against the same database, and vanishes on a reset
  one, was never a defect in your diff. That reasoning outlives the specific cause.
