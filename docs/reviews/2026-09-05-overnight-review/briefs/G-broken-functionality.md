# Stream G — Broken functionality nobody has caught

Question: **What is broken right now?** You are the only stream allowed to run
the long lanes. Run them first (they take a while), then hunt in code while
they run.

Environment facts (`docs/guidelines/cloud-agent-sessions.md`): native Postgres
on **5433** (`pg_isready -h 127.0.0.1 -p 5433`); Playwright browsers under
`$PLAYWRIGHT_BROWSERS_PATH` — never run `playwright install`; the ONLY e2e
lane whose result counts is `pnpm --filter web test:e2e:ci-like`. Before you
call any failure environmental or flaky, `grep -rli "<symptom>" docs/known-issues/`
(CLAUDE.md rule 2); a failure that moves between runs is a timeout, a real
defect fails in the same place every time.

Run, in this order, each in the background with output to
`/tmp/claude-0/-home-user-travel-collab/d3e85921-e7ac-5677-9cb7-8fe309934f71/scratchpad/G-<lane>.log`:
1. `pnpm typecheck`
2. `pnpm lint`
3. `pnpm test` (unit, all packages)
4. `pnpm test:int` (needs the 5433 database; check `DATABASE_URL` in `apps/web/.env.local`)
5. `pnpm seed:verify`
6. `pnpm --filter web test:e2e:ci-like` — this builds first; budget 15–25 min
7. `node apps/web/node_modules/drizzle-kit/bin.cjs check` from `apps/web` if it runs without a DB, else skip and say so

Report every red with: the exact failing assertion text, the file:line under
test, whether it is stable across two runs, and the KI if one exists.

While lanes run, hunt where tests do not reach. Use `docs/testing-inventory.md`
and `docs/testing-baseline.md` to see what is covered, then read:
- Routes with no `*.int.test.ts` or `*.test.ts` beside them under `apps/web/src/app/api/**` — list them, then read each for: unhandled promise, missing `await`, wrong status code, parse of `params` under Next 16 (async `params` — grep for `params.` used without `await`), `NextResponse.json` of a Zod error leaking internals.
- `apps/web/src/components/**` for: `useEffect` with a missing dependency that matters, stale closures over the send queue, `key` collisions in lists (activities keyed by index?), date handling mixing local and UTC (the 2026-08-28 review's 1.8; grep `new Date(` in UI and check every one for a `T00:00` / timezone assumption), money formatting of negative/zero (ADR-008).
- `packages/domain` reducers: every `switch` on event kind has an exhaustive default that throws or is `never`-checked? Any reducer that mutates its input?
- `packages/pages` resolvers: empty trip, trip with no dates, a day with zero stops, a deleted day still referenced by a widget bind, a filter with an id that no longer exists — what renders? Read `select.ts` and `filters.ts` for each edge.
- Mobile: `m14-mobile-notebook.spec.ts` / `m16-mobile-assistant.spec.ts` exist; `responsive.spec.ts` — what breakpoints are asserted vs what KI-046 says is broken below 1100px.
- `apps/web/src/app/(app)/page.tsx` (495 lines): the home page — every branch reachable? Empty states for a brand-new account with zero trips, zero saved days, no name?
- Accessibility smoke: any `<button>` without text, `onClick` on a `div`, missing `aria-label` on icon buttons (a grep gives a count; sample five).

If e2e is green, also try the **manual walk** with `pnpm --filter web walk:preview`
against a local `next start` (the script may accept a localhost URL — read its
header) for the notebook page, invite accept, share view, playbooks, so
console errors are captured.

Report the lane table first (lane · result · duration · red count · KIs
matched), then findings.
