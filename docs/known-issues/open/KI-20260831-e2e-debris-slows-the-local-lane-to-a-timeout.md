### KI-20260831 — Repeated local e2e runs leave debris that eventually times a spec out, and it looks exactly like a defect in your diff
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
