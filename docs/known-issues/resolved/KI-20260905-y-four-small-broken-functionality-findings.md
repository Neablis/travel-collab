### KI-2026-09-05-y — four small defects the lanes do not reach: a home page that fails silently, an ADR that contradicts the money code, a fabricated-looking profile name, and analytics scripts that 404 off Vercel — RESOLVED

- **Severity:** correctness / cleanup — four LOW findings; two were **downgraded** by the verifier and are recorded with what survived. Bundled; strike a line as it lands.
- **Status:** RESOLVED 2026-09-07 — all four struck. Each was reproduced first and each carries a test that was seen to fail for its own reason; see the Resolution below.
- **Area:** `apps/web/src/app/(app)/page.tsx:105-121`; `docs/architecture/ADR-008-money-representation.md:39-40,74-78` + `packages/pages/src/format.ts` + `components/lenses`; `apps/web/src/server/playbooks.ts:480-502` + `lib/displayName.ts:53`; `apps/web/src/app/layout.tsx:2-3,66-67`
- **Symptom / What happens:**
  1. **STRUCK 2026-09-07 — FIXED.** **[F-G03](../../reviews/2026-09-05-overnight-review/findings/F-G03-home-page-load-has-no-failure-path.md) — the home page's `load()` handles only 401.** A 500 body throws on `res.json()` and a fetch rejection escapes `void load()`, so `trips` stays `null` and `hasNoTrips` requires `trips !== null` — neither the first-run card nor the grid nor any error renders. Just the title row, "New trip", and an unhandled rejection in the console. This is the **third** site of the class the 2026-08-28 review named; `TripProvider.load` was fixed then and this was not. Reproducible with a Playwright `page.route` 500 stub.
  2. **STRUCK 2026-09-07 — FIXED.** **[F-G04](../../reviews/2026-09-05-overnight-review/findings/F-G04-adr-008-says-whole-yen-code-uses-hundredths.md) — ADR-008 says "whole yen for JPY"; every writer and reader treats `amountMinor` as hundredths.** No stored value is numerically wrong (consistently ×100 in, ÷100 out), so this is cleanup — and ADR-008:74-78 *already* concedes the 2-decimal display assumption, which is why the verifier downgraded it. The unrecorded part is the **cross-surface disagreement**: for `amountMinor` 123456 JPY, the notebook renders `¥1,235` and the board renders `¥1,234.56`; for 150, `¥2` vs `¥1.50`. Cheapest fix: amend the ADR to "hundredths for every currency" and pass `minimumFractionDigits: 2` in `packages/pages/src/format.ts` so both surfaces agree. Currency-aware minor units are not worth it until a non-decimal currency is a real use case.
  3. **STRUCK 2026-09-07 — FIXED.** **[F-G05](../../reviews/2026-09-05-overnight-review/findings/F-G05-profile-route-200-for-nonexistent-user.md) — `GET /api/playbooks/profile/[userId]` 200s for a nonexistent user.** **Downgraded:** that is documented anti-enumeration intent (the route requires auth; M11b spec §15 says there is no public user record), and the finding says so. Two small things are real: an ungrouped aggregate always yields one row, so the `row === undefined` ternary at `:500-502` is dead code; and `displayNameFor` mints "Traveler serxyz" from the tail of an arbitrary string, so a typo'd URL renders a plausible-looking person.
  4. **STRUCK 2026-09-07 — FIXED.** **[F-G06](../../reviews/2026-09-05-overnight-review/findings/F-G06-analytics-mount-unconditionally-off-vercel.md) — `<Analytics/>` and `<SpeedInsights/>` mount unconditionally**, so every page of a non-Vercel production run logs two 404s and two strict-MIME console errors. Harmless on Vercel; locally and in CI's `next start` it buries real errors — **34 of the review's ~70 browser-walk finding lines were this** — and it is exactly what makes adding a "no console errors" assertion to e2e impossible. Render both only when `process.env.VERCEL` is set, then consider a `pageerror` listener in `e2e/helpers.ts`.
