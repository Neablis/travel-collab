# KI sweep, overnight 2026-09-25 — triage and the decisions taken without asking

Mitchell's brief: *"Take on a larger KI cleanup over night, don't ask for
decision, document decisions, and I'll review the pr and the decisions made in
the morning."* This file is that record. Every choice made on his behalf is
listed under **Decisions to review**, with the alternative that was rejected,
so any one of them can be reversed on its own.

Starting point: `main` at `cdb3582`, **84** entries in `docs/known-issues/open/`.

## How the sweep was run

- `/ki-sweep`, with its two approval stops (step 3 plan, step 6 landing shape)
  answered by the brief rather than by asking.
- One `ki-fixer` subagent per KI, each in its own worktree, **four at a time**
  (the box has 4 cores; KI-13's history is component tests timing out under
  exactly this kind of parallel load, so the batch never exceeded the core
  count).
- Each fixer fast-forwarded its worktree to this branch's head first — agent
  worktrees are seeded from a stale local `main` (KI-2026-08-30-c), and moving
  local `main` was not permitted in this session.
- Landing: **one branch, one PR** (`/ki-sweep` step 6b), because every fix here
  is small and the point of the morning is one review pass. Each fix is its own
  commit(s) with the KI id in the subject, so any one can be reverted alone.

## Scope: every one of the 84 entries is either fixed or re-validated

Mitchell, mid-sweep: *"make sure you are taking on a pretty big chunk of the
ki … whether that means fix or validate it's no longer true."* So the sweep
has two halves:

- **Fix** (~30 entries): buckets D and B below, plus KI-3 / KI-48 item by item.
- **Validate** (the other ~54, including the milestone-owned ones): a
  first-hand check of every claim against today's code. Each ends as
  **closed** (no longer true — evidence in the entry), **narrowed** (struck in
  place), or **re-verified 2026-09-25** (still true — evidence, stale line
  numbers and counts corrected). Validation never fixes; a still-true entry
  with a small, obvious fix becomes a fixer candidate for a later wave, unless
  a milestone owns it.

## Triage

### A — owned by a milestone; not touched

The 2026-09-24 KI pass assigned these to a milestone, each with a
`Milestone:` line. Clearing them here would be doing that milestone's scope
out of order (TODO.md: M24 → M14 → M19, M9 paused).

- **M9 (paused), every open AI entry:** KI-9, KI-10, KI-15, KI-24, KI-79,
  KI-80, KI-82, KI-2026-09-05-ad, 09-08-c, 09-12-f, 09-14-b,
  09-16-a (truncated tool input), 09-17-b, 09-17-c, 09-20-a.
- **M24 (current):** KI-2026-08-30-g.
- **M14 (next):** KI-2026-09-20-g, 09-20-h, 09-22-c, 09-22-d, 09-24-d,
  09-24-h, 09-24-n, 09-24-o, 09-24-p, 09-24-q, 09-24-s.
  Two M14-carried entries **were** taken — see Decisions.

### B — touch `packages/contracts/src`; serialized after the parallel waves

Run one at a time, each followed by a full `pnpm check` (AGENTS.md invariant 5).
Listed with their outcome under *Results*.

### C — not closable by a worktree agent, or unbounded; left

| Entry | Why left |
|---|---|
| KI-2026-08-30-c, 09-12-b | Harness worktree behaviour, not repo code. |
| KI-2026-09-05-n | Dependabot triage needs GitHub Security access. |
| KI-2026-09-16-d | Vercel Preview environment config. |
| KI-2026-09-23-a | Next.js's own vendored proxy; nothing in this repo to change. |
| KI-2026-09-01, 09-07-d | Process records, not defects with an end state. |
| KI-2026-09-06-d, 09-20-d, 08-30-f | Need live web research / geocoder egress to verify content. |
| KI-2026-09-24-o | A privacy disclosure — the entry says the wording is Mitchell's. |
| KI-3, KI-48 | Area is "`apps/web/src` (various)" — conflicts with everything in flight. |
| KI-46, 09-24-i, 09-24-j | Phone/tablet layout — the entries themselves say "a milestone, not a fix". |
| KI-2026-09-20-f, 09-23-c, 09-23-b | Architecture moves across dozens of files; would conflict with every other fix and deserve their own review. |
| KI-2026-09-20-i, 09-22-a, 09-02-b, 09-05-v | Repo-wide comment/lint backlogs (hundreds of sites). |
| KI-2026-09-05-j | Event upcaster — a design, not a fix. |
| KI-2026-09-02-d | The entry's own fix path is "opportunistic, not a project"; it has no end state to close. |
| KI-52 | A recorded design delta, deliberately kept. |
| KI-2026-09-15-a, 09-16-a (refund) | Cross-module data / a new cash ledger — design work, not cleanup. |
| KI-2026-09-19-f | Mitchell chose "option A" knowing the window; option B is a contract change he did not ask for. |

### D — parallel waves (Area fields pairwise disjoint within a wave)

| Wave | Entries | File scopes |
|---|---|---|
| 1 | 08-30-d · 09-24-u · 09-16-b · 09-24-a | `scripts/` + `.claude/` · `test-support/networkGuard*` · `server/entitlements/accountPlan.ts` + `components/account/` · `server/public-api/` |

(Later waves are appended as they are dispatched.)

## Results

