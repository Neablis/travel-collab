### KI-83 — Repeated local e2e runs exhaust the per-user AI quota, and `/ask` specs go red with 429 for a reason no code change explains — RESOLVED, counters live in the run's own database, and the ceiling is untouched
- **Severity:** reliability of the test lane (the product ceiling is working exactly as designed; what is missing is any way to tell that from the failure)
- **Area:** `apps/web/src/server/quota.ts` (`aiQuotas()`), `apps/web/e2e/m10-simulated-ai.spec.ts`, `apps/web/e2e/m16-assistant.spec.ts`, `apps/web/playwright.config.ts` (`webServer.env`), the `rate_limit_counters` table
- **How it presents:** every `/ask` e2e fails at once. `m10-simulated-ai.spec.ts:50` fails on `expect(response.status()).toBe(200)` with **`Received: 429`**, and the proposal-card specs fail a step later on `getByRole("region", { name: "Proposed change" })` never appearing, because the turn that would have produced it was refused. `m16-assistant.spec.ts` fails on the transcript never filling. The failure **appears after several suite runs, not on a first run**, and correlates with **nothing in the diff** — the specs that break are the ones you did not touch as readily as the ones you did.
- **The discriminator, and why it is worth stating.** It looks like a timeout and is not one. The failing STEP does move between runs — whichever `/ask` happens to cross the ceiling first depends on how many were spent before it, so a retry fails somewhere else and the adapter's "a failure whose location moves is a timeout" heuristic points the wrong way here. Two things separate it. It reproduces identically on `test:e2e:ci-like` rather than only on the dev lane (so it is not KI-27), and — the giveaway — it is not fixed by anything you would normally try. The quota is **per-user, per-hour, and persisted in Postgres** (deliberately — `quota.ts`'s header explains that an in-memory counter caps nothing on Vercel serverless), so it **survives a restarted dev server, a rebuild, a fresh `next start`, a new worktree, and a `git stash`**. Nothing else in the suite behaves that way. If restarting everything changes nothing and the failure is confined to `/ask`, this is the entry you want.
- **The numbers.** `aiQuotas()` is 30 requests/hour and 100/day per user, 300/hour and 1000/day globally. One full `test:e2e:ci-like` run makes **~7** `/ask` calls (3 in `m10-simulated-ai`, 4 in `m16-assistant`), so **roughly four full suite runs inside one hour exhausts the hourly ceiling** — which is one afternoon of iterating on an assistant spec. Playwright's retries make it sooner. Watch the daily cap too: ~14 runs a day reaches it, and unlike the hourly one **waiting an hour does not clear it**. Every e2e run shares one account, `dev-alice`, so the ceiling is per-suite in practice, not per-spec.
- **Diagnosis** — one query, and it is unambiguous:
  ```bash
  docker exec travel-collab-postgres-1 psql -U postgres -d travel \
    -c "select bucket, window_start, hits from rate_limit_counters order by window_start desc limit 6;"
  ```
  Observed when this was hit (2026-08-29), against a ceiling of 30:
  ```
            bucket          |      window_start      | hits
   ai-hourly:user:dev-alice | 2026-08-29 15:00:00+00 |   47
   ai-hourly:global         | 2026-08-29 15:00:00+00 |   30
  ```
- **Fix, locally:** `docker exec travel-collab-postgres-1 psql -U postgres -d travel -c "delete from rate_limit_counters;"`. Safe — it is a counter table, not planning state, and the app recreates rows on demand. It does **not** violate invariant 1: rate limiting is not the planning domain (ADR-003 scopes the event log to planning; this is operational I/O, like `sessions`).
- **The durable fix, which someone should decide deliberately.** Neither `e2e/global.setup.ts` nor `e2e/global.teardown.ts` can do it as written — both are HTTP-only by design and hold no database client, and giving the e2e hooks one is a real widening of what they may touch. The closer-grained option is to raise the ceiling for the test lane the same way `AI_LIVE=false` is already pinned, in `playwright.config.ts`'s `webServer.env`: `AI_RATE_LIMIT_PER_USER_HOURLY` and `AI_RATE_LIMIT_PER_USER_DAILY` are already env-driven (`envCeiling`), so it is two lines and no new capability. **The objection, and it is a real one:** a lane that raises the ceiling stops exercising it, and the 429 path then has no browser-level cover at all — which is how the demo-trip quota interaction in KI-79 became reasonable to miss. If the ceiling is raised, a spec that asserts the 429 on purpose should land in the same change. Recorded rather than done because it is a decision about what the e2e lane guarantees, not a cleanup.
- **Found by:** the final fix-wave implementer, 2026-08-29, mid browser-walk — after concluding from a wandering failure point that it looked environmental, then running the query above instead of stopping there.
- **Cross-reference:** KI-27 (the other "a red lane is not a defect" trap, and the reason this one is written down), KI-79 (the same quota, read as a security boundary), `docs/guidelines/ci-cost-and-capacity.md`, security review 2026-08-28 finding H1 (why the quota exists).
- **First noted:** 2026-08-29.
- **Milestone:** **M9, carried (assigned 2026-09-02)** — owned by M9, not a gate box. Mitchell's 2026-09-01 decision was that *every* open AI known issue belongs to M9; the audit that recorded it enumerated twelve entries and missed this one, so the assignment is applied here rather than left to be re-derived. Gate-vs-carried rationale is in `docs/milestones/M9-ai-planning-partner.md`, section "The AI known issues". Carried, not gating: it bites the local lane rather than production, and it is the quota working as designed against a test loop. Listed under M9 because that is where the quota work lives.
- **Fix (2026-09-04): the per-run database, not the raised ceiling.** This entry's proposed
  durable fix was to raise `AI_RATE_LIMIT_PER_USER_HOURLY`/`_DAILY` in
  `playwright.config.ts`'s `webServer.env`, and recorded a real objection to it: a lane that
  raises the ceiling stops exercising it, and the 429 path would lose its only browser-level
  cover — which is how KI-79's demo-trip quota interaction became reasonable to miss. That
  trade is not needed. `pnpm --filter web test:e2e` now runs under
  `scripts/with-test-db.mjs` (KI-2026-08-30-e), so `rate_limit_counters` starts empty every
  run. **The ceiling is unchanged at 30/hour and is still exercised**, so the 429 path keeps
  the cover the objection was protecting.
- **Why the hooks still hold no database client.** The other half of the objection —
  `global.setup.ts` and `global.teardown.ts` are HTTP-only by design, and handing them a
  database client is a real widening of what they may touch — also stands unchanged. The
  provisioning happens in a wrapper process outside Playwright entirely; neither hook was
  touched.
- **What is NOT covered, deliberately:** manual browsing against `pnpm dev`, which still uses
  the developer's own `travel` database and can still spend `dev-alice`'s hourly quota. That
  is the ceiling working as designed against a human, at a rate no test loop can reach, and
  the diagnosis query in this entry still applies to it.