- **Why not fixed here:** found by a read-only review; no code was changed by it. All five test lanes were green on this tree — these are what the lanes do not reach.
- **Cross-reference:** the 2026-08-28 review (item 1's class); ADR-008; resolved KI-2 (money formatting differing between UI and domain — item 2 is its unclosed remainder); `../../reviews/2026-09-05-overnight-review/README.md` §G.
- **First noted:** 2026-09-05, overnight review stream G.

---

## Resolution, 2026-09-07 — all four struck

Each finding was reproduced before it was touched, and each fix is held by a
test that was seen to fail for its own reason first (break the code, watch it go
red, restore, watch it go green).

**1. F-G03 — the home page's `load()`.** Reproduced as a component test with a
stubbed `fetch` rather than a Playwright `page.route` — the same 500-with-a-
non-JSON-body stub, one layer down, which is where the finding's own suggested
check subset put it. The stub produced exactly the described failure:
`SyntaxError: Unexpected token 'b', "boom" is not valid JSON` as an **unhandled
rejection** out of `page.tsx:114`, plus `TypeError: Failed to fetch` out of
`page.tsx:120` for the rejecting-fetch case, and a rendered DOM containing the
date line, `Your trips`, `Start from a Playbook`, `New trip` and an **empty
grid** — no alert, no cards, no first-run card.
Fixed in `apps/web/src/app/(app)/page.tsx`: `try`/`catch` around the whole read,
a `!res.ok` branch, and a `loadError` state (separate from the existing
delete/duplicate `error`) rendered as a `role="alert"` line with a **Try again**
button that re-runs `load`. 401 still, and only, means `/welcome`. Two tests in
`page.test.tsx` ("Home trip list load failures") cover the 500 body and the
rejecting fetch, including that the retry recovers and that the first-run card
does **not** appear — "your trips could not be read" and "you have no trips" are
different statements.

**2. F-G04 — ADR-008 vs the money code.** Reproduced as the finding states:
`formatMoney(123456, "JPY")` in `@tc/pages` returned `'¥1,235'` where the
board's formatter returns `'¥1,234.56'`. Fixed the cheap way it asked for —
`packages/pages/src/format.ts` now passes `minimumFractionDigits: 2`, and
ADR-008 is **amended** (the decision paragraph, the "2-decimal assumption"
consequence, and a new Amendment section recording that the code was right and
the prose was wrong, plus why currency-aware minor units were rejected).
`packages/pages/src/format.test.ts` pins the JPY output against the board's
verbatim; `apps/web/src/components/lenses/formatMoney.test.ts` already pins the
same values from the other side, and the two files name each other.

**3. F-G05 — the dead branch and the minted name.** Both halves reproduced
against a real database: the ungrouped aggregate returned
`rows.rows.length = 1`, `{adds: 0, days_shared: 0}` for a `userId` with no
`saved_days` at all (so the `row === undefined` arm is unreachable, and its two
arms produced the same author anyway), and `publicAuthor("someuserxyz")`
returned `displayName: "Traveler serxyz"` — the exact string this entry names.
Fixed in `apps/web/src/server/playbooks.ts`: the ternary is gone, and a profile
with **zero days and zero adds** is named `"A traveler"` rather than a handle
derived from whatever a stranger typed into the URL. No `users` lookup and no
404 — the anti-enumeration intent this entry protects is untouched, and everyone
the leaderboard ranks (days or adds > 0) keeps the distinct six-character suffix.
`apps/web/src/components/playbooks/ProfileScreen.tsx` now renders the name the
endpoint resolved instead of calling `displayNameFor` on the id a second time;
without that the API and the page would have disagreed, which is the same class
of defect as item 2. Held by `board/route.int.test.ts` (both directions: neutral
for a ghost id, derived handle for somebody who has shared) and one new
`ProfileScreen.test.tsx` case.

**4. F-G06 — unconditional analytics.** Reproduced by reading the layout's own
element tree with `process.env.VERCEL` unset: both `<Analytics/>` and
`<SpeedInsights/>` mounted. `apps/web/src/app/layout.tsx` now renders them only
when `process.env.VERCEL` is set, and `apps/web/src/app/layout.test.ts` (new)
pins both branches. The `pageerror` listener in `e2e/helpers.ts` this finding
says to "consider" next is deliberately **not** done here — it is a separate
change to the e2e lane, and it is now unblocked.

**Checks run** (narrow subset per the `minimal-check-subset` skill; two packages
touched, neither is `packages/contracts/src`): `pnpm --filter web typecheck`,
`pnpm --filter web lint`, `pnpm --filter @tc/pages typecheck`,
`pnpm --filter @tc/pages test` (13 files / 150 tests),
`pnpm --filter web exec vitest run -c vitest.unit.config.ts` over the six
affected unit files (82 tests), and
`pnpm --filter web exec node scripts/with-test-db.mjs vitest run src/app/api/playbooks/board/route.int.test.ts`
(10 tests). **No e2e lane was run** — `test:e2e:ci-like` is a whole-app build
plus the whole suite, which is the parallel load KI-13 is about, and the dev
lane is not a verdict (CLAUDE.md rule 1). Every behaviour changed here is
covered by a unit or integration test instead.

**Noticed and left alone:** `publicAuthor`'s docstring still says it is "shared
by the public profile AND by the shared-day route's author strip"; it has
exactly one caller today (the profile route), and `SharedDayScreen` derives its
author name client-side from `day.ownerId`.