| Entry | Outcome | Proof |
|---|---|---|
| KI-2026-08-30-d | RESOLVED | `check-ki-filenames.mjs` now fails on an entry in two status dirs; reproduced with three copied entries (two passed the old wall, one was misreported as a shared id); two new tests seen red; 10/10 green. |
| KI-2026-09-24-a | RESOLVED | `route()` gains `trip: { body }`; confined token + own trip → 201 on `/v1/library` and `/v1/playbooks`, other trip / no trip → 403. Red first (`expected 403 to be 201`); both guards broken and seen red; 81/81 int across six public-api files. |
| KI-2026-09-16-b (account grants) | RESOLVED | `AccountPlanView.grants` + a `plan-grants` row: *"Granted to you: premium v1 (admin, permanent) and plus v1 (founder, until December 1)."* Reproduced (card named no grant); four breaks seen red; 263 unit + 1 int green. |
| KI-2026-09-19-c | RESOLVED | `PublicAuthor.daysShared` → `playbooksShared` (+ SQL alias, `publishedPlaybookCount`); not on `/v1` or in contracts (checked first). New int test: a three-day Playbook counts one; old key seen red (ZodError + TS2353); 69 unit + 62 int green. |
| KI-2026-09-24-u | RESOLVED | guard now patches `net.Socket#connect`, so `http`/`https`, jsdom XHR and WebSocket to a non-local host are refused; MSW-handled requests still answered. Reproduced (`http.get` reached a stub); 6 cases seen red; **whole** unit lane (3984) and int lane (1050) green, no test anywhere tripped the guard. |
| KI-2026-09-24-k | RESOLVED | Calendar month header gains a control naming the hidden weekdays (`Fri–Sat ›`) plus an edge fade; clicking scrolls them in. Measured before/after at 820/1024/1280. New e2e in `responsive.spec.ts`, seen red (`Expected: 1 Received: 0`), green under `test:e2e:ci-like`. |
| KI-2026-09-05-q | NARROWED | new `server/readBody.ts`; the five bare-`request.json()` routes answer 400 on malformed JSON (all five reproduced with `SyntaxError`, seen red again with the catch removed; 273 int green). Item 2 was already done upstream (`capRawBody`). New **fetch wall** (`no-restricted-globals` on `fetch` in UI code) with a `check-lint-wall` self-test. Left open: collapsing the three clients onto one core and the 14 raw app-API fetches now tagged with this KI. |
| KI-2026-09-24-c | RESOLVED | app keep (`POST /api/saved-days`) strips `dateRange` anchors via `saveDay({ dateAnchors: "strip" })`; Keep dialog warns before the keep. Reproduced (anchor survived); int + unit seen red; 57 unit + 121 int green. |
| KI-2026-09-24-m | RESOLVED | chip `<button>` is the 44px target below `md` (`min-h-11 -my-3`), inner span keeps the 20px look; card height unchanged (118px). The floor check never saw chips (no tags in its trip, measured before cards rendered) — fixed, seen red (`"… is 20px"`), green under a production build. |
| KI-2026-09-24-x | RESOLVED | settings panel shows only the selected widget (`selectedWidget(state)` from the existing `NodeSelection`); number marks and `widgetMarkPlugin` deleted. 4 new component tests red first; two deliberate breaks seen red; 311 unit, 29/29 `m14-notebook-widgets` under `test:e2e:ci-like`. |
| KI-2026-09-22-b | RESOLVED — **needs a Windows-mouse look on the preview** | a sticky stand-in scrollbar under the day-columns row (synced both ways, sits above the Unscheduled rack). Reproduced at 1920×919 (row bottom 1218 > 919); two breaks seen red; `m10-growth` + `m1-board` 9/9 under `test:e2e:ci-like`. |
| KI-2026-09-23-d | RESOLVED | ADR-047 amended (dated): Billing may read the plan **catalog** (`planVersions.ts`) and nothing else of Entitlements; `revenue.ts` now takes trailing costs as an argument (the ledger import reversed). Six known violations → `[]`; re-adding either import turns `pnpm arch` red; 150 unit + 108 int green. |
| KI-2026-09-20-e | RESOLVED — **route walk on a preview still owed** | the last three bare `Loading…` strings gone (PageScreen renders nothing; Plans order card and token picker keep their chrome, no body); new AST **loading wall** in `pnpm lint` with a self-test. Three component tests red first; wall red on the pre-fix tree (3 sites); 334 unit green. |
| KI-2026-09-24-t | RESOLVED | `PageScreen.test.tsx` gives each test its own page id and fronts every handler set with a guard that answers 410 to another test's page. Deterministic reproducing pair (no timers) kept as the regression; both halves of the fix broken and seen red; 316 unit green ×3. Merge with KI-2026-09-20-e's test at the same file end resolved by keeping both (57/57). |
| KI-2026-09-24-l | RESOLVED | `PhoneTabBar` marks Map on Map, Plan on Plan, and **nothing** on Overview/Calendar/unknown (it used to light Plan for everything not Map). New test red first (`expected 'Plan' to be null`); three old rows that asserted the bug corrected; 30/30. The phone Overview layout half split out as **KI-2026-09-25-f**. |
| KI-2026-09-24-v | RESOLVED — **it did phone home** | `@sentry/bundler-plugin-core` telemetry defaults on and posted to `o1.ingest.sentry.io` during every build, **bypassing `HTTPS_PROXY`** (seen only under `strace`). `telemetry: false` in `next.config.ts`; A/B builds show the two connects gone; config unit test red first (`expected undefined to be false`). |
| KI-2026-09-25-a (filed tonight) | RESOLVED | `DiscoverResponse.sharedDayCount` → `sharedPlaybookCount`, still a count; not on `/v1`. New int test (a three-day Playbook adds 1) red against the old key; 218 unit + 74 int green. |
| KI-2026-09-13-a | RESOLVED | TripHeader publishes `--sticky-stack-height` (ResizeObserver); day-sync targets get `scroll-margin-top` **and** `jumpTo` finishes with a window scroll — the margin alone fails because the columns row (an inner scroller) clips it. Reproduced at two depths (60.7 / 22.7 < 244); both red with the finish removed; `m10-growth` 7/7 under ci-like; `/demo` and 411px probed. |
| *regression caught in-sweep* | FIXED | KI-2026-09-22-b's `day-columns-scrollbar` test id matched `m26-phone-plan`'s `/^day-column/` (3 → 4 columns). Renamed `board-columns-scrollbar`; `m26-phone-plan` + `m10-growth` 12/12 under ci-like. |
| KI-2026-09-05-m | NARROWED to "wire the hook" | setup-env order was already fixed (#218) — pinned with a test, seen red on the pre-#218 script. `minimumReleaseAge: 1440` set explicitly, three stale exclusions dropped. `scripts/hooks/check-test-lane.mjs` built + 7 tests; **not wired** into `.claude/settings.json`. |
| KI-5 | NARROWED | queued-but-unsent commands are flushed on `pagehide` and on TripProvider unmount as **one keepalive batch** through `/commands/batch` (48 KiB budget). Reproduced with the entry's method (`Expected 4 / Received 1` after reload), green after; new `m6-unload-flush.spec.ts` + `m6-optimistic` 4/4 under ci-like; 10 new unit tests, each guard broken and seen red. Still open: two races with the in-flight command (needs a per-command idempotency key), >48 KiB tail, a background-killed mobile tab. |
| KI-3 | **CLOSED (DOWNGRADED)** | last bullet (`text-danger-ink` as a raw utility) is the repo's convention: a walled design token, specified that way in `design-system.md`, and `Text` has no tone variants at all. |
| KI-48 | NARROWED | 3 of 6 items gone with redesigns (struck with evidence); the account menu's blank email line fixed (test red first). Left: the day-chip row's scroll affordance (needs a design), the settings date editor as a popover (inline is settled but needs an e2e-proven restructure). |
| KI-2026-09-14-e | RESOLVED | `queryCache.writesSettled(prefix)` + TripProvider re-reads once on mount when a write to the trip was outstanding at mount (the previous board's in-flight head or KI-5's flush). Reproduced (`Expected "d1,d-a,d-b" / Received "d1"`); three breaks seen red; 172 unit green. |
| KI-2026-09-25-e (filed tonight) | RESOLVED | `scripts/arch-baseline.mjs` keeps only error-severity violations; `arch:baseline` wired to it. Reproduced: old command wrote 9 warn cycles (they still printed only because dep-cruiser 18.4 ignores folder-level baseline entries — a `TODO` upstream). Test red with the filter removed. |
| KI-2026-09-25-d (filed tonight) | RESOLVED | `entitlements/grants.ts` `activeGrantHolders(now)`; `admin.ts` passes holders into `underwaterReport`; Billing no longer names the grant table. New `storeBoundary.test.ts` source sweep (grants **and** the AI ledger) red first; behaviour break seen red in `revenue.int`; 151 unit + 108 int green. |
| KI-2026-09-25-c (filed tonight) | RESOLVED | row registered for pdnd element auto-scroll **and** web's pdnd core bumped `^2.0.2` → `^3.1.0` — two cores were installed, so auto-scroll (window auto-scroll included) never saw a drag. Each half alone seen red (`Received: 0`); `m1-board` 4/4 under ci-like; five other drag specs 9/9 on the same build. |
| KI-2026-09-25-g (filed tonight) | RESOLVED | new `scripts/check-singletons.mjs` in `pnpm lint`: one version each of the pdnd core, `react`, `react-dom`. Exits 1 on the pre-fix lockfile (`2.0.2, 3.1.0` — two copies since at least 2026-09-14); three tests, two mutations seen red. Stale "window auto-scroll works" comments corrected. |
| KI-2026-09-14-d | RESOLVED | per-process memo in `searchCities` (30 s TTL, 500 entries, failures evicted) cleared on every in-process publish/unpublish/hide/restore; client untouched, so all four search states stay reachable. Reproduced (`execute` called 2×); four breaks seen red; 68 int green; `m11b-playbooks` 4/4 under ci-like. |
| KI-2026-09-05-w | RESOLVED (9/9) | one commit per item: `planningTools.ts` pass-through deleted; `commands.ts`'s two executors share `loadAndAuthorize`/`appendAndProject` (11 int files, 201/201; `origin` break seen red); `check-sleep-wall.mjs` replaced by a `check-lint-wall` fixture for `playwright/no-wait-for-timeout`; dead `checkAdmission` and `AccountMenuFromSession` deleted; `usageOf`/`modelIdOf`/`Queryable` deduplicated; item 1 already done; item 9 stays by decision. Merge conflict in root `lint` script resolved keeping tonight's new walls and dropping the sleep wall. |
| *CI fix* — KI-5 flush race #1 | FIXED (KI-5 stays open) | `executeTripCommandBatch` retries the whole transaction (≤3) when a batch **without** `expectedSeq` loses the `events_stream_seq` race; batches with a precondition still refuse. Int test holds a competing transaction open (`pg_blocking_pids`) — red (`concurrency-conflict`), green after; CI's `Received: 1` reproduced locally with an injected delay and gone with the retry; whole int lane 1062/1062. |
| KI-2026-09-05-f | RESOLVED (5/5, contracts) | notebook writes capped at 512 KiB raw body (session routes 413, v1 routes their named-limit 400) and titles at 200 on the **input** schemas only (stored pages still load/replay — contract test); Sentry wizard route + page deleted (ADR-032 amended); session cookie `SameSite` pinned by a test that reads Auth.js's real `Set-Cookie` (red with `sameSite: "none"`); a removed member's spent invite now answers "already used" (both accept paths, int test red first). Fixer ran `pnpm check` (4,011 unit) + whole int lane (1,069) on its base. |
| KI-2026-09-24-e | RESOLVED (contracts, **no migration**) | `TripSummary.endDate` (`.default(null)`), read at list time from the stored trip document's last day; Home ranks an "under way" trip first. Two ordering tests red first; the int case red with the SQL nulled; contract test red without the pattern. Full `pnpm check` (4,014 unit + 1,068 int) green on its base. |
| *review finding* scrollbar echo | NOT REPRODUCIBLE | per-frame logging shows row and bar update in the same frame in Chromium; the counter is kept (it stops a smooth day-jump being cancelled — its comment gave the wrong reason and is corrected); new e2e pins "never back a frame", red with an injected one-frame delay. |
| *review findings* 1, 2, 8 (KI-5 follow-ups) | FIXED | in-app navigation now drains queued edits one unit at a time after the in-flight head (each its own history entry; one refusal drops none of the others); unload sizing is linear. New e2e in `m6-unload-flush.spec.ts`. |
| *review findings* A–E | FIXED | (A) old wire keys `daysShared`/`sharedDayCount` re-emitted server-side for one release (`playbookWireAliases.ts`, marked for removal after the next deploy); (B) `no-restricted-properties` on `waitForTimeout` for any receiver in `e2e/**` + lint-wall fixture; (C) socket guard allows the `DATABASE_URL` host and all of 127/8; (D) `adminOverview` reads the cost ledger and grant holders once (spy test: 6 reads → 1); (E) one shared `isDroppedFromPlaybook` predicate. Each red first; correction lines added to 09-19-c, 09-25-a, 09-05-w, 09-25-d, 09-24-c. |
| KI-2026-09-19-b + KI-2026-09-19-f | RESOLVED (no contract change) | new `executeTripCreation` in `commands.ts`: `CreateTrip` and the follow-up batch (an import, or the dates) in **one** transaction, two appends; any failure after genesis rolls back everything. `POST /v1/trips/import` and dated `POST /v1/trips` lose their compensating `DeleteTrip`. Reproduced (empty trip survived when compensation also failed); two old shapes rebuilt and seen red; 214 int green. |
| KI-2026-09-25-h (filed + fixed tonight) | RESOLVED | trip copy (`cloneTrip.ts` `cloneFrom`: duplicate, shared-link clone, demo copy) now goes through `executeTripCreation` — one transaction, compensating deletes gone. Reproduced (an empty copy's stream survived when the cleanup also failed); 58 int green across every caller. |
| KI-2026-09-23-i | RESOLVED (contracts, no migration) | new `SavedDayModeration` on the **author's** read of `GET /api/saved-days/:id` (not on `SavedDay`); `SharedDayScreen` shows the author a banner with the operator's note. Reproduced (author read carried nothing); route, screen, client and contract tests each seen red; full `pnpm check` green on its base (4,024 unit + 1,069 int). |

## Validation results

| Entry | Verdict | Evidence (short; full line in the entry) |
|---|---|---|
| KI-2026-09-20-g | NARROWED, and wider | Radius item struck (only Ledger theme left, `--radius-md: 0`); hand-rolled containers now **seven**, not four (Weather, CountryFacts, SpendByDay added). |
| KI-2026-09-20-h | NARROWED | `cost` takes five filters (person retired); the rest holds. |
| KI-2026-09-22-c | STILL TRUE | undo still skips page events; no marker for a backfilled genesis. |
| KI-2026-09-22-d | NARROWED | silent overwrite struck (`expectedUpdatedAt` + conflict UI); live update still absent. |
| KI-2026-09-24-d | STILL TRUE | no repair scan; `findWidgetError` refuses, not strips. |
| KI-2026-09-24-h | STILL TRUE | `ProposalCard.tsx:64`; Area path corrected to `packages/domain`. |
| KI-2026-09-24-n | NARROWED (count) | 57 of 244 countries have no numbers, not ~45. |
| KI-2026-09-24-o | STILL TRUE | no privacy/legal route exists. |
| KI-2026-09-24-p | STILL TRUE | three unchecked sums; new detail: `block.ts:88` vs `rows.ts:274` format in different currencies. |
| KI-2026-09-24-q | STILL TRUE | `person` absent from every filter list; `isRetired` drops it. |
| KI-2026-09-24-s | STILL TRUE | `useEditSession.ts:131` overtaking save sends no revision. |
| KI-2026-08-30-c | STILL TRUE | this sweep's own worktrees were seeded at `origin/main`, local `main` two commits stale; agent defs have no base check. |
| KI-2026-09-12-b | STILL TRUE | worktree had no `node_modules`; hook did not run. |
| KI-2026-09-05-n | NARROWED | drizzle-kit and `@types/node` skews struck (fixed upstream); next-auth caret, eslint-config-next@15 under next@16 remain. |
| KI-2026-09-16-d | STILL TRUE (code side) | `requireAdmin.ts:20-25`; Preview env not checkable here. |
| KI-2026-09-23-a | STILL TRUE (static) | next 16.3.3, vendored proxy unchanged. |
| KI-2026-09-01 | STILL TRUE | PR #228: CodeRabbit `success` with "Review skipped". Stale `.coderabbit.yaml` comment fixed on this branch. |
| KI-2026-09-07-d | NARROWED | draft-PR guard (#199) struck; the rest holds. `/ki-sweep` 6a now says *draft*. |
| KI-2026-09-20-i | **CLOSED** | decision implemented (#203: `.coderabbit.yaml`, `commenting.md`, docstring wall); backlog lives in 09-22-a. |
| KI-2026-09-22-a | STILL TRUE | 65.5% documented (was 52.6%), 435 grandfathered (was 470). |
| KI-2026-09-02-b | NARROWED | 165 directive lines (was 169); "can only shrink" struck — `DiscoverScreen.test.tsx` added 24 new ones on 2026-09-14. |
| KI-2026-09-05-v | STILL TRUE | 131 disables (was 128), 80 `style={{` (was 75). |
| KI-046 | **CLOSED** | every remaining claim contradicted by code (meta row hidden on phone, one-day board #196, 44px floor, stop editor stacks); residue owned by 09-24-i/j/k/l/m. |
| KI-2026-09-02-d | NARROWED | scenarios now have 8 consumers (`threeDayTrip`, `emptyTrip`); four scenarios still unused. |
| KI-2026-09-06-d | STILL TRUE | 8 bundles, 415 price fields still `origin: "ai"`. |
| KI-2026-09-20-d | STILL TRUE (counts) | fixtures 3/45 located; bundles now 146/148 days draw a map. |
| KI-2026-08-30-f | STILL TRUE | LocationIQ only; 8 venues still in `coordinateGaps.ts`. |
| KI-2026-09-24-i, -j | STILL TRUE (structure) | sticky header unchanged; `md:min-h-0` still drops the floor at 768px. |
| KI-2026-09-20-f | STILL TRUE | 17 route pages, all client-fetched; new constraint: lint forbids pages importing `@/server/*`. |
| KI-2026-09-23-c, -b | STILL TRUE | `pnpm arch` 7 cycle warnings; server root now 38 files (was 27). |
| KI-2026-09-05-j | STILL TRUE | `rebuildProjections` still test-only; no upcaster, no operator rebuild. |
| KI-52 | STILL TRUE | 4 tags vs 6. |
| KI-2026-09-15-a | STILL TRUE | `PlansScreen.tsx:773`. |
| KI-2026-09-16-a (refund) | STILL TRUE | `charge.refunded` not handled; no ledger. |
| KI-2026-09-19-f | STILL TRUE at validation → **fixed later the same night** with KI-2026-09-19-b | two `runCommand`s at `v1/trips/route.ts:99,102`, now one transaction. |
| KI-2026-09-02-c | STILL TRUE | no ESLint under `packages/`. |
| KI-009 | NARROWED | classifier half struck (`Output.object` since cccbac8); final answer still unschema'd. |
| KI-010 | STILL TRUE | `orderIntents` still fronts only `AddDay`. |
| KI-015 | NARROWED | `placeNameVerdict` now has a request-path caller (`savedDayPins.ts:195`); `resolveOne` still accepts on distance alone — now the same residue as KI-2026-09-20-a. |
| KI-024 | STILL TRUE | `AI_LIVE` still overrides the flag. |
| KI-079 | NARROWED | `allowDemo` is now opt-in, so the `/ask` refusal is a second barrier, not the only one. A code comment at `admission.ts:617-630` still says otherwise (left: M9 code, and another fixer was in that file). |
| KI-080, KI-082 | STILL TRUE | 12 cases each, no default; zero cost still stripped. |
| KI-2026-09-05-ad, 09-08-c, 09-12-f, 09-14-b, 09-16-a (truncated), 09-17-c | STILL TRUE | line numbers and moved paths corrected. |
| KI-2026-09-17-b | STILL TRUE | two more unpaced callers recorded (`/api/geocode`, v1 geocode). |
| KI-2026-09-20-a | NARROWED | no longer "wired to nothing"; unwired only in `resolveOne`. M9's parked row updated. |
| KI-2026-08-30-g (M24) | NARROWED | Timeline `Leg` gone; `kind` now read by the map rail and invite landing; Calendar still ignores it. |

## Decisions to review

- **KI-2026-08-30-d closed, not narrowed**, though the wall cannot catch the loud form (add/add conflicts after a squashed base, 2026-09-11) — git reports that one itself, and `/ki-sweep` 6b now points at the recovery recipe. Rejected: keeping it open for that form.
- **KI-2026-08-30-d: extended `check-ki-filenames.mjs`** instead of adding a new `check-ki-duplicates.mjs`, matching by basename not id (the allowlists hide the id form). Rejected: a second walk of the same directories.
- **KI-2026-09-24-a: option (a)** — confined tokens may write the library from the trip they name, via a declarative `trip: { body: fn }` on `route()`. Rejected: (b) documenting that confined tokens cannot write the library. A function, not `trip: "body"`, because a Playbook's trip is nested and optional (`source.tripId`).
- **KI-2026-09-24-a side effect:** on `POST /v1/playbooks` a 403/404 about the source trip now happens *before* the `Idempotency-Key` is reserved (as on every trip-in-URL route), so that refusal is no longer stored and replayed. ADR-050's Consequences bullet got a dated *Superseded* note rather than a rewrite.
- **KI-2026-09-16-b wording:** `Granted to you: <plan> v<n> (<source>, <term>)`; source words are the operator console's (`admin`, `founder`, `referral`), except `trial` → `free week` to match the badge; term `permanent` or `until <date>`; the free week's date is dropped when the trial-ends line already shows it. Separate row under `plan-held`, absent when there are no grants. Rejected: softer customer words ("comped by us", "founding member") — the console and the sheet would name one grant two ways.
- **Found, left:** `plan-held` reads *"You bought free v1"* for an account that bought nothing (from #195). Worth a small follow-up.
- **KI-046 closed by validation** although the entry asked to wait for a real-phone walk: every claim it still made is contradicted by the code, and each remaining phone/tablet symptom has its own narrower entry (09-24-i/j/k/l/m). Rejected: keeping a broad umbrella entry open beside five specific ones.
- **KI-2026-09-19-c renamed in one step** (app is the only consumer, same deploy). Rejected: emitting both keys for a transition. Discover's `sharedDayCount` had the same misnomer — filed as **KI-2026-09-25-a** and fixed later the same night (`sharedPlaybookCount`).
- **KI-2026-09-24-u: guard at `net.Socket#connect`**, one layer under every transport. Rejected: wrapping `http.request` (MSW's interceptor calls through it for handled requests too — would refuse what MSW answers) and wrapping XHR/WebSocket globals one by one. Refusals also go to `console.error` because XHR/WebSocket swallow the reason. Still uncovered, documented: worker threads / child processes (jsdom's *sync* XHR).
- **KI-2026-09-24-k: scroll affordance** (fade + a header button naming the hidden days), not narrower columns (would drop below the measured 144px minimum and truncate every cell) and not week paging (SPEC §4: "No month paging"; paging a week breaks its shape). Rejected also: a fade alone (gives a mouse user no way sideways).
- **KI-2026-09-05-q:** `readBody` reuses each route's existing 400 message (no client-visible string changes); the 11 routes already using `.catch(() => null)` were left as they are (no bug behind them). The 14 raw app-API fetches got line-level disables naming the KI rather than 14 new hand-mirrored wrappers — `grep -rn KI-2026-09-05-q apps/web/src/components` is the remaining work list. `no-restricted-globals`, not `no-restricted-syntax`: a second `no-restricted-syntax` block would silently replace the element wall's options in flat config.
- **KI-2026-09-24-c: warn *before* the keep** in the dialog (*"A Playbook has no dates, so the date anchor on "X" won't be kept."*) rather than returning warnings after — the dialog closes into the pennant animation, so there is nowhere to show a post-keep warning. `saveDay` defaults to `"keep"` so `/v1/library` is unchanged; that remaining disagreement is filed as **KI-2026-09-25-b**.
- **KI-2026-09-24-m:** real 44px button with an unchanged 20px visual, phone only. Rejected: exempting chips in the floor check (hides it), a 44px visible chip (density), a `::before` hit area (the floor check measures boxes and could not see it), `PHONE_TOUCH` (its `min-w-11` widens into the neighbour chip).
- **Seen during the sweep, not investigated to a cause:** one accidental full e2e run (under 5-agent load) failed `m11b-playbooks.spec.ts:154` twice, in two different places (heading timeout, then `ECONNRESET`), and flaked `m14-notebook-widgets.spec.ts:747`. A moving location is a timeout signature (CLAUDE.md rule 2); CI on this PR is the verdict.
- **KI-2026-09-24-x (M14-carried) taken** on Mitchell's own words on #221, *"Just have 1 selected at a time."* Removing the selected widget now **closes** the panel rather than moving selection to a sibling (with one entry that reopened the panel instantly and looked like Remove failed). Rejected: a highlighted whole-sentence list; keeping handle numbers. `.design-sync/handoff/SPEC.md` §26 still says "numbered to match the marks" — left for a design sync (build input, not prose).
- **KI-2026-09-22-b: sticky stand-in scrollbar**, not capping the row to the viewport (every vertical wheel would scroll the row, drag auto-scroll only scrolls the window, and the height above the row varies). Rejected also: hover arrows (new chrome, a design call), wheel-to-sideways (hijacks the page's main scroll). Limit: macOS/overlay scrollbars hide it like any scrollbar — trackpad users swipe. Nobody has looked at it on Windows yet, where it was reported. Found alongside: drag doesn't auto-scroll the row sideways — filed **KI-2026-09-25-c**.
- **KI-2026-09-23-d: amend ADR-047 (option 2)** rather than move the catalog to a neutral `server/plans/` (option 1 — rewrites `AGENTS.md`'s module map and ADR-045 rule 1 overnight, ~50 importers, touches a contracts comment → full check) or move `admin.ts` (option 3 — removes no cycle). **Consequence:** the billing↔entitlements *folder* cycle is now a permanent, ADR-sanctioned warn in `KNOWN_CYCLE_CLUSTERS`, a new kind of entry; the file-level rule keeps it from growing. Option 1 is the route to a cycle-free graph if you want one. Found alongside: **KI-2026-09-25-d** (revenue reads `entitlement_grants` via the schema module) and **KI-2026-09-25-e** (`arch:baseline` wrote the warn-level cycles into the baseline — inert today only because dependency-cruiser 18.4 does not yet honour folder-level baseline entries; fixed the same night).
- **KI-2026-09-20-e: "chrome or nothing"** — your trip-board call (*"dont even have the loading state. KEep it simple."*) applied to the rest; no skeletons, no timers (overrides the entry's 2026-09-24 note about shaped placeholders — that trade belongs to KI-2026-09-20-f). PageScreen renders `null` rather than its chrome, because every button in that chrome acts on a page that is not loaded yet. The wall's pattern is wider than the entry's regex (catches `Loading your trips…`), with no allowlist.
- **KI-2026-09-24-t (M14-carried, test-only) taken.** Per-test id + refusing guard (makes the leak impossible). Rejected: draining in `afterEach` (several tests hold a PATCH open forever, so it needs a timeout — only "unlikely"); changing `pageFixture`'s default id in `@tc/factories` (other code keys on it).
- **KI-2026-09-24-l: keep Overview as the landing view and stop the tab bar lying** (SPEC §24: "Entering a trip lands on Overview", no phone exception; §10 names no phone default). Rejected: Plan-by-default on phones only (one URL showing different views by width), marking Notebook current on Overview (it links to a different screen), keeping Plan as catch-all (the bug). The SSR fallback now marks nothing instead of guessing — a `?view=Plan` deep link shows no tab lit for one paint.
- **KI-2026-09-24-v: telemetry off on every build, deploys included** (the data is Sentry's about their plugin, and tags builds with our org slug). Rejected: gating on `VERCEL`/token (an env branch for nothing), extra `sourcemaps.disable`/`release.create: false` (already no-ops without a token — no Sentry API host was contacted). Worth knowing: a proxy-only egress probe cannot see this class of traffic.
- **KI-2026-09-13-a:** measure only TripHeader (its computed `top` already covers AppHeader or its absence on `/demo`), and finish `jumpTo` with an upward-only window scroll. Rejected: stopping the columns row being a scroll container (impossible while it scrolls sideways), a two-step jump (splits the lock-guarded jump). Six stale "open bug" comments in `components/assistant/` updated.
- **KI-2026-09-05-m — ⚠ supply-chain policy change, please look:** pnpm 11 already defaults `minimumReleaseAge` to 1440 in *loose* mode (so the block was not inert — the finding was written against pnpm 10.28), and loose mode silently appended exclusions (three stale ones). Now set **explicitly (strict)** with the exclusions dropped. Consequence: a Dependabot bump or `pnpm add x@latest` for a version younger than a day fails to resolve until it ages, or until you add `name@version` to `minimumReleaseAgeExclude`. Frozen installs verified unaffected. Unverified: Vercel's pnpm version. Rejected: deleting the block (pnpm stays loose and keeps adding entries).
- **KI-2026-09-05-m — the test-lane hook is built but deliberately not wired**, because it changes agent config. To wire it, add `{"type":"command","command":"node scripts/hooks/check-test-lane.mjs"}` to the existing PreToolUse `Bash` hooks in `.claude/settings.json`, then move the entry to `resolved/`. It denies (not asks) with an `E2E_DEV_LANE=1` override for iterating, so unattended agents don't stall.
- **KI-5: flush only never-sent commands, as one keepalive batch** — no `beforeunload`, nothing delays leaving (your 2026-07-20 direction). Rejected: including the in-flight command (no idempotency key → could double-apply), one request per command (a dying page's requests race → out of order), an `expectedSeq` precondition (the client can't know the in-flight command's event count), flushing a KI-36-failed queue, flushing on `visibilitychange`. **Cost:** flushed commands land as one history entry (undo together). It makes KI-2026-09-14-e (board not re-read after a late apply) more reachable — taken next.
- **KI-3 downgraded:** tone colours stay plain token classes. Rejected: a `danger` variant on `Text` (only tone with one — recreates the inconsistency) or a `tone` prop migrated across ~40 files. **KI-48:** a missing email shows no line, not a placeholder like "No email".
- **KI-2026-09-14-e: re-read after the outstanding write settles**, only when one was open at mount. Rejected: routing the late response into whichever provider is mounted (the entry's preferred option — needs a provider registry and can go backwards), re-reading on every mount (a request per navigation), solo-trip polling (ADR-049 declines it). Touches `lib/queryCache.ts` despite the entry's "not a cache change" — the write scope only gained a way to be awaited.
- **KI-2026-09-25-c: dependency bump** of `@atlaskit/pragmatic-drag-and-drop` to `^3.1.0` (already locked as the auto-scroll/hitbox dependency — nothing new downloaded; 3.0's only breaking change adds import paths). Rejected: downgrading auto-scroll/hitbox, a `pnpm.overrides` pin (hides the mismatch), hand-rolled row scrolling. Side effect: **window auto-scroll during drags now works for the first time.** A guard against two cores returning is filed as **KI-2026-09-25-g**.
- **Not folded:** after validation, KI-15's residue and KI-2026-09-20-a describe the same defect (wire `placeNameVerdict` into `resolveOne`). Both are M9's; merging them is left to M9 rather than done in a sweep.
- **KI-2026-09-14-d: option 1 (server memo)**, not a materialised `city → count` table (7 writers incl. a separate-process importer, no triggers in the repo, a new migration joining M14's unrun production queue, and `saved_days` is CRUD so invariant 2's rebuild would not cover it) and not ETag/304 (the tag still needs the aggregate). **Accepted:** another instance or a production import can show a count up to 30 s stale. Noticed, not filed: `places.ts` `publishedCountries()` is the same cost class.
- **KI-2026-09-05-w:** deleted `checkAdmission` though M11a said it was kept "so restoring is wiring" (the same doc rejects the advisory route as a brute-force oracle; git keeps it); retargeted `AccountMenuFromSession`'s tests onto `HeaderSessionChrome` rather than deleting them; the sleep exemption is now the ESLint directive (`-- <reason>`), the `e2e-sleep-allowed:` marker had no users. Items 2 and 6 touch `server/ai/**` mechanically only (no tool grants, prompts or logged fields change).
- **CI red on the first full run (`9d27699`), caused by this sweep:** the new KI-5 spec hit the flush's own residual race #1 on the slower CI runner (Postgres `events_stream_seq` duplicate key → whole flush refused → `Received: 1`). Fix in progress: bounded retry of a batch **without** `expectedSeq` on a stream-seq conflict in `commands.ts`. Commented on the PR.
- **Batch retry on a stream-seq race** (fixing the CI red): in the server executor, not the client (the page is gone) or the route (only the executor knows it was this race). Also applies to the assistant's approved batch, v1 multi-command PATCH, clone and demo reseed — "as if it arrived a moment later". Not given to the single-command executor: there, losing the race means the flush already committed *later* edits, so a retry would reorder them (move to X then Y would end at X).
- **Own code review of the branch (Mitchell's mid-sweep ask):** 10 findings, each checked. Being fixed: the flush overtaking or all-or-nothing-dropping on in-app navigation (→ sequential drain after the in-flight head), quadratic unload sizing, wire-rename version skew (→ one-release alias), the sleep wall narrowed to `page`-named receivers (→ `no-restricted-properties`), the socket guard blocking a non-localhost `DATABASE_URL`, repeated ledger reads in the admin overview, the Keep dialog's hand-copied anchor rule, the stand-in scrollbar's echo stutter. **Kept as is:** Home now fails the whole list if one summary fails `TripSummary.parse` — every other `fetchTrips` caller already parses strictly, and a malformed summary is a projection bug worth seeing.
- **KI-2026-09-05-f:** 512 KiB body cap (~190× the largest shipped notebook; rejected `/ask`'s 128 KiB as too tight for a long journal), extended to the two `/v1` page routes so a token is no bypass; no per-node limits inside `PageDoc` (it is also the replay parser). Sentry example files **deleted**, reversing ADR-032's keep (amendment added). CSRF: posture recorded in `SECURITY.md` + cookie pinned; no Origin check (the proxy matcher excludes `/api`). Removed member: accept checks membership rather than `removeMember` revoking the invite (which would show the owner "Revoked" for a link they never revoked). Left: no `maxLength` on the title input; an autosave over 512 KiB is kept as a draft with no size-specific message.
- **KI-2026-09-24-e: read `endDate` at list time**, not a new `trip_summaries` column (a migration + backfill + dispatch, behind M14's unrun production migrations, and a second projector that could drift from the document). Cost: the list query reads one value from each listed trip's jsonb, and the summary now draws on two projections (always written in one transaction). Within "under way", the latest start comes first; a dated trip with no days stays "past" once it has started.
- **Review (A): the wire alias lives in a server-only module applied after `.parse()`**, not as optional fields in the shared zod schemas (would put dead keys into client types). This corrects tonight's "renamed in one step" decision for 09-19-c and 09-25-a — that reasoning missed tabs still running the old bundle. **Remove `apps/web/src/server/playbookWireAliases.ts` and its three call sites after the next production deploy.**
- **KI-2026-09-19-b/-f: two appends in one transaction**, not one combined batch (undo would then try to undo the genesis) and not a batchable `CreateTrip` (contracts change; would hand trip creation to the assistant). **KI-2026-09-19-f closed without your "option B"** — the window option A accepted is gone, and dates-on-`CreateTrip` stays available if ever wanted for itself. Same shape noticed in `cloneTrip.ts` (create → batch → compensating delete) — taken next.
- **KI-2026-09-23-i: moderation rides the author's read, not `SavedDay`** (which every reader gets, including `/v1/playbooks` and the frozen `/v1/library` — every non-author path would have to blank it forever, and `openapi.json` would change). Wording: *"A moderator hid this day from the library. It is still yours, but nobody else can find or open it, and publishing it again will not bring it back. Their note to you: "…""* No date shown (sent, for later); no Discover → Yours marker (needs `DiscoverDay` to change). Left: a hidden, still-public day's author still sees "Unpublish it first…" — accurate, could be reworded.
