# Known issues & tech debt

Durable register of **known-but-unfixed** problems and deferred cleanups, so
findings survive past the PR / session ledger that first surfaced them. Add a
row when you knowingly leave something unfixed; remove it (in the fixing PR)
when it's resolved. This is not the roadmap (`TODO.md`) and not a bug tracker —
it's the standing record of things we know about and have chosen not to fix
yet, with enough detail to act without re-deriving.

Severity: **correctness** (wrong behavior / failing invariant) ·
**reliability** (flaky / intermittent) · **cosmetic** (visual / copy) ·
**cleanup** (refactor / DRY, no user impact).

## Open

### KI-92 — `TripDate` accepts calendrically impossible dates, so the date parsers can only reject them by throwing
- **Severity:** correctness (a validation gap; its symptom today is a 500 where a 400 belongs)
- **Area:** `packages/contracts/src/trip.ts` (`TripDate`), `packages/domain/src/trip/decide.ts` (`SetTripDates`)
- **What is wrong:** `TripDate` validates SHAPE only — `/^\d{4}-\d{2}-\d{2}$/` — with no calendar-range check, so `"2026-02-30"`, `"2027-02-29"` and `"2026-13-45"` all parse as valid trip dates. Shape is not calendar validity, and nothing between the API boundary and the date math closes the gap.
- **The command pipeline is already closed (2026-08-29, PR #84).** `decide.ts` rejects a non-calendar date on both `SetTripStartDate` and `SetTripDates` with `invalid-dates`, via `isCalendarDate` exported from `packages/domain/src/trip/dates.ts`. That was not optional polish: KI-73's strict parse means a *persisted* impossible start date makes `deriveDayDates` throw on every projection, i.e. a trip that can never be read back, so without this guard the strictness would have traded silently-wrong dates for an unloadable trip.
- **What is still open is the contract itself.** `TripDate` continues to accept the value, so every future consumer re-inherits the gap and the domain's `RangeError` remains reachable by any path that does not go through `decide.ts`. The close is a `.refine` on `TripDate`, which makes the impossible date unrepresentable at the boundary and turns the domain's throw back into an assertion nobody can trigger. That is a genuine contract change — AGENTS.md invariant 5 makes it its own reviewed step, with the changelog entry and consumer sweep that implies — which is why KI-73 was closed without it.
- **Reachability:** the UI cannot produce such a date (`<input type="date">` will not emit one) and `NewTripWizard` gates on `ISO_DATE.test` first, so this needs a crafted API request. Latent, not live.
- **Cross-reference:** KI-73 (resolved 2026-08-29 — this is the half it explicitly could not take).
- **First noted:** 2026-08-29 (KI cluster, while converging the parsers).


- **Numbering:** filed as 77 on 2026-08-29, when several sibling branches each filed a different KI-77 the same night. Renumbered to 92 on merge. Nothing outside this file references it.
### KI-90 — The same history reconcile still clears a queue that fills while the command is IN FLIGHT
- **Severity:** correctness (silent loss of one or more user edits — the KI-5 family; the half of KI-70 its one-line fix does not reach)
- **Area:** `apps/web/src/components/trip/context/TripProvider.tsx` (`dispatch`'s `HISTORY_TYPES` branch, after the `await`)
- **Symptom:** the branch now guards correctly on `optimisticRef.current` before sending (KI-70, resolved), but the send is awaited and the reconcile that follows is unconditional: `setOptimistic((prev) => (prev ? { confirmed: result.value, pending: [] } : prev))`. Nothing stops the user editing during that round trip — `runDispatch` has no gate of its own — so any unit enqueued while the undo/redo/revert is in flight is discarded by `pending: []` when it lands. Same loss, same line, a window measured in network latency rather than in one React tick.
- **Why it is filed rather than fixed:** unlike KI-70's guard, this one has no obviously right answer. The queued units were predicted against a state the server has since replaced, so keeping them means re-predicting against the authoritative outcome — which is `confirmHead`'s job and `confirmHead` drops the head, so it does not fit — and the honest alternatives (refuse the reconcile, or disable editing for the duration of a history command) are both product decisions about a control that is currently instantaneous-feeling. Widening `confirmHead` into a general "adopt this outcome, re-predict what is queued" reducer is the shape that would fix KI-77, KI-5's `applyOutcome` precondition and this at once, and that is a design pass, not a line.
- **Found by:** the M11-fallout KI cluster, 2026-08-29, while fixing KI-70 — reading the branch it was fixing. Not fixed there under that PR's own "report a seventh problem, do not fix it" rule.
- **A second, much milder site of the same stale read:** `enter` (the history *preview*) still tests the render-time `pending`, so a preview can be entered in the same tick as an enqueue. Nothing is lost when it happens — `enter` only sets `previewSeq`/`previewTrip` and `exit` restores — so it is noted here rather than filed on its own.
- **Cross-reference:** KI-70 (resolved — the same-tick half), KI-5 (the hub entry for this loss class), KI-36 (resolved).
- **First noted:** 2026-08-29.

- **Numbering:** filed as 77 on 2026-08-29, when several sibling branches each filed a different KI-77/78 the same night. Renumbered to 90 on merge. Nothing outside this file references it.
### KI-91 — `next dev` leaves three files in the working tree that are not ours and are not ignored
- **Severity:** cleanup (no product impact; it puts unrelated files in front of every `git add` on a branch where someone ran the dev server)
- **Area:** `.gitignore`, `apps/web/next-env.d.ts`
- **What happens:** starting `pnpm --filter web dev` (Next 16, Turbopack) writes `apps/web/AGENTS.md` and `apps/web/CLAUDE.md` — vendor "agent rules" files from the `next` package, untracked and unignored — and rewrites the tracked `apps/web/next-env.d.ts` to point at `./.next/dev/types/...` where the committed version points at `./.next/types/...`. `next build` points it back. So `git status` on any branch is dirty in three places after a browser check, and the two `.md` files sit directly beside a real `AGENTS.md`/`CLAUDE.md` convention this repo uses for its own instructions — which is exactly the pair a hurried `git add apps/web` would sweep in.
- **Why it matters more here than it looks:** this repo's operating manual IS `AGENTS.md`, and a vendor file with the same name one directory down is a genuine trap for a future session reading either.
- **Fix path:** ignore all three (`apps/web/AGENTS.md`, `apps/web/CLAUDE.md`, and — if the dev/build flip is unavoidable — decide which spelling of `next-env.d.ts` is committed and ignore the other). Next's own docs cover suppressing the agent-rules files; that is worth checking before ignoring them, since not writing them at all is better than ignoring them.
- **Found by:** the M11-fallout KI cluster, 2026-08-29, doing KI-64's browser verification. The three files were kept out of that PR by hand.
- **First noted:** 2026-08-29.

- **Numbering:** filed as 78 on 2026-08-29, when several sibling branches each filed a different KI-77/78 the same night. Renumbered to 91 on merge. Nothing outside this file references it.
### KI-89 — `commands.int.test.ts` is a seventh whole-table truncator, and its `events` count assertion is what a concurrent run breaks first
- **Severity:** reliability (the KI-69 defect class, in the one file KI-69 did not list — and the file that demonstrates why the exclusive-resource policy is load-bearing)
- **Area:** `apps/web/src/server/commands.int.test.ts:38-41` (the `beforeEach`) and `:52-53`, `:55` (the whole-table assertions)
- **What happens:** the `describe("executeTripCommand")` block opens with `db.delete(tripDetails)`, `db.delete(tripSummaries)`, `db.delete(events)` — no `where` on any of them — and then asserts `expect(await db.select().from(events)).toHaveLength(1)` and `expect(await db.select().from(tripSummaries)).toHaveLength(1)`. Those are assertions about the entire database, and they hold only because the truncation immediately above them emptied it. KI-69 named six files; this is a seventh with the same shape, missed because its truncation sits inside a `describe` rather than at the top level.
- **Observed failing for real, 2026-08-29**, during the `pnpm check` at the end of the KI-69 work: `expected [ …(3) ] to deeply equal … - 1 + 3` at `commands.int.test.ts:53`. It did **not** reproduce — the file passed alone (19/19) and the full lane passed 25 files / 242 tests on the next three runs — which is the "different random subset each run" signature `.claude/protocol/ADAPTER.md` warns reads as flakiness and burns hours.
- **The cause was found rather than assumed, and it was not the code under test.** `ps aux` showed **two other agent worktrees running `pnpm test:int` at that moment** (`agent-a3eeb2ba9d7c27133`, `agent-a69c157d0bc06d926`), and the second one's `apps/web/.env.local` carries the byte-identical `DATABASE_URL=postgres://postgres:postgres@localhost:5433/travel`. A concurrent run appended events between this file's `delete` and its `select`, so the count was 3 instead of 1. This is precisely the corruption `ADAPTER.md` declares `postgres` an exclusive resource to prevent, caught in the act.
- **Why it is filed rather than fixed:** the KI-69 branch was scoped to the six files that entry names, and a seventh file is a new finding, not that scope. The fix is the same shape as the six: assert over `eq(events.tripId, tripId)` instead of the whole table, and drop the truncation.
- **The residue after that fix is the real question.** Even with every suite id-scoped, `rebuildProjections()` — called by `projections.int.test.ts` and `anchors.int.test.ts` — truncates and re-projects every trip's projections from the whole event log. So the integration lane cannot become genuinely concurrency-safe by scoping test data alone; that needs a schema or database per run, which is KI-69's second, untaken fix path and the thing that would let `test:int` stop being an exclusive resource.
- **Numbering:** filed as 79 on 2026-08-29, when three sibling branches each filed a *different* KI-77 and two a different KI-78. Renumbered to 89 on merge, `main` having reached KI-88. Nothing outside this file references it.
- **Cross-reference:** KI-69 (resolved — the same defect in six other files), `.claude/protocol/ADAPTER.md`'s exclusive-resources table.
- **First noted:** 2026-08-29 (the KI-69 sweep, by its own `pnpm check`).

### KI-84 — The docked assistant rail is a fixed 356px at every viewport, so a narrow phone loses the plan under it — MOSTLY RESOLVED
- **Severity (as filed):** cosmetic. **Actual, once Mitchell hit it on the PR #88 preview from his own phone (411×852):** functional — the composer was unusable ("the input is unselectable", "totally broken"), not just cramped.
- **Area:** `apps/web/src/components/assistant/AssistantRail.tsx`, `apps/web/src/app/globals.css` (`.assistant-rail`, `.assistant-open ~ .unscheduled-rack`), `apps/web/playwright.config.ts` (new `phone` project), `apps/web/e2e/m16-mobile-assistant.spec.ts` (new).
- **What was filed:** the rail's width was a fixed 356px regardless of viewport, with no narrower breakpoint — at 375px the plan behind it was squeezed to ~19px.
- **What Mitchell actually hit, and the root causes behind "unselectable" (found by direct click+type reproduction and `getComputedStyle` inspection, not guessed):**
  1. **`TripHeader` painted over the rail.** `TripHeader` is `sticky z-10` with `overflow-x: visible`; at the crushed width its own content (Share, Add stop, History) didn't fit its squeezed column and overflowed sideways, and — because the docked rail carried no `z-index` of its own (`auto`) — that overflow painted *on top of* the rail rather than under it. Confirmed directly: `document.elementFromPoint()` at a coordinate inside the rail's own box returned a day-chip `<a>` from the header, not the rail.
  2. Consistent with the composer being genuinely unclickable at some scroll/content states, not merely visually cramped.
- **The fix:** below 768px (Tailwind's own `md` — the phone/tablet line every other breakpoint-aware rule in `globals.css` already treats the same way, and the point `SPEC.md` §13 frames mobile foundations from) the rail is no longer a 356px flex sibling. It becomes `position: fixed; inset: 0; height: 100dvh; z-index: 30` — a full-screen surface, per Mitchell's own direction ("it probably shouldn't be a modal but a full page experience"), not a modal and not a squeeze. `z-index: 30` clears both stacking competitors already on the page (TripHeader's 10, the unscheduled rack's 20), so nothing can paint over it regardless of how tall either one's content gets. `100dvh` (not the docked rule's `100vh`) tracks the browser's real visible viewport, since a phone's on-screen keyboard can change that without changing `vh` — one credible way a fixed-height composer ends up below the visible area while still reporting itself as open; this is the class of bug a synthetic click cannot prove absent (Playwright never opens a real keyboard), so it's addressed structurally rather than left to a test that cannot see it. The `.unscheduled-rack` 356px compensation is now scoped to `>=768px` too — reserving room for a docked sidebar that no longer exists below that width was the exact kind of thing this ticket was filed to stop leaving unhandled. Docked (`>=768px`) behaviour is byte-for-byte unchanged and still pinned by `responsive.spec.ts`'s "docked contract" test at 1280px and 1100px. The header's "Hide" button is now the full-screen surface's only way back and is a real 44px target (SPEC §13.1) with a border, not a bare ghost action. Verified in the browser at 411×852 (Mitchell's own size) and 375px by clicking and typing into the composer (not `fill()`, not keyboard Enter — the same discipline that would have caught the rack/Ask-button bug this file's `.unscheduled-rack` comment describes), and pinned by `e2e/m16-mobile-assistant.spec.ts` in a new `phone` (411×852) Playwright project. `pnpm --filter web test:e2e:ci-like`: 54/54 passed.
- **What is deliberately NOT fixed here, and stays open:** the entry point is still the floating pill launcher, which `SPEC.md` §13.5 rules out outright ("Nothing floats over data. No floating action button.") — it was already off-spec before this fix and remains so after it. Redesigning the mobile entry point is a real design decision (§10's "mobile is retrieval, not planning" plus a genuine phone surface, neither of which exists yet) and out of scope for a defect fix; SPEC's two other assistant presentations (56px bubble, 364×476 floating card, §9) are still M16-deferred per Mitchell's 2026-08-25 call and are the more likely long-term answer to the launcher question, not a fixed full-screen rail.
- **Found by:** CodeRabbit, PR #88 review, 2026-08-29 (filed); Mitchell, same PR's live preview, same day (escalated from cosmetic to functional, and set the direction — full page, not modal).
- **Cross-reference:** `docs/milestones/M16-assistant-read-agent.md` ("Deferred, and owned by this milestone so it stays routed"), `SPEC.md` §9/§10/§13.
- **First noted:** 2026-08-29.

### KI-83 — Repeated local e2e runs exhaust the per-user AI quota, and `/ask` specs go red with 429 for a reason no code change explains
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

### KI-82 — The assistant can never mark a stop free: a zero cost is stripped as fabrication, and nothing distinguishes "free" from "unknown"
- **Severity:** correctness of an expressive limit — deliberately taken, and the *opposite* trade is the one that already caused harm; recorded so the limit is visible rather than buried in a helper
- **Area:** `apps/web/src/server/ai/writeTools.ts` (`withoutFabricatedCost`, called from `buildProposal` and `parseApprovedCommands`), `apps/web/src/server/ai/handleAskRequest.ts` (the instruction), `packages/contracts/src/money.ts`
- **The behaviour:** an AI-proposed or AI-approved `AddActivity`/`UpdateActivity` carrying `cost.amountMinor === 0` has its `cost` **removed** before the batch is built. So a user who asks the assistant for "a free walking tour on day 2" gets a stop with no cost at all, not a stop that says £0.00. `amountMinor: 0` is simply not expressible through the assistant. (`SetTripBudget`'s zero is untouched — a different claim, normally the user's.)
- **Why it was taken that way:** the model has no way to say *"I know this is free"* separately from *"I do not know the price"*, and the second failure has already happened for real. The **2026-08-02 dogfood run wrote `amountMinor: 0` on all nine activities it planned**, which the board renders as *free* when the truth was *unknown* — a confident wrong number on every stop. M9's exit gate names exactly this: "No activity carries a fabricated cost — unknown reads as unknown, not as `0`/free." An instruction alone could not hold it (a live model can ignore every word of the prompt), so the zero is dropped structurally. Given one signal and two meanings, "unknown" is the safe reading: a missing cost is visibly missing, a wrong zero is invisibly wrong.
- **Why it is tolerable today:** the user can still type `0` directly into `MoneyInput` on the stop, so a genuinely free activity is one edit away and no data is unreachable — only the assistant's *route* to it is closed. Nothing is silently discarded either: a real price the model supplies survives untouched, and an explicit `null` (clear the cost) survives untouched, because clearing is a decision rather than a guess.
- **What would resolve it properly:** give the two meanings two signals, so the strip has something to discriminate on. Options, cheapest first: (a) a `costUnknown: true` flag the model sets when it does not know, with `cost` omitted — the strip then applies only to a zero that arrives *without* an explicit "this is free"; (b) a `free: true` marker on the activity, which is arguably the honest domain concept anyway (a free stop and an unpriced stop are different facts about a trip, and `Money.nullable()` conflates them for the manual path too); (c) `SearchPlaces` grounding (KI-81), which for many venues supplies a real price and removes the guess entirely. (b) is the one worth designing — it fixes the manual path's version of the same ambiguity, not just the assistant's.
- **Tripwire:** `withoutFabricatedCost` is unit-tested for both directions (a zero stripped, a real price and an explicit `null` kept) and end-to-end against Postgres in the apply route's suite. Whoever adds a "free" concept must update those tests deliberately rather than loosening the strip.
- **Found by:** the Task 6 implementer, 2026-08-29, on review round 1 — flagged as the cost of the fix, not discovered afterwards.
- **Cross-reference:** KI-81 (grounding, which supplies real prices), KI-15 (the same species: a model guess laundered into a stored fact), ADR-008 (money is integer minor units), M9's exit gate.
- **First noted:** 2026-08-29.

### KI-81 — An approved AI plan carries the model's own place names, ungrounded: `SearchPlaces` is M9's named remainder
- **Severity:** correctness (a model guess is laundered into a stored fact — the same species as KI-15, one layer up)
- **Area:** `apps/web/src/server/ai/writeTools.ts` (`commitProposal`), `apps/web/src/server/ai/geocodeEnrichment.ts`, ADR-022 §1 (the fourth read tool it foresees)
- **What is missing:** M9's grounding half. The assistant can now propose and commit a batch (propose → review → approve), but a proposed `AddActivity`'s `location` is still whatever the model wrote. ADR-022 already names the fix and calls it earned under its own rule: a `search_places` READ tool the model must call, and a `placeRef` it must cite, so a stored place is a place the vendor returned rather than a name the model produced.
- **Why the floor is not zero:** an approved batch runs the SAME `enrichCommandLocations` the command endpoint runs — region-biased, "refine, never relocate", everything unverified reported (`commitProposal` is asserted to call it before the batch, in `writeTools.test.ts` and in the apply route's integration suite). So approval is not a second door around KI-15's protection, and locations from the assistant are **no worse than the command path's today**. They are also no better.
- **Why it was not built here:** it needs LocationIQ throttling at 2 req/s inside a streaming turn, a `placeRef` the resolver understands, and a review step that shows the user which candidate was chosen. That is its own scoped unit; folding it into the write-tools task was the single largest way to not finish either.
- **Tripwire:** the day `ai-live` is switched on for a real user, this is the entry to read first — an unreviewed model-authored place name is the failure KI-15 already cost a day to.
- **Found by:** the Task 6 implementer, 2026-08-29, recording it as the deliberate remainder its brief named.
- **Cross-reference:** KI-15 (the enrichment rewrite this rests on), ADR-022 §1, `docs/milestones/` M9.
- **First noted:** 2026-08-29.

### KI-80 — Two phrasings of the same command list: `summarizeBatch` (past) and `describeProposedChange` (conditional)
- **Severity:** cleanup (a duplicated exhaustive switch; both sides read the same `BatchableCommand`s, so they cannot disagree about facts — only about wording)
- **Area:** `apps/web/src/server/ai/planSummary.ts` (`summarizeBatch`), `apps/web/src/server/ai/writeTools.ts` (`describeProposedChange`)
- **What the duplication is:** a twelve-case switch over `BatchableCommand["type"]` exists twice. `summarizeBatch` writes the receipt for a batch that has ALREADY applied ("Done — added a day and added “X” to day 1.") — its documented contract, and exactly right after approval. A proposal needs the same information in the conditional mood, because "Done — added a day" rendered above an Approve button claims the thing the button has not done yet.
- **Why it was not collapsed:** `planSummary.ts`'s behaviour is pinned by ADR-022 §4 and this plan's Constraint 1 ("the command path is not modified"), so the shared `describeCommand(command, detail, mood)` that would collapse the two could not be written from the task that needed it.
- **Fix path:** move the per-command phrasing into `planSummary.ts` as an exported `describeCommand(command, detail, mood: "applied" | "proposed")`, have `summarizeBatch` join its `"applied"` output (byte-identical, its existing tests prove it), and delete `describeProposedChange`. It is a pure refactor of one module plus one caller.
- **One real drift channel the duplication opens** (found in review, judged not worth its own fix): the two are resolved against **different snapshots**. `describeProposedChange` labels days against the propose-time `detail` the guard captured; `summarizeBatch` labels them against the apply-time `detail`. So if the trip's day list moves between the proposal and the approval — another editor removes day 1 — the card can say "day 1" and the receipt say "day 2" for the same command. Nothing is mis-applied (the command carries a `dayId`, not a position); the two *labels* disagree. Collapsing the switch does not fix this on its own, but whoever does the refactor is the person best placed to decide whether the card should be re-derived at approval time.
- **Tripwire:** both switches are exhaustive with no `default`, so a thirteenth `BatchableCommand` fails to compile in **two** places. Whoever hits that should collapse them rather than write the case twice.
- **Found by:** the Task 6 implementer, 2026-08-29, while writing the proposal card.
- **Cross-reference:** KI-73 (the same species: one computation, two copies), ADR-022 §4.
- **First noted:** 2026-08-29.

### KI-79 — `/ask` deliberately refuses the demo trip, because a viewer-gated assistant on a session-less trip is an open LLM proxy
- **Severity:** correctness of a security boundary — currently *closed* by the refusal this entry documents; recorded so the decision is visible rather than buried in a guard clause
- **Area:** `apps/web/src/server/ai/handleAskRequest.ts` (the `isDemoTripId` refusal), `apps/web/src/server/access/trip-access.ts` (`requireTripAccess`'s demo branch), ADR-031
- **What the collision is:** `requireTripAccess` answers `isDemoTripId(tripId)` **before `auth()`**, returning `{ userId: "demo-visitor", role: "viewer" }` — that is what makes `/demo` public, and it is correct for every read route. `/ask` guards on `viewer` on purpose too (ADR-022: a viewer may ask about a trip they can see, unlike `/ai`, which is editor-gated because every surface it serves writes). Both decisions are right on their own. Composed, they would have made `POST /api/trips/<demo-id>/ask` an **unauthenticated, internet-facing LLM endpoint on the operator's key**.
- **What it would have cost, with `ai-live` on:** up to 30 attacker-authored turns an hour and 100 a day (`aiQuotas()`), all of them sharing the single `demo-visitor` bucket — so one visitor exhausting it denies every other visitor, and the global ceiling is reachable by anyone with a URL. It would also have put a Postgres write (the quota counter) on a request path `demoTrip.ts` deliberately keeps free of the database, which is an architecture regression, not a missing feature. `ai-live` is off in every environment today, so nothing was ever spendable; the exposure was the shape, not a live bill.
- **What was done:** `handleAskRequest` refuses `isDemoTripId(tripId)` with **403 `{ error, code: "demo-trip-unsupported" }`**, first thing — before the guard, before model selection, before the quota. Two integration tests cover it: the refusal signed in and signed out, and that nothing is written to `rate_limit_counters`. The rail does not render on `/demo` today (`TripBoardScreen`: `isDemo ? null`), but that is a client condition and the server no longer depends on it.
- **What would have to be decided to open it up** (all three, not any one):
  1. **Who pays.** A per-IP or per-session quota bucket, because `demo-visitor` is one bucket for the whole internet. `quota.ts` is keyed by actor id and has no notion of an anonymous caller.
  2. **Whether the demo path may touch Postgres.** ADR-031's guarantee is that `/demo` needs no trip row, no stream and no share row; a quota counter is a write. Either the guarantee is narrowed deliberately or the assistant needs a counter that is not the database.
  3. **What an anonymous prompt may reach.** Today the read tools are bounded by `toolsContext` to one fixed fixture, which is the strongest argument *for* opening it — but M9's write tools land on this same endpoint, and `minimumRoleFor` would then move the guard to `editor`, which the demo visitor is not. The order those two changes land in matters.
- **Found by:** the Task 3 implementer, 2026-08-29, while reading `requireTripAccess` for the guard choice; escalated and ruled on in review.
- **Cross-reference:** ADR-022 §3, ADR-031, KI-61 (the `DEMO_SHARE_TOKEN` problem the demo trip replaced).
- **First noted:** 2026-08-29.

### KI-85 — The Map lens reported as "no longer full height", not reproduced
- **Severity:** cosmetic — and **unconfirmed**; this entry exists so the report is not lost, not because a defect is established
- **Area:** `apps/web/src/components/lenses/MapLens.tsx`, `.map-lens` / `.map-lens-canvas` in `apps/web/src/app/globals.css`
- **Symptom as reported:** Mitchell, on PR #89's preview (2026-08-29), with a screenshot: the map does not fill the height it used to. Seen on his own trip at `?lens=Map`, in a **3440×1271** window.
- **What was checked, and what it rules out.** The report arrived on a PR that changed `DayChips`, which sits directly above the map, so the obvious suspect was a taller header squeezing a flex-sized lens. Measured both ways on the same page and viewport — with that change checked out, and with the previous version:
  ```
  pre-change   header 153px   map lens 630px   top offset 288px
  post-change  header 153px   map lens 630px   top offset 288px
  ```
  Not a pixel moved. PR #89's diff also contains no change to `MapLens.tsx`, to `globals.css`, or to any container above the lens. On `/demo?lens=Map` at 1200×900 the map ran to the bottom edge with the MapLibre attribution bar on it.
- **Why it is still filed.** Three things differ between that check and the report, any of which could carry it: a 3440px-wide window versus 1200px (a much wider aspect than anything tested), `/demo` renders a banner above the board that a real trip does not, so the offsets above the lens differ, and the report is against a Vercel preview rather than a local build. None of those were eliminated.
- **What would settle it:** open `/demo?lens=Map` at ~3440×1271. Full height there means it is specific to a real trip's header and this is a live defect; short there means it is width-dependent and reproducible without an account. Either way it is **not** PR #89's — that much is measured — so it belongs to whatever change did it, or to `main` as it stands.
- **Cross-reference:** KI-49 (the Map lens's tiles have never been confirmed to paint — a different and still-open claim about the same lens).
- **First noted:** 2026-08-29 (PR #89 preview review).

### KI-86 — `N to book` counts a narrower set than SPEC §12's wording, deliberately
- **Severity:** cleanup (a recorded design delta, not a defect — the same class as KI-52)
- **Area:** `apps/web/src/lib/needsBooking.ts`, `packages/fixtures/src/japan/kindOverrides.ts`
- **What differs:** SPEC §12 says *"Counted as unbooked: every stop whose kind is neither `booked` nor `transit`."* The build counts `hold`, `idea`, and `planned` **only when tagged `ticketed`**.
- **Why:** taken literally, SPEC's rule flagged **50 of the Japan fixture's 72 stops**, so all fourteen Calendar days carried a flag at once — for a line the same SPEC calls *"the one actionable thing at this zoom"*. The cause is that `planned` is the contract's zero value: a stop gets it for free, so counting it reads intent into the *absence* of intent, and every morning coffee and free shrine became outstanding work. `hold` and `idea` are the kinds a user sets deliberately to mean "not settled", which is exactly the outstanding work. The `ticketed` exception uses the tag's own designed power from the handoff's `TAGS` table — *"Wants a booking date. The assistant keeps asking until there is one."* — so the one `planned` stop that genuinely owes an action still counts. Mitchell's call, 2026-08-29.
- **What this costs:** a user who leaves a genuinely unbooked restaurant on the default `planned` gets no nudge for it. The counter-argument, and why it was accepted: they get no nudge *today* either, because the nudge was on every stop and therefore meant nothing. A stop someone actually cares about booking is one they will mark `hold`, which is what that kind is for.
- **Landed with a fixture pass, and the two are separable.** Five stops were re-profiled (three dinners `hold` → `booked`, two ticketed museums `planned` → `booked`) so the demo reads like a trip someone has worked on. Those diverge from the design export's own `status`, which `upstreamDrift.test.ts` guards — so they are declared in `kindOverrides.ts` with a reason each, and a further test asserts every override names a real stop, records the true upstream value, actually applies, and is not a no-op. A stale entry cannot quietly switch the drift guard off one id at a time. **Net effect on the demo: 3 of 14 days carry a flag instead of 14 of 14.**
- **If it should be revisited:** the honest alternative is a sixth kind, or a `needsBooking` flag on the activity, so "this needs booking" is stated rather than inferred from `kind` × `tags`. That is a contract change and its own reviewed step; nothing today wants it badly enough.
- **Cross-reference:** KI-52 (four tags not six — the same "recorded design delta" shape), KI-47 (the tags field), `docs/milestones/M18-stop-kind.md`.
- **First noted:** 2026-08-29 (M18's gate, walking `/demo`).

### KI-88 — FIXED — A reasoning model made the /ask intent classifier fail open on every turn, and the optimisation silently bought nothing
- **Status: FIXED, 2026-08-29, PR #88.** Filed hours earlier as a theoretical consequence of `maxOutputTokens: 8`, then observed live the same evening. Kept rather than deleted because it is the rare case of a known issue that predicted a real failure before it happened, and the fix is only legible against what it broke.
- **Severity when open:** cleanup (the turn still worked — it fails open to the full tool set by design — but the ~55% input-token saving it exists for quietly stopped happening)
- **Area:** `apps/web/src/server/ai/askIntent.ts` (`MAX_VERDICT_TOKENS`, `classifyAskIntent`), `apps/web/src/server/ai/simulatedModel.ts` (`classifyStep`), `apps/web/src/server/config.ts` (`aiModel`, `AI_MODEL`), `apps/web/src/server/ai/gateway.ts`
- **The live record.** Preview deployment, `ai-live` ON, `AI_MODEL=deepseek/deepseek-v4-flash-0731`:
  ```
  question: "What day risks being too draining or complicated?"
  classification: { intent: "write", source: "model", verdict: "",
                    failedOpen: true, latencyMs: 1861,
                    usage: { inputTokens: 208, outputTokens: 8 } }
  usageByStep[0]: 4906        // full 15-tool cost — the ~3,400-token saving did not happen
  ```
  An unambiguous question, classified `write`. Note the two numbers together: `outputTokens: 8` is the budget being spent *in full*, and `verdict: ""` is nothing coming back for it — the model reasoned to the ceiling and never emitted text. The classifier cost 216 tokens and 1.9s per turn and bought nothing.
- **How it presented:** every `/ask` turn offered the full read + write tool set even for a plain question, and per-step input tokens back at ~4,900. Nothing errored and no answer was wrong — the assistant behaved exactly as it did before the classifier existed. The tell was in the `ai.ask` records and was unambiguous: `classification.failedOpen` true turn after turn while `classification.verdict` was an empty string and `classification.source` was `"model"`.
- **Cause:** the verdict was FREE TEXT that we string-matched. `maxOutputTokens: 8` — one word plus slack — was the whole reason the call cost ~150 tokens, but a reasoning model spends its output budget on reasoning tokens before emitting anything, so the call returned empty text, `parseIntent` did not recognise it, and `classifyAskIntent` failed open to `write` (correctly — that is rule 1). The deeper defect was not the number: it was that correctness depended on the configured model's output **style**, so the same code was correct or useless depending on one environment variable. Two other spellings of the same bug were reachable without a reasoning model at all — a chatty model ("This is a question.") did not match either, because `parseIntent` normalised the whole string and required an exact `question`.
- **The fix:** the verdict is a **schema, not a parsed string**. `classifyAskIntent` passes `Output.choice({ options: ["question", "write"] })` to `generateText` (AI SDK 7.0.34), so the provider is handed a JSON response format constraining the answer to those two values and the SDK validates it before returning. A reasoning model still populates structured output *after* it reasons. Three consequences, all deliberate:
  - `MAX_VERDICT_TOKENS` went from 8 to **512**. It is now a *cost* ceiling rather than a *style* ceiling: it has to fit a reasoning preamble plus the ~10 tokens of `{"result":"question"}`. The real bound on spend and latency remains `CLASSIFY_TIMEOUT_MS` (4s).
  - The entire fail-open contract is unchanged, and it absorbed one more case: `result.output` throws when the step did not finish cleanly, so a budget consumed by reasoning is now a *miss* rather than a misread, and lands in the same branch as a throw, a timeout and an abort. `verdict` records the raw structured answer (or the offending text off the error), so a bad verdict stays diagnosable; `failedOpen` is still true whenever the fallback fires; the `isBareAgreement` short-circuit is untouched.
  - `simulatedModel`'s `classifyStep` emits through `askIntentVerdictText` rather than a bare word. This was the trap in the fix: a bare `write` is not valid JSON for the new schema, so leaving it would have failed open on **every turn of every Vercel environment**, which is the only path anyone deploys — the same failure this KI describes, moved from live to simulated. Covered by a test that drives the simulated model through the real `classifyAskIntent`.
- **Also landed alongside, and worth knowing about:** `AI_CLASSIFIER_MODEL` now configures the classifier's model separately from `AI_MODEL`, defaulting to `AI_MODEL` so nothing changes until it is set. Both handles are still built inside `modelSelection.ts` — ADR-019's gateway chokepoint, with a lint-wall fixture for the new export — so the `ai-live` kill switch and the `denied` outcome cover the classifier too. With the fix in, pointing this at a reasoning model is a legitimate choice rather than a way to break the classifier.
- **What to watch:** `classification.model`, `.latencyMs` and `.usage` in the `ai.ask` records, which now name which model gave the verdict. A `failedOpen` rate that climbs after a model change is this issue's shape returning in a form the schema does not cover.
- **Found by:** branch review of the classifier work, PR #88, 2026-08-29 — then confirmed live the same evening, before the predicted failure had been fixed.
- **First noted:** 2026-08-29. **Fixed:** 2026-08-29.

### KI-87 — `/ask` and `/ai` disagree about a new stop's default `kind`, so the same model behaviour reads as unbooked on one door and booked on the other
- **Severity:** cleanup (a recorded inconsistency between two AI doors, not a defect on the one that matters today)
- **Area:** `apps/web/src/server/ai/writeTools.ts` (`withDefaultKind`, `buildProposal`, `parseApprovedCommands`), `apps/web/src/server/ai/handleAiRequest.ts`, `apps/web/src/server/ai/batchResolver.ts`
- **The behaviour:** a stop created through `/ask` (the assistant's write tools) defaults to `hold` when the model states no `kind`, so it counts toward the Calendar's `N to book` (KI-86). The same stop created through the older `/ai` command endpoint still defaults to `planned`, and does not count. Two AI doors, two different answers to "did I just create something that needs booking" for the identical model output.
- **Why it is that way:** `handleAiRequest.ts` calls `resolveBatch` directly and never reaches `writeTools.ts`, so `withDefaultKind` — applied in `buildProposal` and again in `parseApprovedCommands` — never runs on that path. The seam that would fix it in one place, `batchResolver.ts` (`resolveBatch`), is deliberately pinned while M16/M9 is in flight: ADR-022 §4 requires the command path to stay untouched so write-tool work doesn't quietly reshape the endpoint both `/ai` and `/ask` share.
- **Why it is not urgent:** `/ai` is the older path — the assistant rail no longer calls it. `/ask` is what a user reaches today, and it already carries the fix.
- **Fix path:** whichever seam is right once the pin lifts, most likely `resolveBatch` itself so both doors agree by construction rather than by two independent copies of a default. `withoutFabricatedCost` (the zero-cost fix, M9) has the same `/ai`/`/ask` split already, for the same reason — worth closing both in the same pass.
- **Cross-reference:** KI-86 (the `needsBooking` rule a stop's default `kind` feeds), ADR-022 (the pin this is waiting on).
- **First noted:** 2026-08-29, while implementing M16/M9's create-time `kind` default.

### KI-77 — The geocoder's name check rejects three correct venues on tokenisation, and the overlay silently loses them
- **Severity:** cleanup (no product impact — `trip.ts` is canonical since ADR-030 and still carries 72/72 coordinates; this shrinks a cross-check, it does not move a pin)
- **Area:** `apps/web/src/server/ai/geocodeNameMatch.ts` (`nameTokens`, `distinctiveTokens`)
- **Symptom:** `placeNameVerdict` requires every distinctive token of the queried place to appear as a token of the candidate's own name, and `nameTokens` splits on every non-alphanumeric character. So a hyphen the vendor renders differently is a mismatch, and a translated suffix is a mismatch. Three of the Japan seed's stops are rejected this way — all three are the right place:
  ```
  "Gonpachi Nishiazabu"  vs  "Gonpachi Nishi-Azabu"   required [gonpachi, nishiazabu], candidate [gonpachi, nishi, azabu]
  "Tenryū-ji"            vs  "Tenryū Temple"          required [tenryu, ji],           candidate [tenryu, temple]
  "Ginkaku-ji"           vs  "Ginkakuji"              required [ginkaku, ji],          candidate [ginkakuji]
  ```
- **How it surfaced:** the 2026-08-29 regeneration for KI-58. These three had been in the overlay as `not-comparable` — the vendor had previously answered in local script (権八 西麻布, 天龍寺, 銀閣寺), which the check cannot read and therefore accepts. This run it answered in romaji, which the check *can* read and therefore rejects. **The verdict for a correct venue depends on which script the vendor happens to answer in**, which is not a property anyone chose.
- **Why it matters more than three rows:** `verify.ts` only checks a canonical coordinate where the overlay has an opinion, so each false rejection quietly removes one stop from the cross-check. It fails safe — nothing wrong is stored — but the guard covers 41 of 72 stops instead of 51, and nothing says so at the point of use.
- **Fix path:** compare on a concatenation-insensitive fold as well as a token fold, so "nishiazabu" matches "nishi"+"azabu" and "ginkakuji" matches "ginkaku"+"ji". That covers two of the three. "-ji" vs "Temple" is a translation, not a spelling, and wants either a small suffix synonym set (`-ji`/`-dera` → temple, `-jingū`/`-gū` → shrine) or acceptance that a translated name is `not-comparable` rather than `mismatch`. **Do not** simply widen `GENERIC_TOKENS` — that module's own comment warns a long list shrinks the distinctive set toward nothing.
- **Do not fix by loosening the caller.** The script's step 4b (KI-58) is a ranking; this is about what counts as a mismatch at all, and it belongs in the shared module with tests, not in the one-off script.
- **Found by:** the KI-58 fix, 2026-08-29.
- **Cross-reference:** KI-58 (the run that exposed it), KI-39 (which added the check), KI-15.
- **First noted:** 2026-08-29.

### KI-78 — The geocode script reports "no results" as a retryable vendor error, on nine stops, every run
- **Severity:** cleanup (a misleading label in a one-off script's report; no product impact)
- **Area:** `apps/web/scripts/geocode-japan-seed.mts` (`resolveJob`'s `catch`, and the `lookup-failed` reporting block)
- **Symptom:** LocationIQ answers a zero-result query with **HTTP 404**, not an empty list. `createLocationIQGeocoder` throws on it, `resolveJob` catches it as `reason: "lookup-failed"`, and the report prints it under `Lookup failed (rate limit or vendor error — rerun to retry)`. Nine stops hit this on every run — Hippari Dako, Koffee Mameya, Nazuna Kyoto Gosho, Omen Kodaiji, Giro Giro Hitoshina, Ippodo Kaboku, Aisunao, Zentis Osaka and Tonkatsu Maisen — and none of them is a transient failure. Rerunning changes nothing.
- **Why it is worth fixing:** the script's whole design point is that a miss is *reported and left missing* rather than guessed (its own method comment, constraint 5). It gets that right; it then files the honest misses under a heading that tells the next reader to rerun. The distinction the report is trying to draw — "the vendor failed us" versus "the vendor has no such place" — is real and currently collapsed, and a genuine rate-limit would be invisible among the nine standing 404s.
- **One of the nine is a symptom of another bug, not of this one:** `d14-s1-breakfast-at-the-hotel` queries `"Zentis Osaka, Kita, Tokyo, Japan"` — a real Osaka hotel with Tokyo in the string, because the day's destination city is folded into the query. That is KI-59, and it is the clearest independent evidence of it: the query is unanswerable because the data is wrong.
- **Fix path:** have the vendor adapter distinguish 404 from other failures, or have the script inspect the error, and add a fourth outcome (`no-results`) alongside `no-candidate-in-box` / `name-mismatch` / `lookup-failed`. Touching `locationiq.ts` makes this a change to a shared seam rather than a script edit, so it wants its own scoped step.
- **Found by:** the KI-58 fix, 2026-08-29.
- **Cross-reference:** KI-58, KI-59 (the Zentis Osaka query), KI-15.
- **First noted:** 2026-08-29.

### KI-66 — The CSP keeps `script-src 'unsafe-inline'`

- **Severity:** correctness — a stated-and-accepted weakening. The "nobody has run this" half of this entry was closed on 2026-08-28; see the walk below.
- **Area:** `apps/web/next.config.ts` (the `headers()` CSP)
- **The weakening, and why it was taken:** the App Router streams its RSC payload through inline `<script>self.__next_f.push(...)</script>` tags on **every** page, so `script-src` cannot drop `'unsafe-inline'` as written. The supported alternative is a per-request nonce minted in middleware, which opts every page out of static rendering — a whole-app performance trade. The judgement recorded in the file is that the policy's other directives (`object-src`, `base-uri`, `form-action`, `frame-ancestors 'none'`, `frame-src 'none'`) already close the classic injection escalations, and that no third-party script loads in production. That reasoning is sound; it is recorded here so it is revisited deliberately rather than inherited.
- **The policy HAS now been exercised by a browser, and no directive needed loosening.** Walked 2026-08-28 in Chromium 141 against a local production build of `fb51486` serving the header byte-identically. Twenty surfaces, console read on every one, zero CSP violations: landing, sign-in/up, welcome, playbooks, the trips list, the **trip board** (68 cards, drag, conflict banners), the **activity editor and trip-settings Radix sheets at 1280px and 1100px**, the share popover, the assistant rail, all three lenses, the **notebook list and TipTap editor**, the account menu, and `/s/<token>` signed out.
- **The negatives are real, because enforcement was proved first.** A deliberate control probe from the board page returned `Refused to connect to 'https://example.com/probe' because it violates the following Content Security Policy directive: "connect-src 'self' https://tiles.openfreemap.org"`. Without that probe, "no violations" would have been indistinguishable from "the policy never loaded".
- **The map lens threaded all three of its directives.** `connect-src` served the style JSON, six vector tiles and four glyph ranges; `img-src blob:` decoded the sprite (explicit `URL.createObjectURL` probe: `blob image loaded ok`); and `worker-src blob:` — the directive nothing had ever exercised — created a real worker, reproduced across two runs. KI-49 bit first (the container's egress blocks the tile host for Chromium, `net::ERR_ABORTED` with **no** `Refused to connect`), so the tile bytes were mirrored in through a route handler. CSP is evaluated in the renderer before a request reaches a route handler, so the policy decision was genuine even though the transport was not.
- **What the walk still does not cover:** the dev-mode CSP branch (`'unsafe-eval'`, `va.vercel-scripts.com`) was not run. Google OAuth's 302 hand-off against `form-action 'self'` is still reasoning. And `frame-src`/`frame-ancestors`/`object-src`/`base-uri` were never counter-probed — nothing tried to violate them, which is weaker than proving they would block something. Vercel's own `/_vercel/insights/script.js` and `/_vercel/speed-insights/script.js` under `script-src 'self'` have not been seen loading in any walk.
- **The Vercel preview — this entry's other named gap — is walked, twice, from both environments.** M11's exit gate reached it 2026-08-28 from a laptop with an MCP-minted `_vercel_share` bypass (landing, sign-in, the trips list, the new-trip wizard, the trip board, the Add-stop and Trip-settings sheets, the share popover, the invite-accept screen, `/s/<token>` and `/demo` at both lenses). A cloud session reached it 2026-08-29 via `pnpm --filter web walk:preview` — see `docs/guidelines/cloud-agent-sessions.md` for the three obstacles that had to be cleared and why the paragraph claiming it was unreachable was wrong. **Both walks independently found the same CSP violation**, which is the strongest evidence in this entry that the preview was a real gap and not a formality.
  - `vercel.live/_next-live/feedback/feedback.js` was refused on **every** preview page under `script-src 'self' 'unsafe-inline'`. M11's gate recorded this as expected preview noise that nothing depends on. **That second half was wrong, and it is fixed rather than documented:** the script is the Vercel Toolbar's loader, and the Toolbar is how the Flags Explorer flips `ai-live` for one reviewer's session — the workflow `docs/guidelines/environments-and-deploys.md` documents for trying live AI on a preview without changing the stored value for everyone. It had been broken since the CSP landed. The policy now admits the Toolbar's six documented origins **on preview only**, gated on `VERCEL_ENV` and pinned by `apps/web/next.config.test.ts`, whose every "preview allows X" assertion has a "production still refuses X" twin. A preview console should now be clean; if it is not, that is a finding again.
  - When Deployment Protection re-challenges an **in-flight XHR**, the 307 to `https://vercel.com/sso-api?...` is refused under `connect-src`, `fetch` rejects, and the app surfaces it as whatever its generic failure copy says — in the observed case, invite acceptance rendering *"This invite doesn't work — Failed to fetch"*. The CSP is correct and the app is correct; the request never reached the application at all. `docs/guidelines/cloud-agent-sessions.md` already warns not to read Vercel's redirect as an app response — this is the same trap reaching you through a fetch rejection rather than a page render. Refresh the bypass and repeat the action before believing anything.
  - **A cloud-session walk runs at TLS 1.2** (the egress tunnel cannot carry Chromium's TLS 1.3 ClientHello), so it is not evidence about anything TLS-version-dependent. A laptop walk has no such limit.
- **Related correction:** the `style-src` comment attributes the runtime `<style>` injection to *"tippy.js (the notebook's slash-command popup)"*. There is no slash-command popup — macro authoring was removed in M8 — and `tippy.js` was removed as a direct dependency on 2026-08-28 with zero importers. The injector is `@tiptap/core`, whose embedded style string happens to contain `.tippy-box` rules, which is almost certainly where the attribution came from. The directive is still needed; the reason named for it is wrong.
- **First noted:** 2026-08-28 (security-headers work). Browser-walked the same day, which closed the unverified half and corrected the premise it rested on: this container DOES have a usable Chromium under `$PLAYWRIGHT_BROWSERS_PATH` — and `chromium.launch()` finds it with no `executablePath`. Do not copy a pinned path from anywhere: the revision and the directory layout have both already changed once (`chromium-1194/chrome-linux/` → `chromium-1228/chrome-linux64/`). See `docs/guidelines/cloud-agent-sessions.md`.

### KI-67 — The AI and geocode quotas meter REQUESTS, so a 32-step answer costs the same allowance as a one-step one

- **Severity:** correctness (the control does not bound the thing it exists to bound)
- **Area:** `apps/web/src/server/quota.ts` (`aiQuotaPolicies`, `geocodeQuotaPolicies`), `apps/web/src/server/ai/handleAiRequest.ts`
- **Symptom:** every policy is a count of calls — `AI_RATE_LIMIT_PER_USER_HOURLY` 30, `..._DAILY` 100, global 300/1000, geocode 300/4000. Cost is not proportional to calls. `handleAiRequest` runs a tool-using loop with a step budget, so one request can burn up to 32 model round-trips while another burns one, and both decrement the same allowance by exactly 1. An actor who wants to maximise spend under the cap simply writes prompts that provoke long tool loops; the ceiling barely moves.
- **What it does do, and why it still shipped:** it bounds the *worst case* — 100 requests × 32 steps is a finite number and an unbounded loop is not, which is a real improvement on the nothing that preceded it, alongside the prompt-size cap landed in the same change. It is a floor, not the accounting.
- **The data for the real fix already exists.** `handleAiRequest.ts:177` computes `totalTokens` (with `inputTokens`/`outputTokens`) off the model result and puts it in the response `meta`. Nothing reads it for enforcement. A token-metered policy would decrement by `meta.usage.totalTokens` **after** the call rather than by 1 before it, which changes the shape of the check (you cannot pre-authorise an unknown cost) — that is the design question, not the arithmetic.
- **Why not fixed here:** post-hoc metering means deciding what happens to the request that crosses the line mid-flight (serve it and go negative, or fail after paying?), and whether the counter is per-token or per-currency once models differ in price. `TODO.md`'s "AI cost/quality tuning" candidate already says **"Watch `meta.steps` — that is the cost driver, and it is already instrumented"**; this is the same observation arriving at the enforcement layer.
- **Cross-reference:** ADR-019 (the AI kill switch — remediation after the fact, which is why prevention was added), KI-24 (`AI_LIVE` on Vercel is warned-about, not prevented), KI-11 (no test calls a real model, so no test measures a real token cost).
- **First noted:** 2026-08-28 (security-review remediation, findings H1/L4).

### KI-62 — Report-conformance may check the wrong unit's report when units run concurrently

- **Severity:** unknown-until-observed (could make the hook inert exactly where the protocol is used)
- **Area:** `scripts/hooks/subagent-report-conformance.mjs`
- **Symptom:** the hook walks backwards through `transcript_path` for the last
  assistant text block. If Claude Code records subagent sidechains into the
  parent session's transcript, then with 2-4 concurrent units their entries
  interleave, and the last text block at a given `SubagentStop` may belong to a
  *different* unit — yielding a silent no-op (no `## Exit:` heading found) or a
  conformance check against the wrong unit's report.
- **Scope:** only bites with concurrent units. Every test uses a synthetic
  single-agent transcript, and the real-transcript check that was run was
  against a single-session file.
- **Why not fixed here:** the transcript-path semantics for concurrent
  subagents could not be established without a real multi-unit run, and
  guessing at a fix would be worse than recording the question.
- **How to settle it:** on the first real `/dispatch` run, dispatch two units,
  let both finish, and confirm the hook engaged for each. If it did not, the
  backstop is `/dispatch` step 4's "confirm `reports/<unit-id>.md` exists",
  which is already the only thing catching a report that was never written.
- **First noted:** 2026-08-28, final review of the subagent protocol branch.

### KI-63 — Small subagent-protocol defects found in review and consciously left

- **Severity:** cleanup
- **Area:** `scripts/hooks/resource-lease.mjs`,
  `scripts/hooks/subagent-report-conformance.mjs`,
  `scripts/hooks/lib/run-context.mjs`,
  `docs/specs/2026-08-28-subagent-operating-contract-design.md`,
  `.claude/protocol/ADAPTER.md`
- **What was left, and why each was judged safe:**
  - `resource-lease.mjs` does not validate `entry.resource` / `entry.symptom`.
    An adapter entry containing an object with non-callable `toString`/`valueOf`
    would throw on coercion. Requires deliberately pathological JSON — a merely
    missing field coerces to `"undefined"` harmlessly — and the portability
    test now asserts `typeof entry.pattern === "string"`, which catches the
    realistic shape at source.
  - `subagent-report-conformance.mjs`: a catch comment overstates its trigger
    (claims non-UTF8 content, which `readFileSync` does not throw on); a
    redundant `raw ? … : []` branch; and with two `## Exit:` headings the first
    governs. Worst case for the last is one wasted round trip.
  - The `## Exit:` trigger will false-positive on a subagent that merely
    *quotes* the protocol — plausible in this repo now. Bounded to one blocked
    stop by the `stop_hook_active` guard. If it becomes annoying, require the
    heading within the first few lines rather than anywhere in the message.
  - The `mainCheckout` / `worktreeRoot` divergence comment sits above
    `worktreeRoot` with no forward pointer from `mainCheckout`.
  - The design spec's hook-1 description names neither the worktree-boundary
    branch nor the run-directory allowance; `CONTRACT.md` and the code comments
    both carry the behaviour.
  - `ADAPTER.md` lists `ci-minutes` as an exclusive resource with no
    `adapter.json` entry. Now marked as a human-observed policy rather than a
    hook-enforced lease; no fake entry was invented for it.
- **Why not fixed here:** each is cosmetic or needs an unrealistic input, and
  the branch already ran two fix waves. Recorded rather than dropped because
  the ledger holding them was deleted at teardown — which is exactly the
  failure this protocol's promotion gate exists to prevent.
- **First noted:** 2026-08-28, task and final reviews of the subagent protocol branch.
### KI-59 — Seven transition stops carry their day's destination city, not the city they are physically in
- **UNBLOCKED 2026-08-29 by M18's gate — the enabling change below has landed.
  Two sessions reached this entry from opposite ends on the same day; this
  paragraph reconciles them.** The other session corrected all seven rows,
  measured the result as a regression, and reverted it — see "ATTEMPTED AND
  REVERTED" below. Its stated prerequisite was: *"a day's city must come from
  where the day **ends**, not from its first stop… `cityFor()` can take the
  day's last stop instead of its first. Correct these seven rows in the **same**
  change as that, never before it."* **`cityFor()` now reads a day's LAST
  city-bearing stop** (M18, Mitchell's day-label rule). So the specific
  regression that was measured — every corrected first-stop retagging its whole
  day, Nikkō vanishing from the chips — should no longer occur, because a day's
  label now comes from where it ends. **That is a prediction from the mechanism,
  not a measurement: nobody has re-run the correction since `cityFor` changed.**
  Re-run it before believing it.
- **One half of that prerequisite did NOT land, and deliberately so.** The same
  paragraph also expected `calendarCityCards.ts` to split a travel day at its
  last `transit` stop. That split was built, walked, and **removed** at M18's
  gate: it fired on one of seven travel days and got that one wrong, and its
  output depended on this very entry's tagging convention — *"I don't think the
  shape of the fixture should drive functionality, that's how we get drift"*
  (Mitchell, 2026-08-29). The Calendar now groups by city alone. So a correction
  here no longer has a transit rule to coordinate with; it only has to not break
  day accents and the city cards, which is a smaller question than the entry has
  carried until now. Full account: `docs/milestones/M18-stop-kind.md`.
- **Also worth carrying forward:** KI-60 already removed the conflict-baseline
  obstacle this entry was originally filed against, and `upstreamDrift.test.ts`
  is the newer one — it asserts `JapanStop.city` equals the export's
  `days[].city`, so any correction must also declare that `city` is no longer
  carried verbatim from upstream.
- **Severity:** cosmetic / design decision (deliberate, longstanding, and product-visible; recorded so it is a choice rather than an accident)
- **Area:** `packages/fixtures/src/japan/trip.ts` (`JapanStop.city`), `packages/fixtures/src/japan/commands.ts` (`locationName`, which folds `city` into `Location.name`)
- **Symptom:** a day is tagged with the city it arrives in, so a stop that begins the journey is labelled with the destination. Seven rows:
  ```
  day  4  Tobu Asakusa Station   tagged Nikkō     "Limited Express to Nikkō"
  day  6  Shinjuku Station       tagged Hakone    "Romancecar to Hakone-Yumoto"
  day  7  Odawara Station        tagged Kyoto     "Shinkansen Odawara → Kyoto"
  day 11  Kyoto Station          tagged Osaka     "Train Kyoto → Osaka"
  day 13  Uno Port               tagged Naoshima  "Train and ferry to Naoshima"
  day 14  Zentis Osaka           tagged Tokyo     "Breakfast at the hotel"
  day 14  Shin-Osaka Station     tagged Tokyo     "Shinkansen to Tokyo"
  ```
  `city` lands on both `Location.city` and, via `locationName`, inside `Location.name` — so the stored label reads `"Zentis Osaka, Kita, Tokyo, Japan"` for a hotel in Osaka.
- **Why it is filed rather than fixed:** it is the fixture's stated convention, inherited from `db-seed.ts` where the day-14 case was reasoned out explicitly — splitting that day produced "a pile of 'same day, ~400km apart' distance warnings ... accurate but noisy for a fixture". `cityFor()` names and colours a day from its activities' `city`, and `calendarCityCards.ts` groups strictly on it, so splitting these seven would change day accents, the calendar's city cards, and the 12-conflict baseline `pnpm seed:verify` pins. That is a product decision about how a travel day is modelled, not a mechanical correction — the same class as KI-39's note that the seed's coordinates are "a product-visible data decision".
- **The real question underneath it:** the domain has no concept of a stop that moves between two places. `ActivityKind: "transit"` says a stop *is* travel but not where it goes. Until there is a from/to, any single `city` on a transit stop is a lie in one direction or the other; the current convention at least makes the lie consistent.
- **Fix path, if taken:** give a transit stop the city it departs from and let the day derive its label from the majority or the last stop — or model an origin/destination pair on the activity, which is a contract change and its own reviewed step.
- **ATTEMPTED AND REVERTED, 2026-08-29 — the correction alone is a regression, now measured.** All seven rows were corrected to the city the stop is physically in and the day chips recomputed. `cityFor()` (`DayChips.tsx`) reads the day's **first** located activity, and all seven of these rows are their day's first stop, so each one retags its entire day:
  ```
  day  4  Nikkō    -> Tokyo      the Nikkō day trip stops saying Nikkō
  day  6  Hakone   -> Tokyo
  day  7  Kyoto    -> Hakone
  day 11  Osaka    -> Kyoto
  day 14  Tokyo    -> Osaka      the fly-home-from-Tokyo day says Osaka
  ```
  **Nikkō disappears from the trip's chips altogether** (six cities become five) and every transition badge lands one day late — Tokyo→Hakone on the Kyoto day, Kyoto→Osaka on day 12. So the data fix makes the demo visibly *wrong in a new way*, and the entry's original judgement holds after both M18 and KI-60.
- **What has changed since it was filed, and what has not.** KI-60 removed one of the three stated obstacles: the conflict baseline is **not** affected, because conflicts are computed from `lat`/`lng`, which were always physically correct — `seed:verify` still reports 2 conflicts with all seven rows corrected. `upstreamDrift.test.ts` is a second, newer obstacle: it asserts `JapanStop.city` equals the export's `days[].city`, so any correction here must also declare that `city` is no longer carried verbatim from upstream. The day accents and the calendar cards remain the real blocker.
- **The enabling change, and it is downstream:** a day's city must come from where the day **ends**, not from its first stop. M18 shipped `kind`, so `calendarCityCards.ts` can now do what its own comment has always said it would — split a travel day at its last `transit` stop — and `cityFor()` can take the day's last stop instead of its first. Correct these seven rows in the **same** change as that, never before it. Touching `packages/fixtures` alone cannot close this entry.
- **Found by:** CodeRabbit's review of PR #74, 2026-08-28. Rationale restored into `trip.ts`'s `JapanStop.city` doc comment in the same PR (it had been lost when the rows moved out of `db-seed.ts`); the 2026-08-29 measurement above is recorded there too.
- **Cross-reference:** KI-35 (`area` exists because `name` alone could not carry locality), ADR-030.
- **First noted:** 2026-08-28 (PR #74 review).

### KI-55 — A unit queued after a KI-42 retention predicts over a base that skips the retained work
- **Severity:** correctness-cosmetic (the optimistic *preview* can show a trip no send will produce; **no work is lost** — every retained unit is still queued, still counted by `unsentCount`, and still sent in order)
- **Area:** `apps/web/src/components/trip/context/optimistic.ts` (`enqueue`, `baseDetail`)
- **Symptom:** after `confirmHead` retains units it can no longer predict (KI-42), those units carry `predictedDetail: null` and `baseDetail` scans past them to the last unit that *has* a prediction. `enqueue` predicts a newly queued unit against that base — so the new prediction, and therefore `activeDetail`, omits the retained work even though it is still queued and will still be sent. `confirmHead`'s own comment states the opposite guarantee ("predicting a later one against a base that skips an earlier one would show the user a trip that no send is ever going to produce"); that guarantee covers only the units `confirmHead` itself re-predicts, not ones enqueued afterwards.
- **Found by:** CodeRabbit's review of PR #73 (the KI sweep that fixed KI-42), 2026-08-28. Verified against the code and **pinned by a characterization test** — `optimistic.test.ts`, "predicts a newly queued unit over a base that skips the retained ones (KI-55)" — so a change to this behavior is a visible test change rather than a silent one.
- **Why it is recorded rather than fixed:** the recommended fix (make a null-prediction unit a barrier, so newly queued units are also retained unpredicted) has a real cost — the user's *next* edit would visibly do nothing on screen until the queue became predictable again. The current behavior is at least self-consistent: the user can only act on what is rendered, what is rendered is already `baseDetail`, so the new prediction matches the screen they clicked. Which trade-off is right is a product call about the optimistic layer, not a mechanical fix — the same class of decision `tripDetailFactory`'s `conflicts: []` was left as.
- **A third option, if neither is wanted:** surface the retained-but-invisible units explicitly (the count is already in `sync.unsent`), so the preview's incompleteness is stated rather than inferred.
- **How it is reached:** requires a concurrent write that invalidates a queued unit's prediction mid-flight, *and* the user making further edits before the queue drains. Rare in single-player; Invariant 6 makes it normal in Phase 2.
- **Cross-reference:** KI-42 (resolved 2026-08-28 — this is the boundary of that fix's guarantee), KI-5 (navigation trigger, still open), KI-36 (failed-send trigger, resolved).
- **First noted:** 2026-08-28 (CodeRabbit review of PR #73).

### KI-3 — Minor M5 re-skin cosmetic/cleanup notes
- **Severity:** cosmetic / cleanup
- **Area:** `apps/web/src` (various)
- Collected small findings from the Wave-1/Wave-2 reviews:
  - ~~Trip "currency" field label renders lowercase~~ — **FIXED** (Task 19,
    2026-08-09): `TripMoneySettings.tsx`'s `FormField` label and the
    `NativeSelect`'s `aria-label` both now read "Currency".
  - ~~Sign-in link (Track A) is a real `<a>` styled as a secondary button but
    missing the focus-ring / `cursor-pointer` a real `Button` has~~ — **FIXED**
    (Task 19, 2026-08-09): both sign-in links (`app/page.tsx` and
    `board/TripBoardScreen.tsx`, the latter previously fully unstyled) now
    reuse `buttonVariants({ variant: "secondary" })` from
    `components/ui/button.tsx` instead of a hand-rolled/missing className, so
    they get the same focus ring and `cursor-pointer` a real `Button` has.
  - `text-danger-ink` used as a raw utility instead of a `Text` variant —
    **RE-DEFERRED** (Task 19, 2026-08-09): re-checked against the current
    (post-M10-restyle) tree and this is no longer "a couple of places" — it's
    now used in 10+ files (`form-field.tsx`, `banner.tsx`, `badge.tsx`,
    `NextTripHero.tsx`, `PlaybooksStrip.tsx`, `LocationInput.tsx`,
    `ActivityEditor.tsx`, `PlaybookCard.tsx`, `KeepDayFlag.tsx`,
    `EmptyChip.tsx`, `TimelineLens.tsx`, `app/page.tsx`), mostly as static
    `Record<AccentFamily, string>` tone-lookup tables — a legitimate,
    repo-wide convention for accent/tone lookups now, not a stray
    inconsistency. Centralizing it into a `Text` variant would be a
    cross-cutting refactor of 10+ files, out of proportion to a cosmetic nit.
    Left open; revisit if a `Text`-variant-based tone system is designed
    deliberately rather than as a side effect of this cleanup.
  - ~~`Board.tsx` carries an unspecified `items-start` on its flex layout~~ —
    **CLOSED BY RESTYLE** (Task 19, 2026-08-09): Task 11's M10 restyle
    rewrote `Board.tsx`'s flex layout; `items-start` no longer appears
    anywhere in the file.
  - ~~Near-duplicate link-button `className` strings across 3 lens files
    (DRY)~~ — **CLOSED BY RESTYLE** (Task 19, 2026-08-09): the M10 restyle
    removed every `<Link>` from `apps/web/src/components/lenses/*.tsx`
    (confirmed via grep) — the surface this applied to no longer exists.
- **First noted:** 2026-07-11/12 (M5 Wave 1/2). **Partially resolved:**
  2026-08-09 (Task 19) — the `text-danger-ink` bullet stays open by
  deliberate re-defer; everything else above is fixed or closed by restyle.

### KI-5 — Optimistic commands can be silently lost on abrupt navigation before the send queue drains
- **Severity:** correctness (data loss, no error surfaced)
- **Area:** `apps/web/src/components/trip/context/TripProvider.tsx` /
  `optimistic.ts` (M6's optimistic-update overlay + sequential send queue)
- **Symptom:** every trip-mutating command now applies to the UI instantly
  (client-side prediction) while the real persist happens in the background,
  one command at a time. If the user (or a script) fires several commands in
  quick succession and then navigates away, reloads, or closes the tab
  **before the queue has drained**, every command still queued behind the one
  currently in flight is silently dropped from the server's event log — with
  no error, no warning, and no visual difference from a fully-persisted state
  (the UI already showed everything as "done"). Root-caused by reproducing a
  CI-only e2e failure (`m2-history.spec.ts`, initially misdiagnosed as a
  narrower pre-existing reload/in-flight-request race — see below): throttling
  the commands endpoint by 400ms and replaying the spec's rapid drag+dismiss
  sequence deterministically reproduced the loss — after `page.reload()`, the
  persisted history contained **only the very first command** of six; the
  other five (two `AddActivity`, two `MoveActivity`, one `DismissConflict`)
  never reached the server at all.
- **Not a data-integrity violation of the event log itself** (Invariant 1
  holds — nothing partially-written, nothing corrupted; commands that never
  arrive simply never get an event) but is a real UX/correctness gap: the
  optimistic overlay gives no user-visible signal that unconfirmed work exists
  before a destructive-to-in-memory-state action (navigation, reload, tab
  close), unlike e.g. a native app's "unsaved changes" prompt.
- **The e2e test symptom is fixed** in this same change
  (`apps/web/e2e/m2-history.spec.ts` now waits for each mutating action's
  confirming response before proceeding, matching the pattern already used in
  `m6-optimistic.spec.ts`), so the CI flake itself is resolved. This entry
  tracks the underlying **product** risk, which is not fixed.
- **Fix path (not yet built; Mitchell's direction, 2026-07-20):** favor a
  synced/caught-up UI indicator over blocking navigation — surface `pending`
  (already exposed on `useTrip()`) as a visible "syncing…" / "all changes
  saved" affordance so the user can SEE when it's safe to navigate away,
  rather than a `beforeunload` prompt or forced queue flush. Worth deciding
  alongside M13 (collaboration), where concurrent multi-actor writes make
  silent client-side loss more consequential.
- **M8 (Task C4) landed the first half of the fix path:** `TripHeader` now
  renders a `SyncIndicator` (`role="status"`, "Saving…" / "All changes
  saved") fed from `useTrip().pending`, so unconfirmed work is visible before
  the user navigates away. Deliberately no `beforeunload` guard — that was
  never the recorded direction. **The underlying silent-drop-on-navigation
  risk is still open**: the indicator makes the risk visible, it doesn't
  close it, and it remains real for anyone who navigates away without
  reading it. Revisit alongside M13, where concurrent multi-actor writes
  make the silent loss more consequential.
- **This entry is the hub for one queue with several triggers. Trigger ledger, reconciled 2026-08-28** — read it before describing any of these as live:
  | Trigger | State |
  |---|---|
  | Navigating away / reloading / closing the tab with work queued | **Open — this entry.** The queue is in memory and nothing persists it. |
  | A send that *resolves* failed (`failHead` emptied the queue) | **Resolved 2026-08-25** — KI-36. The queue is retained and a manual retry is offered. |
  | `confirmHead` dropping units that no longer re-predict on a *successful* send | **Resolved 2026-08-28** — KI-42 (PR #73). |
  | A send that *rejects* (offline, DNS) wedging the sender for the life of the page | **Resolved 2026-08-28.** All 24 fetching helpers in `apiClient.ts` are total, the sender's `inFlight` reset moved into a `finally`, and a throw is converted into the `{ok:false}` the retry machinery already handles. |
  | `applyOutcome` clearing a non-empty queue from an ungated caller — inserting a saved day, asking the assistant | **Resolved 2026-08-28.** Both callers gate their own affordance: the saved-day button disables while unsent work exists, and the assistant refuses with a reason rather than silently doing nothing. |
  | A history command dispatched in the same tick as an accepted enqueue | **Open — KI-70.** `dispatch` still tests the render-time `pending` where `runDispatch` tests `optimisticRef.current`. |
  | A unit queued after a KI-42 retention previewing over a base that skips the retained work | **Open — KI-55**, and no work is lost: the preview is wrong, the queue is not. |
- **What is left of the original framing:** two open triggers (this one and KI-70) plus one preview-only inaccuracy (KI-55). Everything else on the list above is closed, so "the optimistic queue loses work on N different triggers" is no longer an accurate summary of the register — it is now one persistence gap and one same-tick race.
- **First noted:** 2026-07-20 (M6, post-merge CI investigation).

### KI-9 — AI model outputs are validated ad hoc per call site, not via one typed gateway boundary
- **Severity:** cleanup (defensive; no known reachable bug today)
- **Area:** `apps/web/src/server/ai/{gateway,handleAiRequest,planningTools,pageTools}.ts`
- **Background:** every point where model output crosses into our system is meant to be *parsed, not trusted* — and today each does so, but in a different place and shape: tool arguments are validated by the AI SDK against each tool's derived `inputSchema`; assembled commands are parsed by `collect()` (KI-8) and re-parsed by `executeTripCommandBatch`'s `BatchBody.safeParse`; `compose_page` output is checked by `validateComposedPage`; the board/combined user-facing `message` is server-derived (`summarizeBatch`), never taken from the model. It works, but the "parse at the boundary" invariant is a convention spread across call sites rather than something the type system *forces* — a future call site could consume a model result without a schema and nothing would catch it.
- **Deferred fix (agreed 2026-07-24, Mitchell):** introduce a single typed gateway wrapper around `generateText`/`generateObject` that *requires* an output schema and returns a `Result<T, GatewayError>`, so no model call can be consumed un-parsed; use `generateObject`/`experimental_output` where the final free-text answer itself should be schema-constrained. Keep the two invariants that already do the work (executors typed `input: unknown` to force the parse; the exhaustive `decideTripCommand` switch with no `default:`) and document them as such. This is the generalized, type-enforced version of the per-field KI-8 fixes; scoped out of the KI-8 PR deliberately to keep it small.
- **First noted:** 2026-07-24 (raised while fixing KI-8).

### KI-10 — AI batches don't recover a reference to an activity created later in the same batch
- **Severity:** correctness (a valid same-batch reference gets dropped; reported via `resolutionErrors`, not silent — no data corruption)
- **Area:** `apps/web/src/server/ai/batchResolver.ts` (`orderIntents`, `resolveBatch`, `causeIndex`/`droppedTitles`)
- **Symptom:** if the model emits `UpdateActivity{activityRef:"Museum"}` *before* the `AddActivity` that creates "Museum", the update is dropped with `No activity named "Museum"`. Day refs do not have this problem — `AddDay` intents are hoisted to the front of the batch (`batchResolver.ts`, `orderIntents`).
- **Why it isn't fixed:** hoisting works for days because `evolveTrip` appends them (`evolve.ts`), so moving every `AddDay` to the front — relative order preserved — provably cannot renumber a ref to a pre-existing day. Activities have no such property: hoisting an `AddActivity` changes which activity a later title ref resolves to, and its day/position placement depends on the state where it was emitted. The two general repairs were both evaluated and rejected:
  - *A fixpoint retry loop ("keep looping until nothing new resolves").* It terminates, but a command that fails in pass 1 and succeeds in pass 2 is applied **after** commands emitted later than it, so its positional `"day 2"` resolves against a state that already includes those later effects — the silent-retarget bug, relocated to the retry path. It also requires classifying every domain rejection code as retryable or terminal inside the AI layer: a new hard coupling to `decide.ts` and a prime drift site.
  - *Phase ordering (trip → day → activity).* It globally reorders, forcing `RemoveDay{day 1}` ahead of an `AddActivity{dayRef:"day 2"}` the model emitted first — promoting the silent-retarget bug to a design rule. It also leaves `AddDay`-vs-`RemoveDay` order within the day phase undefined (changing what numbers new days get), makes `MoveActivity` position indices meaningless once moves are grouped away from the adds that populate the day, and still does not fix same-tier dependencies (an `UpdateActivity` referencing an activity added in the same batch is activity-level on both ends).

  Both rejected approaches are pinned by failing-under-them regression tests — `batchResolver.test.ts`'s "rejected orderings stay rejected" block records the decision in executable form.
- **Mitigation:** the system prompt tells the model to create before referencing, the drop is reported in `resolutionErrors`, and a cascaded drop names its causing command via `causeIndex`.
- **Related:** the `causeIndex`/`droppedTitles` cause-naming mechanism itself (`batchResolver.ts`, added while auditing Task 8) has a narrower same-area gap: `droppedTitles` records a title the first time a command referencing or setting it is dropped, but nothing ever removes an entry once recorded. If a later command in the *same batch* legitimately (re)creates that exact title and succeeds, the stale map entry survives, so a *subsequent* unrelated failure that happens to reference the same title text would still be explained as caused by the original (now-irrelevant) drop. This never corrupts data or breaks atomicity — each command is still resolved/dropped independently and correctly — it only means the explanatory parenthetical appended to `resolutionErrors[].message` could occasionally cite a stale cause. Same theme as the entry above (same-batch reference tracking has known limits); not worth a separate KI.
- **First noted:** 2026-07-25 (gap review of the committed `resolveBatch`).

### KI-11 — No AI test ever calls a real model, so the "real model ≠ mock" bug class is invisible to CI
- **Severity:** reliability (no failing behavior today; the gap is in what CI *can* detect)
- **Area:** `apps/web/src/app/api/trips/[tripId]/ai/route.int.test.ts` (every test injects `MockLanguageModelV4`), `apps/web/src/server/ai/*`
- **Symptom:** the AI suite has been green through **seven** consecutive real-world AI failures (2026-07-21 → 07-26): an envelope missing ids so the model emitted zero tool calls; three separate verbatim-UUID/format classes (KI-8); a no-op sub-command aborting a whole batch; same-batch day refs resolving against pre-batch state; an append-only projection missing removals/moves; and the `MAX_STEPS` truncation fixed in `e9fe19b`. Each was found by Mitchell manually prompting the deployed build, never by a test.
- **Why it happens:** `MockLanguageModelV4` is a scripted `doGenerate` — by construction it emits well-formed tool calls, emits them exactly when told, and stops when told. Real models do none of these reliably: they invent or mangle ids, choose wrong formats, emit redundant commands, split work across many steps, and run past a step budget. A mock validates *our* code path given well-formed input; it cannot generate the malformed input that has caused every actual bug. This is a structural limit, not a missing assertion — no amount of additional mocked tests closes it.
- **Why it isn't fixed:** a live-gateway test costs money per run, is non-deterministic (so it can't gate CI on equality), and needs `AI_GATEWAY_API_KEY` in CI. The M7 exit gate's **"AI demo"** box was checked with an explicit waiver on exactly these grounds — honestly recorded, and it is the one waived criterion that would have caught all seven.
- **Mitigation:** the `meta` envelope (`handleAiRequest.ts` `AiCallMeta`) is the substitute and has diagnosed every one of these — **keep it and extend it, don't trim it for token cost.** After any AI-layer change, run a live prompt and read `meta`: `steps` at exactly `MAX_STEPS` **plus** `finishReason: "tool-calls"` (now `meta.truncated`) means truncation; `toolCalls` empty means the model refused the tool surface; `resolutionErrors` non-empty means refs failed. **A run ending at exactly the configured ceiling is a budget problem until proven otherwise** — that signature appeared twice five days apart and was misread the first time as weak-model over-generation.
- **Possible real fix (unscoped):** a small non-CI harness that replays a fixed prompt set against several gateway models and records the `meta` we already emit — overlaps the "best model for my buck" item in `TODO.md`, which would supply the same infrastructure.
- **First noted:** 2026-07-26 (M7 post-gate retro).

### KI-12 — The AI cannot name a trip or set its dates, so "plan me a trip" can't produce a complete one
- **Severity:** correctness (product gap — the headline AI flow cannot finish the job it advertises)
- **Area:** `packages/contracts/src/trip.ts` (`BatchableCommand` union), `apps/web/src/server/ai/handleAiRequest.ts` (system prompt)
- **Symptom:** prompting "Create a 7 day itinerary for Rochester NY…" on a new trip yields days and activities but leaves the trip called **"New TRip"** with `startDate: null`. There is no `SetTripName` command anywhere in the contract — renaming is UI-only — so no tool for it can be derived (ADR-015 / Invariant 5: tool schemas are *derived*, never hand-written). `SetTripStartDate` *is* batchable and *is* exposed, but the model never calls it unprompted.
- **Why it isn't fixed:** the two halves need different work and a product decision. Naming needs a new `SetTripName` command through the full pipeline (command + event + `decideTripCommand`/`evolveTrip` + contracts changelog) — small but a genuine contract change, and it's worth deciding first whether an AI should silently rename a trip the user already named. Dates need only a prompt nudge, but "7 days starting when?" has no answer without asking the user, and the AI surface has no clarification round-trip.
- **Mitigation:** none today — the user renames and sets dates by hand after generation.
- **First noted:** 2026-07-26 (live test of the `MAX_STEPS` fix).

### KI-15 — AI-planned locations are still model guesses, not cited facts
- **Severity:** correctness (downgraded 2026-08-06 — silent corruption fixed, the guess remains)
- **Area:** `apps/web/src/server/ai/geocodeEnrichment.ts`
- **Fixed on 2026-08-06, before PR #21 merged:** `enrichCommandLocations`/`resolveOne`
  no longer relocate a correctly-placed activity. Every lookup is biased with a
  viewbox toward what we already believe — the model's own plausible
  coordinates as a tight (50 km) hint, else a region drawn from the trip's
  existing activities (150 km margin), else, on a brand-new trip with neither,
  the coordinates already accepted earlier in the same batch (`anchors`,
  bootstrapped as lookups resolve) — and a result is kept only if it agrees
  with that belief (within `MAX_REFINE_KM`, 50 km, of a hint, or inside the
  region's box); disagreement means the model's original guess is kept as-is —
  its own coordinates when it had a hint, or just the bare name when it had
  none to begin with — and the place is reported `unverified`, never silently
  overwritten.
  A Shropshire match against a Niagara Falls hint is now rejected on distance
  alone. Lookups are serialized through `mapRateLimited` at LocationIQ's real
  2 req/sec instead of a `Promise.all` burst, so a 9-name batch no longer 429s
  itself into coordinate-less locations. The response carries a
  `locationReport` (`verified`/`unverified`/`unchecked`/`failed`/`skipped`),
  and `handleAiRequest.ts`'s `locationNotice` names up to three unverified,
  failed, or skipped places in the reply message instead of reporting success
  either way — `unchecked` (accepted with nothing yet to check it against,
  which is the common case on the very first lookup of a freshly planned trip)
  is deliberately excluded from the message to avoid training the user to
  ignore it, but stays in the payload.
- **What is still open:** the model still *guesses* the coordinate, and a guess
  that happens to agree with a fuzzy string match is still reported as
  "verified" — enrichment can refine a location, it cannot confirm one is
  real. The acceptance thresholds (`MAX_REFINE_KM` 50 km, trip margin 150 km,
  hint margin 50 km) are heuristics chosen from one dogfood run, not measured
  against a corpus. `boundingBoxAround` does not handle the antimeridian — a
  Pacific-spanning trip degrades to no useful bias (fails safe, not wrong;
  left deliberately unfixed). And the first lookup on a trip with no geocoded
  activities is still `unchecked` by construction: the batch has no region
  until something resolves, so a wrong first answer both survives and becomes
  the anchor the rest of the batch is checked against. Ordering lookups by how
  reliably they geocode would help; M9's grounding removes the problem
  instead.
  A final whole-branch review (2026-08-06, before merge) found and fixed a
  sharper version of the same problem — a model hint was never checked against
  an available trip region at all, so a wrong-but-plausible hint could be
  reported `verified` and permanently widen `tripRegionOf`'s box on every later
  request for that trip (`resolveOne` now requires agreement with *every*
  belief in play, not just the strongest one — see the `hintTrusted` logic and
  its comment in `geocodeEnrichment.ts`) — and a dedupe bug where two commands
  sharing a place name but carrying different coordinates could have one's
  location silently stamped onto the other on the fallback path (fixed:
  `unverified`/`failed` now rebuild each command's location from its own
  input, never a name-sibling's). That second review left three narrower,
  accepted residuals rather than blocking on them:
  1. The dedupe fix only covers the fallback path — on the **`verified`**
     path, one command's hint still drives the shared lookup and its match is
     still applied to every command sharing the name, so a second command's
     own distinct coordinates can still be silently discarded (bounded: the
     shared match must fall inside the trip region if one exists, so it can't
     relocate the second command arbitrarily far, only to the first's place).
  2. A geographically spread trip (e.g. adding a Venice day to a Rome-only
     trip) now costs more `unverified` reports than before: a genuine hint for
     the distant leg is untrusted against the established region, so the
     whole leg's activities lose the `verified` status they'd have gotten
     pre-fix. Fails safe (coordinates kept, user told) but is a real,
     user-visible behavior change worth knowing about before it's rediscovered
     as a support question.
  3. The monotonic-widening guarantee is narrower than "no bad location can
     widen the region" — it only bounds the *silent* (`verified`, no notice)
     path. An `unverified` fallback is still a raw, unvalidated model guess,
     and it still gets persisted and still feeds `tripRegionOf` on the
     next request exactly as much as a verified one would; the fix makes that
     widening *announced* (via `locationNotice`) rather than eliminating it.
- **Fix path:** M9, "Grounding". The model cites a `placeRef` from a real
  `SearchPlaces` result, so there is nothing to overwrite and nothing to
  guess; enrichment survives only as a fallback for user-typed text.
- **The prompt, verbatim** (kept exactly as typed so it can be replayed as M9's grounding regression test):
  > Plan a 3 day trip to Rochester ny, One day visiting the falls in Niagara, and another visiting the strong museum of place in rochester. Find and add lunch and dinner restaurants for each day near those locations
- **Symptom (live run, 2026-08-02, trip `13fc0d33`):** of 9 activity locations, **2 were geocoded, 1 of those wrongly, and 7 came back with no coordinates at all** — including "Niagara Falls State Park", which resolves trivially. "Dinner at The Red Coach Inn" was persisted at **`lat 52.907918, lng -2.8901` — "The Red Lion Coaching Inn, Shropshire, England"**, ~5,500 km from the trip. Nothing in the response distinguishes a verified place from an unverified one.
- **Two independent causes, both in `geocodeOne`/`enrichCommandLocations`:**
  1. **Unconditional top-match overwrite.** `geocodeOne` takes `forward(name, { limit: 1 })[0]` with **no viewbox, no region bias, and no acceptance test**, then the caller replaces the command's `location` with it. In the Red Coach Inn case the model had supplied **correct** coordinates (`43.0866, -79.0628` — Niagara Falls, NY, visible in `meta.toolCalls`); enrichment discarded a right answer for a fuzzy string match on another continent. The "canonical name REPLACES the model's raw name" rule was lifted from the manual `LocationInput.tsx` flow, where **a human picks from candidates** — that human is the part that didn't survive the port.
  2. **Parallel burst against a 2 req/sec vendor.** `enrichCommandLocations` fires every unique name concurrently via `Promise.all`. **LocationIQ's free tier is 5,000/day but rate-limited to 2 requests/second**, so a 9-name batch 429s on most of them; `forward` throws on `!res.ok`, and `geocodeOne`'s bare `catch { return { name } }` swallows every one into a coordinate-less `Location` indistinguishable from "this place does not exist". The dedupe/parallelism was written as a free-tier *saving* (daily cap) and is counterproductive against the *per-second* limit that actually binds.
- **First noted:** 2026-08-02 (Mitchell, M8 dogfooding — trip `13fc0d33`).

### KI-22 — The AI response envelope is not in `packages/contracts`
- **Severity:** cleanup
- **Area:** `apps/web/src/server/ai/handleAiRequest.ts`, `apps/web/src/lib/apiClient.ts`
- The `/api/trips/:id/ai` response (`message`, `meta`, `simulated`,
  `resolvedCommands`, `resolutionErrors`, `locationReport`) is assembled ad hoc
  in the handler and parsed loosely by the client — `message` and `simulated`
  are read with `typeof` / `=== true` guards rather than through a schema. This
  sits against Invariant 5 ("contracts change by protocol, not by drift"): the
  envelope is a cross-boundary type that lives in neither `packages/contracts`
  nor the contracts changelog. It surfaced while adding `simulated`
  (2026-08-19), which needed no changelog entry precisely because there is no
  contract to change. Fixing it means schematizing the whole envelope and
  routing both AI client functions through it.

### KI-24 — `AI_LIVE` on Vercel is warned-about, not prevented
- **Severity:** cleanup (defense-in-depth, not a live bypass)
- **Area:** `apps/web/src/server/ai/modelSelection.ts`
- "Never set `AI_LIVE` in a Vercel environment" is documented in
  `.env.example`, `docs/guidelines/environments-and-deploys.md`, ADR-019, and
  `modelSelection.ts`'s own comment — but the only enforcement is a
  module-load `console.warn` when `process.env.VERCEL && process.env.AI_LIVE
  !== undefined`. If `AI_LIVE=true` were ever actually set on Vercel, it would
  still fully override the `ai-live` flag (and the dashboard/Toolbar controls
  built around it) with only a log line as evidence. A stronger fix — making
  `AI_LIVE` inert on Vercel, so it can only force *simulated*, never *live* —
  was deliberately not applied during the 2026-08-19 branch's final review:
  it trades away an emergency escape hatch (a way to force AI on from a
  Vercel env if the Flags product itself misbehaves) that the project owner
  may want to keep. Recorded here as an open decision rather than a bug;
  revisit if `AI_LIVE` is ever set on Vercel by accident, or if Mitchell
  decides the escape hatch isn't worth the risk.


### KI-34 — `TripSummary` has no start date, so "next trip" and trip-card dates are approximations
- **Severity:** correctness (the "next trip" selection — see below — can genuinely surface the wrong trip, not just an approximate date) / cosmetic (the `createdAt` display fallback). Split rather than a single label, per CodeRabbit's review of PR #35: the two consequences below are not the same class of problem.
- **Area:** `packages/contracts/src/trip.ts`, `apps/web/src/app/page.tsx`, `apps/web/src/components/home/NextTripHero.tsx`, `apps/web/src/components/home/TripCard.tsx`
- **Symptom:** `TripSummary` (what `/api/trips` returns for the whole list) carries no start/end date field at all — only `createdAt`, an instant recording when the trip record was made, not when it happens. Two consequences, deliberately not the same severity:
  - **Correctness:** `page.tsx`'s `nextTrip` is `visibleTrips[0]`, the first trip in the list order the API returns, not the true next-upcoming-by-date trip — there is no date to sort by. If `/api/trips`'s order is ever not chronological (nothing in the contract guarantees it is), the hero can present a genuinely wrong trip as "next", not merely an approximate date on the right one.
  - **Cosmetic:** `TripCard` shows `Created {date}` (derived from `createdAt`) in the slot the design's trip card uses for the trip's actual dates; `NextTripHero`'s meta row does the same when its own `TripDetail` fetch (which does carry a real `startDate`) hasn't resolved yet or the trip has none set. The trip shown is still the right one here — only its displayed date is an approximation.
- **Why it's not fixed here:** the real fix is a contract change — adding a start date (or a denormalized "sort key" date) to `TripSummary` — which M10 Wave 2's Phase 8 (Task 8.5 — plan deleted at M10's gate close, see `docs/milestones/M10-visual-craft.md`'s "Wave 2 scope") explicitly ruled out of scope: it is presentational-only, no `packages/contracts` growth. Fabricating a placeholder date on the card instead of the honest `createdAt` label would be worse than the current approximation, not better, so neither `nextTrip`'s selection nor `TripCard`'s date line changed for this task.
- **Fix path:** add a start date to `TripSummary`, then swap `nextTrip` to a real date-sort and `TripCard`'s date line to that field, the same way `NextTripHero` already prefers its real `TripDetail.startDate` over `createdAt` once that fetch resolves.
- **First noted:** 2026-08-24 (M10 Wave 2 Phase 8, Task 8.5).


### KI-46 — Below ~1100px the app is the desktop layout, not the designed mobile companion

- **Severity:** cosmetic (unusable rather than wrong — nothing is lost, but the
  trip header alone exceeds the viewport)
- **Area:** `apps/web/src/components/trip/TripHeader.tsx`,
  `TripMetaPill.tsx`, `lenses/TimelineLens.tsx`, `AppHeader.tsx`
- **Symptom (measured at 402×844):** the trip header consumes ~1130px of an
  844px viewport before any plan content — the meta pill wraps
  `Sat, Sep 5 – Fri, Sep 18` across five lines inside its rounded pill, and the
  title wraps to two lines at unreduced desktop size. Stop cards collapse: the
  title wraps, the right-hand cost column crushes into it, and `Ask`/`Edit`
  overlap the note box. All four lenses are still offered. At **1100×800 the
  app is fine** — the header cluster reflows to a single row and the timeline
  reads well — so the gap is entirely between those two widths.
- **Scope note:** the handoff's `Trip Planner Mobile.dc.html` + SPEC §10 design
  a *different* product (two lenses not four, a pinned day-rail spine, a bottom
  tab bar, a tag filter row, 44px targets, cards without the 92px time gutter).
  **Building that is a milestone, not a fix.** This entry is only the narrower
  claim that the current small-screen rendering is broken enough to be worth
  recording independently of whether the designed companion ever gets built.
- **Cross-reference:** KI-19 (the 1180px blind spot the `narrow` Playwright
  project exists to cover — it runs at 1100px, above this).
- **First noted:** 2026-08-26 (design-sync UI audit, C2).

### KI-48 — Small design-audit cosmetics (2026-08-26)

- **Severity:** cosmetic
- **Area:** `apps/web/src` (various)
- Collected small findings from the 2026-08-26 design-sync UI audit. Each is
  one file; none is worth its own entry.
  - **`1 travellers`** — `TripMetaPill.tsx:42,58` interpolates
    `detail.members.length` against a hardcoded plural, in both the visible
    label and the `aria-label`. Every solo trip's header reads
    ungrammatically. `NextTripHero.tsx:186` already does this correctly.
    Note SPEC §8 says travelers should come **off** this pill entirely, which
    would dispose of this instead of fixing it — settle that first.
  - **Three empty states for one empty day** — a day with no stops renders the
    design's `route` fallback ("No stops yet — add one, or drop a saved day
    onto it"), *then* "Nothing planned yet", *then* "Add the first stop"
    (`TimelineLens.tsx`; reproduce on the Rochester seed's Day 3). The design
    has one line and one button.
  - **The day-chip rail clips its last chip mid-card** at 1440px with no
    scroll affordance (`DayChips.tsx`) — reads as a rendering error rather
    than as "scroll me". `MapRail`'s gearing already solves this shape.
  - **The account menu renders an empty line** where the email goes, for
    dev-login users, who have none (`AccountMenu.tsx:92-99`). Preview-only,
    but it is in every preview review screenshot.
  - **Trip settings' date editor covers "Total for the trip".** The Popover
    is deliberate (`SettingsSheet.tsx:59` — the read-only dates row opens
    `TripDateControl` in one), but it opens downward over the budget input
    rather than expanding inline the way the design's row does. The editor
    itself is otherwise an exact match to SPEC §3, hint copy included.
  - **The signed-out home page renders `AppHeader`'s `Trips` and `Playbooks`
    nav** — links into authenticated routes shown to a signed-out visitor
    (`app/layout.tsx` mounts `AppHeader` unconditionally; `app/page.tsx`'s
    `unauthenticated` branch renders beneath it). The design's landing header
    carries only the logo and `Sign in` / `Start a trip`.
- **First noted:** 2026-08-26 (design-sync UI audit, A4/A6/A7/A8/B14/C3).

### KI-49 — The Map lens cannot be visually verified in a cloud session: the egress proxy blocks the tile host
- **Severity:** process/verification (no user-facing defect; it removes a whole lens from local review)
- **Area:** `MapLens` / MapLibre's tile fetches to `tiles.openfreemap.org`; the Claude Code remote container's agent proxy.
- **Symptom:** in a cloud session the Map lens renders its **chrome** — day rail, focus card, legend, leg labels — over a **blank canvas**, because MapLibre's tile requests to `tiles.openfreemap.org` do not survive the container's egress proxy. Nothing errors visibly; the map simply has no basemap under it.
- **Why it matters more than it looks:** a blank canvas is easy to read as "the map is fine, the tiles are just slow", so a local pass on map work is not evidence and can be reported as one. The 2026-08-26 design audit covered every other route × lens × overlay at three widths and had to record the Map lens as **the one surface it could not look at**.
- **What this blocks:** any verification of map *rendering* — the day rail's restoration (design rule R2), leg geometry, marker placement, and anything about the basemap itself. Map **logic** is unaffected and stays testable: `mapRailData.ts` and friends are pure and unit-tested, which is where map assertions belong regardless.
- **Working practice until it changes:** verify map work on the **Vercel preview**, and say so explicitly. A local "looks fine" about the Map lens is not a claim anyone should accept, including from yourself — see `docs/guidelines/cloud-agent-sessions.md`.
- **Widened 2026-08-28 (M11's exit gate), and not in the direction anyone expected.** The gate ran from a laptop, not a cloud session, so this entry's proxy did not apply — and the map still could not be visually confirmed. On the preview's `/demo?lens=Map`: the tile **transport** verifies (the `positron` style, the `planet` tilejson, both sprite files and four glyph ranges all loaded from `tiles.openfreemap.org`; a same-context `fetch` of the style returned 200; WebGL is real — ANGLE / Apple M1 Max; the canvas is mounted at 1280x629). The **pixels** do not: the WebGL canvas comes back blank in the screenshot pipeline, and MapLibre requests its data tiles from a worker, whose fetches never appear in the main thread's `performance` resource timeline — so their absence from that list is not evidence in either direction.
- **The practical consequence:** "verify map work on the Vercel preview" is necessary but was **not sufficient** here. Neither environment has yet produced a picture of a rendered basemap. Whatever else changes, the rule this entry exists for is unchanged and now has a second supporting case: **a blank canvas is not a pass, and saying which half you verified — transport or pixels — is the whole point.**
- **Not yet investigated:** whether the tile host can be allowed through the proxy for cloud sessions; whether a locally-served offline tile fixture would be worth it for e2e; and, new as of the above, whether a screenshot pipeline that captures WebGL (`preserveDrawingBuffer`, or a headless Chromium screenshot taken outside this browser tooling) would close the pixels half from a laptop. None has been attempted; this entry exists so the choice is made deliberately rather than rediscovered by the next agent to touch the map.
- **First noted:** 2026-08-26 (design-sync UI audit; recorded after the audit shipped, PR #55 retrospective).

### KI-50 — Google sign-in can't be verified on a preview deployment without hand-registering each branch's redirect URI
- **Severity:** cleanup (no user impact in production; blocks a verification workflow)
- **Area:** `apps/web/src/server/auth.ts`, the Vercel Preview environment, and
  the Google Cloud OAuth client's Authorized redirect URIs.
- **Symptom (2026-08-26, M15 gate check on PR #56):** signing in with Google on
  a preview deployment fails. Google requires the redirect URI to match a
  registered value **exactly** and supports no wildcards, so Auth.js's callback
  — `https://<host>/api/auth/callback/google`, built from the request host —
  is rejected on any host that has not been registered by hand.
- **Not what it looks like:** the preview host is *not* unstable. Vercel gives
  each branch a durable alias (`travel-collab-git-<branch>-<team>.vercel.app`)
  that survives every push to that branch, so registering it works and keeps
  working. The cost is **per branch**, not per deployment.
- **Workaround in use:** register the branch alias's callback URI in the Google
  Cloud OAuth client (APIs & Services → Credentials → the Web application
  client matching `AUTH_GOOGLE_ID` → Authorized redirect URIs). Done for
  `claude/subagent-three-pages-plan-cd88a4` on 2026-08-26 to close M15's gate.
  Every future branch that needs a real Google sign-in pays the same two
  minutes, and the list accumulates dead entries as branches are deleted.
- **Fix path — Auth.js's redirect proxy.** `@auth/core@0.41.3` (what
  `next-auth@5.0.0-beta.32` resolves to) supports `AUTH_REDIRECT_PROXY_URL`
  (`lib/utils/env.js:39`, `lib/init.js:41-47`). Set it on the **Preview**
  environment to the canonical production auth URL
  (`https://<production-domain>/api/auth`) and register **only** that one URI
  with Google. Auth.js then sends Google the canonical redirect URI, and the
  deployment whose own origin matches `redirectProxyUrl` (`init.js:43-44` sets
  `isOnRedirectProxy`) forwards the session back to the originating preview.
  One registration covers every preview, forever.
- **Preconditions before attempting it:** production must already have a
  working Google OAuth client, and `AUTH_SECRET` must be identical across the
  Production and Preview environments — the proxy forwards signed state
  between the two deployments, so a mismatch fails closed. Note also that
  Vercel Deployment Protection is enabled on previews (a request to
  `/api/auth/providers` 302s to `vercel.com/sso-api`), so the OAuth callback
  only survives in a browser already authenticated to Vercel SSO; worth
  confirming that interaction when the proxy is wired up. Updated 2026-08-29:
  "authenticated to Vercel SSO" is no longer the only way in — a share link or
  the automation bypass secret both set a cookie that carries the whole
  browsing session, so the callback has a second route through. See
  `docs/guidelines/environments-and-deploys.md`, "Testing against a preview
  deployment". Still unconfirmed either way.
- **Why deferred:** the workaround unblocks M15's gate today, and the proxy
  touches production auth configuration — not something to change while a
  milestone gate is mid-verification. Mitchell's call, 2026-08-26.

### KI-52 — The tag chip row ships four tags where the handoff designs six

- **Severity:** cleanup (a recorded design delta, not a defect)
- **Area:** `packages/contracts/src/activity.ts` (`ActivityTag`),
  `.design-sync/handoff/design/Trip Planner Redesign.dc.html` (its `TAGS` array)
- **What differs:** the handoff defines six tags — `considering`, `meal`,
  `lodging`, `travel`, `ticketed`, `outdoors` — each with a "power" (a
  behaviour the tag unlocks). M18 shipped `ActivityTag` with **four**:
  `meal | lodging | ticketed | outdoors`.
- **Why:** `considering` and `travel` restate `ActivityKind`'s `idea` and
  `transit`. Making both settable and independent lets a stop be
  `kind: "booked"` **and** tagged `considering`, which the design says should
  render dashed with its cost outside the committed total — under a "Booked"
  badge. No surface owns that contradiction, and nothing in the build wants it.
  The handoff's own prototype never stores those two either: it *derives* them
  (`if (a[6] === 'idea') out.push('considering')`), which is the same
  observation arriving from the other direction. Mitchell's call, 2026-08-27.
- **What this costs:** the designed chip row and the Add/Edit tag picker show
  six chips; the build will show four. Any surface that wants "is this a maybe?"
  or "is this travel?" reads `kind`, not `tags`. Recorded here so the next
  design sync scores it as a settled delta rather than re-raising it as drift.
- **Not scheduled:** reopening it would mean either accepting the contradiction
  or deriving two read-only pseudo-tags in the projection. Neither is worth
  doing before the tag surfaces exist.
- **Cross-reference:** KI-47 (resolved — the `tags` field itself);
  the 2026-08-27 contracts changelog entry.
- **First noted:** 2026-08-27 (M18 contract PR).

## Resolved

### KI-56 — Below ~500px a long money figure wraps, so the KI-28 reserved slot grows and the menu drifts again — RESOLVED by reserving two lines below the width where the slot is wide enough for one
- **Severity (as filed):** reliability (the KI-28 defect, reintroduced at narrow widths only)
- **Area:** `apps/web/src/components/home/TripCard.tsx`, `apps/web/src/components/home/NextTripHero.tsx`
- **Reproduced in a real browser before fixing** — production build, Chromium, seeded trips, measuring the actual KI-28 invariant (card height with the slot EMPTY, as before its `TripDetail` resolves, against the height once the line lands):
  ```
  viewport 341px   hero  slot 222px   reserved 20 -> withReal 40   card growth 20.0px
  viewport 341px   card  slot 246px   reserved 20 -> withLongJPY 40   card growth 20.0px
  ```
- **Worse than the entry recorded, in one specific way.** The entry framed this as a large-figure-currency problem ("JPY especially"). It is not: the hero grew 20px with the **real seeded USD line** `$9,085.00 planned of $16,400.00`, which wraps at a 222px slot. No exotic currency is needed to reach it.
- **The wrap is bounded at two lines, measured rather than assumed.** Slot height per slot WIDTH at 13px IBM Plex Mono (what `DataText size="sm"` actually resolves to — not 14px):
  ```
  slot width                            180 222 246 260 277 301+
  "$9,085.00 planned of $16,400.00"      40  40  20  20  20  20
  "¥1,234,567 planned of ¥5,000,000"     40  40  40  20  20  20
  "¥12,345,678 planned of ¥50,000,000"   40  40  40  40  20  20
  ```
  Nothing reaches three lines even at a 180px slot, far narrower than any reachable card — so `min-h-10` bounds the slot at every real width, not merely at the ones measured.
- **Fix (2026-08-29):** candidate **(2)** from this entry — reserve two lines at narrow widths, one where the slot is provably wide enough. `min-h-10 md:min-h-5` in TripCard, `min-h-10 sm:min-h-5` in NextTripHero.
- **The two breakpoints differ on purpose, and the first attempt got this wrong.** A trip card's slot does NOT widen monotonically with the viewport, because its grid is `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` — every extra column makes each card narrower again:
  ```
  viewport   341  500  640  1024  1440
  card slot   246  426  263   290   322
                        ^ sm: 2 cols   ^ lg: 3 cols
  ```
  So the slot is narrower at 640px (263) than at 500px (426). Shipping `sm:min-h-5` reintroduced the defect in a ~640-670px band — **caught by measuring the fix rather than by reading it**, and closed by moving that one component to `md`. The hero has no such band (222px at 341, 402px at 500, 542px at 640), so `sm` is correct there.
- **Verified after the fix, same method, six widths:** card growth **0.0px** for the real USD line, the entry's JPY line and a larger JPY line at **341, 500, 640, 768, 1024 and 1440px**, for both the hero and the card. 1440px is byte-identical to before (hero slot 523px, one line reserved), so desktop is untouched.
- **Accepted cost, stated rather than discovered later:** below the breakpoint the slot keeps 20px of blank space even when the line is short or absent. That is this candidate's known price. Candidate (1) `truncate` would render `planned of ¥5,00…` and hide the budget on the screens least able to recover it; candidate (3) (shortening the string in `lib/cost.ts`) is a product-visible choice about how money reads, and was deliberately left to be chosen rather than defaulted into. Per KI-46 there is no designed card below ~1100px yet, so the blank space sits where design will revisit it anyway.
- **Regression cover, added here rather than deferred.** `responsive.spec.ts` gains three narrow-viewport guards — the card at **320px** and **640px**, the hero at **360px** — each injecting a long money figure into the real rendered slot and asserting the surface's height does not move. **All three were confirmed RED against a deliberately reverted build (20.19px of growth each)**, which is the only reason they can be claimed as guards. Earlier drafts at 500px, 700px and 360px-for-the-card all PASSED against that same broken build — the slot is simply wide enough there — and were dropped for it; the widths that matter come from the measured slot-width table, not from the breakpoints. `m8-make-it-real.spec.ts`'s KI-28 guard at 1280px continues to pass.
- **Cross-reference:** KI-28 (resolved — this was the residue outside its measured bound), KI-46 (below ~1100px is undesigned).
- **First noted:** 2026-08-28 (KI sweep, PR #73 review). **Resolved:** 2026-08-29 (KI cluster).


### KI-73 — Two ISO-date parse mechanisms coexist, and they disagree on contract-valid input — RESOLVED, converged on the strict parse; the contracts half is now KI-77
- **Severity (as filed):** correctness, latent — unreachable only because `deriveDayDates` happened to normalise everything through one of the two mechanisms first
- **Area:** `packages/domain/src/trip/dates.ts`, `apps/web/src/lib/dates.ts`, `apps/web/src/components/lenses/calendarData.ts`
- **Reproduced before fixing, not inferred.** A probe running both mechanisms over the entry's own corpus, on input `TripDate` accepts:
  ```
  2026-13-45   Date.UTC -> 2027-02-14   template -> THROWS RangeError   *** DISAGREE ***
  0026-01-01   Date.UTC -> 1926-01-01   template -> 0026-01-01          *** DISAGREE ***
  2026-02-30   Date.UTC -> 2026-03-02   template -> THROWS RangeError   *** DISAGREE ***
  2026-01-32   Date.UTC -> 2026-02-01   template -> THROWS RangeError   *** DISAGREE ***
  2026-00-10   Date.UTC -> 2025-12-10   template -> THROWS RangeError   *** DISAGREE ***
  2026-01-01   Date.UTC -> 2026-01-01   template -> 2026-01-01          agree
  ```
  Two distinct defects, not one: `Date.UTC` silently ROLLS an impossible date over to a different real date, and it REMAPS a year below 100 (`Date.UTC(26, 0, 1)` is 1926).
- **There were three copies, not two.** The entry named the domain and `calendarData`'s `toUtcDate`; `calendarData` also already imported `addDaysIso` from `lib/dates.ts`, so it ran BOTH mechanisms in one function while its own comment asserted they agreed.
- **Fix (2026-08-29):** both surviving copies now run the same two steps in the same order — parse `` `${iso}T00:00:00Z` `` (explicit `Z`, so UTC on every host and no two-digit-year remapping), then compare the parsed UTC components back against the input's own digits and throw `RangeError` if they differ. `apps/web` is down to ONE parse: `lib/dates.ts` exports `parseIsoDateUtc`, and `calendarData.ts` imports it instead of carrying `toUtcDate`.
- **A fourth defect surfaced while fixing the third copy.** `calendarData`'s month arithmetic (`startOfMonth`/`endOfMonth`/`addMonths`) feeds `getUTCFullYear()` back into `Date.UTC`, which re-applies the two-digit-year remapping. Before the fix that was invisible because the cell parse threw the century away too; afterwards the file would have disagreed with ITSELF — cells in year 26, month headers reading 1926. A `utcFromParts` helper re-sets the year and keeps the intended month/day rollover. Pinned by a test asserting the header reads "January 26" while the cells start `0026-`.
- **The two copies must stay separate.** AGENTS.md's module map makes `apps/web/src/server/**` the only web code that may import `@tc/domain`, and this math is needed inside UI components, so neither side can import the other. A shared home is a module-map design call, deliberately not taken here.
- **What keeps them honest instead:** one corpus, duplicated verbatim, asserted on each side — `packages/domain/test/dates.equivalence.test.ts` and `apps/web/src/lib/dates.equivalence.test.ts`. **Proven to catch the defect, not assumed:** reverting `packages/domain/src/trip/dates.ts` to its pre-fix body turns the domain copy red with **19 failures**, including `expected [ '1926-01-01' ] to deeply equal [ '0026-01-01' ]` and `expected function to throw an error, but it didn't`. Restored, 193/193 pass.
- **Behaviour change, and the regression it nearly shipped.** `deriveDayDates` and `daySpan` now THROW on a calendrically impossible date where they used to return a silently different one — the direction `lib/dates.ts` already chose on 2026-08-28, trading persisted corruption for a loud failure with nothing written. **Review on PR #84 caught what that turned into downstream:** `SetTripStartDate` would still PERSIST such a date, and `deriveDayDates` then throws on every projection, so the trip becomes permanently unloadable — availability strictly worse than the silently-wrong dates it replaced. `decide.ts` now rejects a non-calendar date on both `SetTripStartDate` and `SetTripDates` (`invalid-dates`, via a new exported `isCalendarDate`), so the throw is unreachable through the command pipeline. The contract-level close is still **KI-77**.
- **A defect this fix introduced, and review caught.** `calendarData`'s `utcFromParts` originally re-set the year AFTER `Date.UTC` had already rolled a month into the next year, so `addMonths(Dec 0026, +1)` returned `0026-01-01` instead of `0027-01-01` — a month cursor moving BACKWARD, making `calendarMonths` non-terminating for any trip crossing a December in years 0-99. It now shifts out of the 0-99 window by a whole 400-year Gregorian cycle (identical leap/weekday behaviour) before constructing, and shifts back. Guarded by a test with a short timeout, because the pre-fix failure mode is a hang rather than a red assertion.
- **Verified:** `pnpm --filter @tc/domain test` 193/193; the three web date/lens unit files 58/58; `pnpm check` green; `pnpm test:int` 242/242 against a clean database; `pnpm --filter web test:e2e:ci-like` 46/46.
- **First noted:** 2026-08-28 (the §6.2 refactor). **Resolved:** 2026-08-29 (KI cluster).


### KI-64 — The trip header still greys out "Add stop" for a viewer while the rest of the board hides its write controls — RESOLVED, it is withheld like everything around it
- **Severity (as filed):** cosmetic (one inconsistent control; no wrong behaviour, nothing unreachable)
- **Area:** `apps/web/src/components/trip/TripHeader.tsx`
- **Symptom (as filed):** ADR-031 made a read-only board hide every affordance that writes, on the grounds that a greyed control still says "there is something here for you" and for a reader there is not. `TripHeader` was deliberately left alone and still rendered "Add stop" **disabled** — the one greyed control on an otherwise quiet page, most visibly on `/demo`.
- **The decision, since the entry says it is not obvious:** of the two fix paths it names — drop the button under `readOnly`, or split the flag by audience — the first was taken. It applies a rule this codebase has already written down three times (the nav row's own comment says the same sentence about itself, and Share and undo/redo two blocks away are absent rather than disabled) instead of inventing a new one. The second is a design decision: `readOnly` is one flag over two audiences (a member without the rank, and a stranger on `/demo`), and telling them apart is ADR-031's closing argument and the Travelers UI's business. That option is untouched and one prop away if Mitchell wants it; the "View only" badge is what still explains the quiet page in the meantime.
- **Verified in a real browser, both audiences, against a local dev server:**
  - **Viewer** (`/demo`, signed out): the header renders title · Active · "View only" · History and nothing else. A page-wide search for "Add stop" returns no matches.
  - **Owner** (dev login, own trip): "Share" and a live primary "Add stop" both present, no "View only" badge.
- **Tests moved with it, all three of them:** `TripHeader.test.tsx`'s viewer case asserts absence where it asserted `disabled === true`, and the two e2e specs that pinned the greyed button — `m11-demo.spec.ts` ("hides every control a signed-out visitor has no session for") and `m11-invites.spec.ts` (carol, an invited viewer) — now assert `toHaveCount(0)` like the controls beside them.
- **Cross-reference:** ADR-031 (whose "one thing worth arguing with" section this closes in the direction of consistency), ADR-026, KI-61.
- **First noted:** 2026-08-28. **Resolved:** 2026-08-29.

### KI-65 — There is no remove-member endpoint, so a stray membership row can only be cleared by revoking an invite twice — RESOLVED, `DELETE /api/trips/:tripId/members/:userId`
- **Severity (as filed):** correctness (a gap in the access surface, not a defect in it)
- **Area:** new `apps/web/src/app/api/trips/[tripId]/members/[userId]/route.ts`, `apps/web/src/server/access/members.ts` (`removeMember`, `revokeMembership`)
- **Symptom (as filed):** `revokeMembership` had exactly one production caller — `revokeInvite`. An owner's only lever on membership was the invite that created it, which covers nothing about a row from any other cause: a direct `grantMembership` (which the test suite itself uses), a future non-invite join path, a bad migration, or an operator's hand-written row.
- **Confirmed absent before building:** `git ls-tree -r --name-only origin/main -- apps/web/src/app/api/trips` matches nothing containing "member".
- **The three decisions the entry called non-mechanical, each taken the narrow way** (widening later is additive; narrowing is breaking), and stated in `removeMember`'s doc comment rather than in the route, so a second caller cannot quietly get a different policy:
  1. **Who may remove whom: the owner, only.** Matching invite creation and revocation (ADR-026) — the other two levers on the same thing. An editor is refused: an editor edits the plan, and nothing in ADR-026 puts the guest list in their hands.
  2. **The owner cannot be removed, by anyone including themselves** — 409, not a silent success. Their membership is not a `trip_memberships` row at all (it comes from `TripCreated`, see `mergeMembers`), so the delete would find nothing and report success. This is also what keeps "leave a trip" honestly absent rather than half-built.
  3. **Removal is not in the trip's history.** Access is CRUD, not event-sourced (ADR-003, invariant 1); revoking an invite is not an event either.
  The removed person's in-flight optimistic queue needed nothing: their next write 403s at the access seam, and the send queue already retains, counts and surfaces a refused send (KI-36).
- **No contract change, deliberately:** the response is the same `TripAccess` the sibling `GET .../access` returns, so nothing moved in `packages/contracts` and invariant 5's separate reviewed step is not owed. It also answers the caller's real next question ("so who is on it now") without a follow-up read.
- **Not idempotent, where the sibling invite revoke is:** removing someone who is not a member is a 404. Revoking an invite twice still has a row to report back; reporting success for a user id that was never here would make a typo look like a completed removal — the false confidence that lets a stray row survive.
- **Proof:** `apps/web/src/app/api/trips/[tripId]/members/[userId]/route.int.test.ts`, ten integration cases — the removal itself, the `TripAccess`-parsed response body (the contract test), 401/403-stranger/403-editor, the owner 409, the not-a-member 404, the second-removal 404, that the removed person's `requireTripAccess` now 403s, and that the other members are left alone.
- **Still no UI**, and that is the entry's own reasoning left standing: the Travelers panel is SPEC §8's "deliberately not designed yet". This is the API an owner (or an operator) can now reach; the panel that calls it is M11's Travelers work.
- **One stale comment left behind on purpose:** `invites.int.test.ts` says *"There is no remove-member endpoint"*. That file was being rewritten in a concurrent PR, so it was not touched here.
- **Cross-reference:** M11, ADR-026, KI-74.
- **First noted:** 2026-08-28. **Resolved:** 2026-08-29.

### KI-70 — A history command dispatched in the same tick as an accepted enqueue drops the just-queued unit — RESOLVED, the guard reads the ref it is guarding
- **Severity (as filed):** correctness (silent loss of one user edit — the KI-5 family, on a trigger none of the others cover)
- **Area:** `apps/web/src/components/trip/context/TripProvider.tsx` (`dispatch`'s `HISTORY_TYPES` branch)
- **Symptom (as filed):** `pending` is derived at render and `dispatch` closed over it, so an undo/redo/revert clicked in the same tick as an accepted enqueue read the **pre-enqueue** `pending === false`, passed the guard, and reconciled with `{ confirmed: result.value, pending: [] }` — discarding the unit queued a moment earlier, with no error.
- **Reproduced before fixing, in one React tick and with no fake timers:** a probe whose single click handler dispatches `AddDay` and then `UndoLastChange`. Both halves failed against the old code — `AssertionError: expected [ 'UndoLastChange', 'AddDay' ] to deeply equal [ 'AddDay' ]` (the undo went out, and went out first), and `AssertionError: expected '1' to be '2'` (the queued day was gone from the board). The entry called this "a race, not a reliable reproduction"; it is reliable when both actions are in one handler, which is what a keyboard shortcut fired during a drag-release does.
- **Fix (2026-08-29):** the guard tests `optimisticRef.current`, not the render-time `pending` — the value `runDispatch` advances synchronously three lines away for exactly this hazard ("anything dispatched later in this same tick predicts against this result rather than the pre-dispatch queue"). `pending` also leaves `dispatch`'s dependency array with it, so the callback stops being rebuilt on every queue change.
- **Proof:** three cases in `TripProvider.test.tsx` — the refusal, the edit still on screen after the microtask queue settles, and (so the first two cannot pass against a provider that never sends a history command at all) an undo with an empty queue still going through.
- **Not fully closed — see KI-77:** this fixes the same-tick window. A unit enqueued while the history command is *in flight* is still cleared by the same reconcile.
- **Cross-reference:** KI-5 (the hub entry for this loss class), KI-77, KI-55, KI-36 (resolved).
- **First noted:** 2026-08-28 (project review §1.7). **Resolved:** 2026-08-29.

### KI-71 — `saved_days.stops` is returned unparsed and trusted forever against a moving contract — RESOLVED, it is parsed at the read boundary
- **Severity (as filed):** correctness (latent — it becomes an opaque 400 on old rows the day `SavedStop` gains a required field)
- **Area:** `apps/web/src/server/savedDays.ts` (`toDto`, new `fromRow`), `apps/web/src/server/db/schema.ts` (`savedDays.stops`)
- **Symptom (as filed):** the column is `jsonb("stops").$type<SavedStop[]>()`. `$type` is a **compile-time cast on Drizzle's side, not a runtime check**, and `toDto` passed `row.stops` straight through into a `SavedDay`. Every row ever written was trusted to match today's contract.
- **Reproduced before fixing:** a row written directly into the column — the way a bad migration, an operator, or a moved contract would leave one — came straight back out of the read. Four of five new cases failed, the plainest being a `stops` value that is not an array at all: `AssertionError: expected { …(7) } to be null`, received a `SavedDay` whose `stops` was the string `"not stops at all"`.
- **Fix (2026-08-29):** `fromRow` is now the only way a stored row becomes a `SavedDay`, and it runs `SavedStop.array().safeParse(row.stops)`. `toDto` takes the parsed stops as a parameter rather than reading the column, so no path can skip it.
  Of the two failure modes the entry weighed — reject the row, or drop the unparseable stops — it does **neither** exactly: it drops the *row*, logs it with the `savedDayId` and the Zod issues, and leaves the rest of the library readable. Rejecting the whole read would let one legacy fragment take the other twenty-nine with it; substituting an empty stop list would render as a saved day that legitimately holds nothing. `getSavedDay` returning null puts an unreadable row exactly where a deleted one already is, which every caller handles. The log is what answers the entry's actual complaint — "nothing naming the row or the field".
- **The write path closed too:** `saveDay` parses the stops it computed BEFORE inserting, so a day it cannot read back is refused rather than persisted. That is the exact shape of PR #71 review §2, where the library row was inserted and the response threw afterwards.
- **Proof:** `apps/web/src/server/savedDays.stops.int.test.ts`, five cases — a well-formed round trip (the control), a row missing `kind`/`tags`, the log naming the row and the field, one unreadable row not taking the list down with it, and a `stops` that is not an array at all. A separate file from `savedDays.int.test.ts` on purpose: that suite truncates `saved_days` in `beforeEach` (KI-69), and these rows are deliberately malformed and clean up after themselves.
- **Cross-reference:** KI-53 (resolved), KI-74 (resolved in the same PR).
- **First noted:** 2026-08-28 (PR #71 review §8). **Resolved:** 2026-08-29.

### KI-74 — `withEffectiveMembers` hands back a `TripDetail` it never parsed — RESOLVED, it parses on the way out and now has the callers that would have noticed
- **Severity (as filed):** correctness (latent — the same species as the bug `requireTripAccess` was just fixed for, sitting one function below the fix)
- **Filed as KI-64 on 2026-08-28 and renumbered to KI-74 on merge:** PR #79 allocated 64 concurrently on `main` and landed first.
- **Area:** `apps/web/src/server/access/trip-access.ts`
- **Symptom (as filed):** `requireTripAccess` ends with `TripDetail.parse({ ...projected, members })` and its doc comment explains at length why — `getTripDetail` returns `trip_details.doc` raw, a doc is only rewritten when its trip next changes, and the contract's `.default()`s (`kind`, `tags`, `forkedFrom`) only apply when something actually parses. `withEffectiveMembers`, declared immediately below, did `return { ...detail, members: await effectiveMembers(...) }` — a spread over whatever it was handed, with no parse. Its return type said `TripDetail`; nothing made that true.
- **Reproduced before fixing:** the entry's "zero callers, so a caller could only reach it with something already parsed" is exactly the assumption that was false. A test that reaches it the way a caller would — `getTripDetail(tripId)` on a doc aged back to pre-M18, whose signature already types it `TripDetail` — failed on the first assertion: `AssertionError: expected undefined to be 'planned'`.
- **Fix (2026-08-29):** `TripDetail.parse({ ...detail, members })`. `parse`, not `requireTripAccess`'s `safeParse`, and the comment says why: this function's result type is a bare `TripDetail`, so there is no `{ error: Response }` channel a caller is entitled to assume covers a malformed row. Throwing is the only way it can decline to return one; a silently mis-typed object is what the entry exists to stop. The other option the entry named — deleting the function — was not taken, because the overlay-for-a-held-detail shape is the natural one for the Travelers UI (SPEC §8) to reach for, and a parsed helper is better than a deleted one plus a hand-rolled spread later.
- **Proof:** two caller tests in `apps/web/src/server/access/trip-access.int.test.ts`, using the file's existing `ageDocToPreM18` helper — the defaults case (the one that failed above) and the member overlay itself, so the fix cannot pass by breaking what the function is for. **Non-vacuous:** the first fails against the pre-fix function, which is how it was written.
- **Cross-reference:** KI-53 (resolved), KI-71 (the same species, resolved in the same PR).
- **First noted:** 2026-08-28. **Resolved:** 2026-08-29 (the M11-fallout KI cluster).

### KI-57 — `reset-demo-data/route.int.test.ts` only passes against a fresh database — RESOLVED, per-run actor ids
- **Severity (as filed):** cleanup (CI runs against a fresh database every time; this bit local re-runs only).
- **Area:** `apps/web/src/app/api/dev/reset-demo-data/route.int.test.ts`
- **Symptom (as filed):** the "clears only the caller's own trips" test creates a trip owned by an *outsider* and asserts the route left it alone. The route correctly never deletes another user's trips, so that trip survives the run and the next run's assertion sees two.
- **Reproduced before fixing, twice, on two databases.** First on the shared dev database: three consecutive runs, failing on the third with `AssertionError: expected [ …(3) ] to deeply equal [ Array(1) ]` at `route.int.test.ts:119`. Then re-reproduced on a **private** database after this worktree was isolated (see the verification note below), by restoring the two constant ids: run 1 green, run 2 `expected [ …(2) ] to deeply equal [ Array(1) ]` at the same line. Same assertion, same line, count rising with the number of runs — a real defect, not a timeout (CLAUDE.md rule 2).
- **Root cause, precisely:** `const OUTSIDER_ID = "user-2"` was a module constant, so `activeTripIdsFor(OUTSIDER_ID)` was really a query about every trip any run had ever left behind for that fixed name.
- **Fix (2026-08-29):** both identities are minted per run (`actor-<uuid>` / `outsider-<uuid>`). Every query in the file filters by membership, so a fresh pair sees exactly the rows this run created. The actor is scoped too — not because it accumulated (the route deletes the caller's own trips, so it self-cleans) but so neither id depends on database state the file does not control. This is the third of the three mechanisms this entry itself listed, and the one that does not require the lane to own the database.
- **Verified:** **four consecutive runs of the file against one un-truncated private database, all green** (6/6 each) — the same procedure that, with the constant ids restored, failed on its second run.
- **`vitest.config.ts` was left alone, deliberately.** The entry's scope named it and the obvious mechanism was a global-setup truncate, but that would re-assert whole-database destruction on every run — the exact thing KI-69 was fixed by removing. Per-test data isolation and a lane-wide truncate are alternatives, not complements; this change takes the first, and the two KIs now agree.
- **First noted:** 2026-08-28. **Resolved:** 2026-08-29.

### KI-68 — `db-reset.mjs` truncates a hardcoded three-table list while the schema has ten — RESOLVED, the list is derived from the schema
- **Severity (as filed):** reliability (a "reset" that leaves state behind is worse than no reset — it produces a database that looks clean and is not).
- **Area:** `apps/web/scripts/db-reset.mjs`
- **Symptom (as filed):** `const TABLES = ["events", "trip_details", "trip_summaries"]`, written when the schema had four tables. It now declares ten, so seven were never cleared — memberships, invites, shares, saved days and `rate_limit_counters` survived a "reset", the last of which leaves a developer throttled with no visible cause.
- **Fix (2026-08-29):** the entry's own diagnosis — *the real defect is the shape, not the list*. The tables are derived from the Drizzle schema module (`Object.values(schema).filter(v => is(v, PgTable)).map(t => getTableConfig(t).name)`), so a new `pgTable` is covered the day it lands with no edit here. Drizzle's own brand check is used rather than a naming convention, so non-table exports are ignored. One `TRUNCATE` names every table with `RESTART IDENTITY CASCADE`, which removes the ordering problem a longer literal list would have created. The script refuses to run if it derives zero tables, so a broken import fails loudly instead of silently resetting nothing.
- **Migration history is structurally safe:** Drizzle's bookkeeping lives in a separate `drizzle` schema and is not exported from `schema.ts`, so it cannot be caught by the derivation.
- **Verified end to end on a private database, not by reading the code:** with all ten tables populated (`users` 18, `events` 1382, `trip_summaries` 52, `trip_details` 52, `pages` 60, `trip_memberships` 12, `trip_invites` 159, `trip_shares` 72, `saved_days` 51, `rate_limit_counters` 1), `pnpm --filter web db:reset --yes` reported `reset 10 tables on localhost: events, pages, rate_limit_counters, saved_days, trip_details, trip_invites, trip_memberships, trip_shares, trip_summaries, users` and all ten counted **0** afterwards, while `drizzle.__drizzle_migrations` still held its rows. The pre-fix script would have cleared three of those ten.
- **The stale comment is gone:** the header no longer claims the script misses `pages`, because it no longer does.
- **First noted:** 2026-08-28. **Resolved:** 2026-08-29.

### KI-69 — Six integration suites truncate whole shared tables in `beforeEach` — RESOLVED, teardown is scoped to the ids each test creates
- **Severity (as filed):** reliability (a landmine, not a live failure — it detonates the first time two things share the database).
- **Area:** `apps/web/src/server/access/invites.int.test.ts`, `access/shares.int.test.ts`, `savedDays.int.test.ts`, `projections.int.test.ts`, `anchors.int.test.ts`, `quota.int.test.ts`
- **Symptom (as filed):** each began every test by deleting every row of the tables it touched — not the rows it created. `DATABASE_URL` is shared with local development, so a developer's own data was inside the blast radius.
- **Fix (2026-08-29):** the entry's first fix path — scope to the ids the test created — taken in all six, which removed **every** whole-table `delete` from the integration suite. The shape of the fix differed by file because the blockers did:
  - **`invites.int.test.ts`** (the widest — it truncated six tables *including `users`*): `OWNER`/`GUEST`/`CARA` are minted per test. That makes all three identity-shaped blockers true by construction — `sharedTripIds(GUEST)` and `sharedTripIds(OWNER)` filter by user and nothing else; `withProfiles` expects OWNER to have no `users` row; and the two `db.insert(users)` calls use the actor id as the primary key, so they used to throw a unique violation on the second run without the truncation. Teardown is now one id-scoped delete of the `users` rows the test inserted.
  - **`shares.int.test.ts`**: truncation removed outright. It also carried **the single most destructive statement in the six** — `db.update(tripDetails).set({ doc: <deliberately corrupted> })` with **no `where` clause**, writing a bad projection into every row in the database, preceded by a `select … [0]!` that assumed the first row was its own. Both are now scoped to the test's `tripId`.
  - **`savedDays.int.test.ts`**: `listSavedDays(ownerId)` filters by owner only, so three assertions (an empty library, an exact ordered pair, `[0]` of a newest-first list) were really assertions about the whole `saved_days` table. Owners are minted per test.
  - **`quota.int.test.ts`**: the hard one — it had **no ids to scope to**. Every bucket key was a literal, and `rate_limit_counters.bucket` is the primary key with one row per bucket *forever*, not per window. Each test now gets a fresh key prefix reaching the policy name as well as the raw buckets (the shared `<name>:global` ceiling of 5 is tight enough that two tests sharing it would flip the last assertion from `reason: "user"` to `reason: "global"`), and cleanup is a `LIKE` on that prefix.
  - **`projections.int.test.ts` / `anchors.int.test.ts`**: both compared *every* row of a projection table before and after `rebuildProjections()`. Now scoped to the test's own trip, each with an added `toHaveLength(1)` so a filtered comparison cannot pass vacuously on two empty arrays. `projections`' comparison had a second latent bug the truncation hid: neither select carried an `orderBy`, and `rebuildProjections` deletes and re-inserts, so with more than one row the `toEqual` was order-dependent on the heap.
- **Verified on a private database** (`travel_ki_test_integrity` — see the note below on why that matters): every suite green individually, and the full integration lane green and **repeatable** — `pnpm test:int` → **25 files, 242 tests passed**, three consecutive runs, with no truncation left to hide cross-file interference. That repeatability is the real result: the lane is now order- and history-independent on its own merits rather than because each file empties the database first.
- **Proved by sentinel, not by reading:** an unrelated `ai-hourly:global-SENTINEL` row was inserted into `rate_limit_counters`, the quota suite was run (7/7 green), and the row was still there afterwards with its `hits` intact. Before this change that row was deleted on the first `beforeEach`. That is the entry's actual claim — a developer's data surviving the suite — tested rather than argued.
- **Why the verification moved to a private database, and it is this entry's own thesis.** The first pass was measured against the shared `travel` database while **four sibling agent worktrees were using it**, and one `pnpm check` failed with `expected [ …(3) ] to deeply equal … - 1 + 3` in `commands.int.test.ts` — a file this entry does not name — while `ps aux` showed two other worktrees running `pnpm test:int` against the byte-identical `DATABASE_URL`. That is this landmine detonating, on the machine being used to defuse it. Everything above was then re-run against a database nobody else could touch. See KI-79.
- **What this trades, stated plainly:** whole-table truncation guaranteed small tables; id-scoped isolation lets rows accumulate across runs instead. That is now invisible to every assertion (which is the point), and `pnpm --filter web db:reset` clears all ten tables since KI-68. The cost is table growth in a long-lived dev database, not correctness.
- **`rebuildProjections()` is still database-wide**, and that is a property of the function under test, not of the tests: it truncates and re-projects every trip's projections from the whole event log. Two suites call it. Scoping their *assertions* is as far as a test-side fix reaches.
- **First noted:** 2026-08-28. **Resolved:** 2026-08-29.

### KI-72 — `process.env.BASE_URL` is `"/"` inside every Vitest worker — RESOLVED, `config.ts` no longer reads a name Vite owns
- **Severity (as filed):** correctness, latent — nothing was known to depend on it, which is why it could sit unnoticed.
- **Area:** `apps/web/src/config.ts`, `apps/web/src/config.test.ts` (new), `apps/web/vitest.unit.config.ts`, `.env.example`
- **Symptom (as filed):** Vitest assigns Vite's resolved `env` onto `process.env`, and Vite's `env.BASE_URL` is the public base *path*, `"/"`. `src/config.ts` read `env.BASE_URL`, so it evaluated to `"/"` in every unit test regardless of what the app would use at runtime, and any test asserting against it agreed with almost anything.
- **Reproduced before fixing**, with the entry's own probe, on Vitest 4.1.11: `[[WORKER]] process.env.BASE_URL= "/"` and `[[WORKER]] config BASE_URL= "/"`.
- **Fix (2026-08-29):** the override moved to `WEB_BASE_URL`, a name Vite does not own — `export const BASE_URL = env.WEB_BASE_URL ?? \`http://localhost:${WEB_PORT}\``. Nothing in the repo ever set `BASE_URL` deliberately (no workflow, no `.env.example`, no script), so the override's only real producer *was* the collision; renaming it keeps the capability — overriding scheme and host, not just the port — and matches the `WEB_PORT` knob beside it. Documented in `.env.example` with the reason, so the odd-looking name is not "cleaned up" back into the bug.
- **Verified:** the same probe after the change reports `process.env.BASE_URL= "/"` (Vite still sets it — the trap is still there, it is simply no longer read) and `config BASE_URL= "http://localhost:3001"`. Full web unit suite: **125 files, 1201 passed, 1 skipped**.
- **Pinned against regression, and the pin was proved to fail:** `src/config.test.ts` asserts `BASE_URL` is an absolute URL and not `"/"`. Reverting `config.ts` to read `env.BASE_URL` was measured to fail it — `AssertionError: expected '/' not to be '/'` and `expected '/' to be 'http://localhost:3001'` — so this is a working guard, not a test that happens to pass.
- **`vitest.unit.config.ts` needed no guard.** It imports `BASE_URL` in the *parent* Node process, before Vitest assigns Vite's env, so the jsdom `url` it passes was always the real one; a comment now records that, since the file's old guard was removed by PR #77 and its absence looked like an oversight.
- **First noted:** 2026-08-28. **Resolved:** 2026-08-29.

### KI-76 — `pnpm check` exits 0 while running zero integration tests — RESOLVED, the probe now connects the way the app does
- **Severity (as filed):** reliability, and it undermined the Definition of Done directly — `AGENTS.md` names `pnpm check` as the bar for every change.
- **Area:** `package.json` → `test:int:if-db`, new `apps/web/scripts/db-probe.mjs`
- **Symptom (as filed):** the guard was `if pg_isready -q -h localhost -p ${POSTGRES_PORT:-5433} 2>/dev/null`. `pg_isready` ships with the Postgres **client** tools; where Postgres runs in Docker and no client is installed on the host the binary is absent, "command not found" goes to `/dev/null`, and its non-zero exit is indistinguishable from "no database". The banner printed and `pnpm check` still exited 0.
- **Reproduced before fixing, on the machine the entry describes:** `which pg_isready` → not found, `docker ps` → `travel-collab-postgres-1 … Up 4 weeks (healthy) 0.0.0.0:5433->5432/tcp`, and `pnpm test:int:if-db` printed `SKIPPED: integration tests did NOT run. No Postgres on localhost:5433` with **`EXIT=0`** — while `pnpm test:int` run directly reported **25 files, 242 tests, all green**. Exactly the entry's account, three weeks on.
- **Fix (2026-08-29):** `apps/web/scripts/db-probe.mjs` connects with the `pg` client the app already depends on, against the same `DATABASE_URL` the integration tests resolve (it loads `apps/web/.env.local` the way `vitest.config.ts` does, and lets an already-exported value win). It reports **three** outcomes instead of two, which is the whole point: exit `0` the database answered, exit `1` nothing answered (skip, `pnpm check` stays green), exit `2` **the probe itself could not run** — no `DATABASE_URL`, no `pg` client, an unparseable URL — which fails loudly. "I could not tell" is no longer reported as "there is no database".
- **The quieter half is fixed too:** the probe parses `DATABASE_URL` rather than hardcoding `localhost` and reading `POSTGRES_PORT`, so it no longer probes a host nobody configured, and it names the host it actually tried in both the success and the skip line.
- **Verified — all three branches, through `package.json` and not just the script:** database up → probe printed `db-probe: localhost:5433/travel answered — running the integration tests.` and the suite ran; `DATABASE_URL` pointed at a dead port → `no database answered at localhost:5599/travel. connect ECONNREFUSED ::1:5599; connect ECONNREFUSED 127.0.0.1:5599`, banner printed, **exit 0**; `DATABASE_URL="not a url"` → `DATABASE_URL is not a parseable URL`, **exit 2**, propagated out through pnpm. The first of those is the case that used to be silently skipped.
- **CI is unaffected:** `.github/workflows/ci.yml` calls `pnpm --filter web test:int` directly and never went through this guard.
- **A refused connect reports a real reason.** The first cut printed a blank one: a TCP refusal arrives as an `AggregateError` whose own `message` is empty (Node tries every resolved address), so the script unwraps the nested errors — a probe that cannot say why is the failure this file exists to end.
- **First noted:** 2026-08-28 (M11's exit-gate run). **Resolved:** 2026-08-29.

### KI-58 — `geocode-japan-seed.mts` still accepts the wrong venue inside the right city — RESOLVED
- **Severity (as filed):** cleanup (no live impact since ADR-030 — the overlay is no longer read at seed time; this tracked the tool, not the data)
- **Area:** `apps/web/scripts/geocode-japan-seed.mts`, `packages/fixtures/src/japan/coordinates.json`, `packages/fixtures/src/japan/coordinateOverrides.ts`
- **Symptom (as filed):** of the 12 stops where the overlay disagreed with the canonical coordinates, six were simply the wrong place — a city centroid for Hama-rikyū Gardens, "Cawaii Bread & Coffee" for Bread & Espresso, "Coffee Yoshida" for Yoshida-ya, "Sushi Wasabi" for Sushi Yoshitake, "MeGuro" for Torishiki, and the Setagaya branch for Onibus Coffee. The entry's fix path was "a name-similarity floor between the query's `place` and the candidate's own name".
- **Reproduced first, and the entry was half wrong.** Replaying `placeNameVerdict` offline against the committed overlay's own `canonicalName` for all 12 disagreements (no LocationIQ call needed — the overlay records what was matched) returns **`mismatch` for five of the six**:
  ```
  d2-s4-hama-rikyu-gardens     mismatch   "Hama-rikyū Gardens" -> "Tokyo"
  d2-s5-yakitori-at-torishiki  mismatch   "Torishiki"          -> "MeGuro"
  d3-s1-breakfast-at-bread-…   mismatch   "Bread & Espresso"   -> "Cawaii Bread & Coffee"
  d5-s5-omakase-at-sushi-…     mismatch   "Sushi Yoshitake"    -> "Sushi Wasabi"
  d9-s3-lunch-at-yoshida-ya    mismatch   "Yoshida-ya"         -> "Coffee Yoshida"
  d2-s1-coffee-at-onibus       MATCH      "Onibus Coffee"      -> "Onibus Coffee"
  ```
  The name-similarity floor the entry asks for **already existed** — KI-39 added it as step 4 — and it already rejects five of the six. The overlay was simply never regenerated after KI-39, so it was stale output from a run that predated its own fix. "Re-running it still produces these six wrong matches" was an assumption, not a measurement.
- **The one real residue is a different bug than the entry describes.** `d2-s1-coffee-at-onibus` scores a genuine `match`: the queried venue and the candidate are the same chain, so their names are *identical* and token identity cannot separate them. `geocodeNameMatch.ts`'s own header says so — "it cannot tell two branches of the same chain apart ... which stays the box's job and the human's" — and the box is ~60km of Tokyo. No name-similarity floor, however tight, can fix a name that matches exactly. The only field that separates the branches is the **ward**, which step 4 deliberately discounts as geography.
- **Fix (2026-08-29):** a step **4b** in the script — an *area corroboration* tiebreak among the candidates that survive step 4. A candidate whose full display name also carries the queried `area` outranks one that does not, and a pin that wins without it is reported as `area-uncorroborated`. Deliberately a **ranking, not a filter**: plenty of correct OSM addresses render the ward in local script or omit it, so rejecting on it would lose right answers exactly the way collapsing `not-comparable` into `mismatch` would. Implemented in the script, not in `geocodeNameMatch.ts`, so the shared seam keeps its single meaning.
- **The overlay was then regenerated against the live vendor** (~62 unique lookups, `LOCATIONIQ_API_KEY` from `apps/web/.env.local`), and every result re-reviewed. All six wrong-venue matches are gone from it:
  - five no longer resolve at all — the name check rejects them, so the overlay simply has no entry for those stops;
  - `d2-s1-coffee-at-onibus` still resolves to the Setagaya branch (the vendor's top 5 contained no Nakameguro candidate to rank above it) but is now **reported** rather than accepted silently, and keeps its `COORDINATE_OVERRIDES` entry.
- **It surfaced a second instance of the same branch bug.** `d3-s3-lunch-at-afuri` used to match "WITH HARAJUKU" — a building, wrong venue, but close enough to pass the 2km tolerance unremarked. It now matches "Afuri, Minato", the right chain and the wrong branch, 2.8km from the Harajuku stop, and lands in `COORDINATE_OVERRIDES` with a reason. A wrong pin that was invisible is now written down.
- **Overlay coverage moved 51 → 41 of 72, deliberately, and every one of the ten is accounted for:** seven were wrong or dubious matches the name check now rejects (the five above, plus "GION KIMUTAKO" for Gion Nanba and "KICHIRI" for Kichi Kichi — both wrong venues that had slipped through only because they happened to sit within the distance tolerance). **Three are false rejections and are filed as KI-77**: Gonpachi, Tenryū-ji and Ginkaku-ji are the right places, rejected on tokenisation ("Nishiazabu" vs "Nishi-Azabu", "-ji" vs "Temple"). The overlay is a *proposal* cross-checked against `trip.ts`, so a lost entry weakens a check but stores nothing wrong; `with coordinates` is still **72/72** and no coordinate the app serves changed.
- **Verification:** `pnpm seed:verify` green (72/72 coordinates, 6 cities, **2 conflicts** — KI-60's baseline unmoved). The guard proved itself non-vacuously along the way: before `coordinateOverrides.ts` was updated, `verify.ts` failed with exactly the six findings the regeneration should produce — five "overridden but the overlay has no entry for it" and one new unexplained disagreement — so the coupling between the overlay and its override list is enforced, not asserted.
- **Left alone deliberately:** the script reports LocationIQ's `404` as `lookup-failed (rate limit or vendor error — rerun to retry)`. LocationIQ also returns 404 for *zero results*, and nine stops hit it on every run, so that label is wrong for all nine and invites a pointless rerun. Filed as KI-78 rather than fixed here.
- **Found by:** ADR-030, 2026-08-28, while checking the two seed copies against each other. **Resolved:** 2026-08-29.
- **Cross-reference:** KI-39 (the city-box bound this was the residue of), KI-15 (the same "a fuzzy string match is not a confirmation" class), KI-77 and KI-78 (opened by this work), ADR-030.

### KI-75 — `m10-map-rail.spec.ts` skips a day about half the time, and a different day each time — RESOLVED, the scan was asserting an unthrottled model of a throttled feature
- **Severity:** reliability (no product impact — the rail behaves as designed; it made "the full e2e suite is green" an unreliable signal, which is what a milestone gate rests on)
- **Area:** `apps/web/e2e/m10-map-rail.spec.ts` (the spec only — `MapRail.tsx` is unchanged and was never at fault)
- **Symptom:** `map rail: scrolling tracks focus through every day` fails at the `expect(dayNumbers).toEqual([1..14])` assertion with exactly one day missing from the middle of the log. Measured on this machine at **3 failures in 5 runs**, and the missing day **moves between runs** — day 2, then day 12, then day 5 — while the failing *line* stays put. That combination is the tell: CLAUDE.md rule 2 reads a wandering *location* as a timeout, and this is its near neighbour — a fixed location with a wandering *value*, which is a sampling race, not a defect in the thing sampled.
- **Root cause:** `MapRail.tsx`'s scroll handler is a leading+trailing throttle on `scrollThrottleMs` (50ms), and its `evaluate()` emits only when the day it computes differs from the last day it emitted. The scan drove `DAY_COUNT * 3` pixel steps, each waiting two frames (~32ms) — *under* the throttle window. So consecutive steps collapsed into a single trailing evaluation, and a deferred evaluation reads whatever `scrollTop` is current **when it finally runs**, not the position that scheduled it. Where a collapsed span crossed a whole day band, that band's day was never a value of `next`, so it was never emitted and there was nothing for the `MutationObserver` to record. Machine load decides which band that happens to, which is why the missing day moves.
- **The spec's own header asserted the opposite** and is corrected in the same change: *"an evaluation deferred to its trailing edge is still recorded by the MutationObserver below"* — recorded, yes, but only at the position it lands on, never at the one it skipped over. That sentence is why the race survived the test-suite overhaul that introduced it.
- **Fix (2026-08-28, M11 gate run):** the fixed pixel sweep is replaced by a walk of one day band at a time — scroll to band `i`'s centre (`(i - 0.5)/n` of the geared range, which the neighbouring `maxScrollTop` assertion already establishes as evenly divided), then `await expectFocusedDay(i)` before advancing. `expectFocusedDay` is a retrying web-first assertion, so this waits out the trailing edge **without naming a duration** — no sleep, and no coupling to `scrollThrottleMs`, which is the exact coupling the nine sleeps this file used to carry were removed for (see `scripts/check-sleep-wall.mjs`, whose header cites this spec by name). The final log assertion is unchanged, and is now complete by construction: no band is left before the rail has reported it.
- **Verified:** **6 consecutive green runs** against a production build (`CI=true`, `--retries=0`), where the pre-fix spec failed 3 of 5 under the same conditions and on the same loaded machine (load average ~7). **Not proven by sabotage:** the fixed spec was not re-run against a deliberately broken rail, so "still a regression guard" rests on reading it rather than on a failing run — it cannot pass vacuously (a rail stuck on day 1 fails `expectFocusedDay(2)`, and one that cannot reach the ends fails at day 1 or day 14), but that is an argument, not evidence.
- **First noted:** 2026-08-28 (M11's exit-gate run — the only red spec in an otherwise green 46-test suite). **Resolved:** 2026-08-28, same session.

### KI-61 — The landing page's "look around a real trip" always dead-ended, because nothing ever created the share it pointed at — RESOLVED
- **Severity (as filed):** correctness (the front door's most prominent secondary CTA landed on an empty state on every environment, including a freshly seeded local one)
- **Area:** `apps/web/src/server/access/shares.ts` (`readFeaturedShare`, deleted), `apps/web/src/app/api/shares/featured/` (deleted), new `apps/web/src/server/demoTrip.ts` and `apps/web/src/app/(front)/demo/`
- **Symptom (as filed):** `/welcome`'s "Look around a real trip" and "See a finished one" both linked to `/s/featured`, which resolved `DEMO_SHARE_TOKEN`; unset, `SharedTripScreen` rendered **"Nothing to see here / No trip is published here yet."** Unset was not an edge case — the var was not in `.env.example`, neither seeder ever created a share, and a hand-made token died at the next `db:reseed`. CI's own e2e asserted the empty state, so the suite was green *because* nothing was configured.
- **Fix (2026-08-28, ADR-031):** not the fix path this entry proposed. Mitchell rejected a committed world-readable token on grounds the entry had not weighed — a preview branch would still need a manual step to validate its own front door, and `/s/featured` is an unauthenticated page anyone can hit as often as they like, so a share lookup plus a **full 74-event replay** per view is a load profile set by strangers — and then rejected the first implementation too, for showing the wrong thing: a pinned share renders as a flat list of days, with no Timeline, Day columns, Map, Calendar, conflicts or history. "I wanted to leverage all the existing react of the timeline, column, map and calendar tabs on that page to show the real functionality but in a read only mode."
  So the demo trip stopped being a row **and** stopped being a bespoke page. `server/demoTrip.ts` folds `@tc/fixtures`' commands through the real domain in memory; `requireTripAccess` — the one seam `GET /api/trips/:id`, `/history`, `/history/:seq` and `/access` all pass through — answers for it as a **viewer**, so all four serve it publicly with no route file changed; and `/demo` mounts the same provider stack and the same `TripBoardScreen` the signed-in trip page does.
- **Read-only is the product's own permission rule, not a second implementation:** `accessPolicy.ts`'s `MINIMUM_ROLE` has no `viewer` entry, so every write route asks that seam for `editor` or `owner` and is refused. A write endpoint added later inherits the refusal without anyone remembering the demo exists.
- **"No database" is enforced, not asserted:** `demoTrip.test.ts` mocks `pg` so a `Pool` throws on construction — any future import of `db/client` into the demo's graph, direct or transitive, fails a test rather than opening a connection on a public path.
- **It also fixed the invited-viewer board** (see KI-64, filed for what remains): a viewer used to see a pencil and a ✕ on every card, "Dismiss" on every conflict, "+ Add" on every column, and could drag a card and watch it snap back. `readOnly` now threads from `TripProvider`'s own gate into the board components, so the flag that refuses the command is the flag that hides the control.
- **Proof:** `m11-demo.spec.ts` — six e2e cases in the `ci-like` lane covering all four lenses, the hidden controls, the History popover, the signed-out `/signin?callbackUrl=%2Fdemo` detour and the signed-in copy. Plus 11 unit tests on the fold, 10 integration tests through the real route handlers, and read-only blocks in `board.test.tsx` and `TimelineLens.test.tsx` (each with a negative half, so they cannot pass against a board that renders nothing).
- **Found by:** Mitchell, 2026-08-28 — "why the homepage preview (see a planned trip) of this trip using the seed data to power it shows Nothing to see here" — and twice redirected by him on the shape of the fix.
- **Cross-reference:** ADR-031 (the decision), ADR-027 (whose "Look around a real trip" section this supersedes, and which predicted this failure in writing), ADR-030 (the fixture the demo now folds), KI-64, M12 Community (still owns real discovery, and gets `featured` back).

### KI-60 — Every travel day produced false "impossible geography" conflicts — RESOLVED
- **Severity (as filed):** correctness (10 of the Japan demo's 12 conflicts were false, and any real user's travel day got the same treatment)
- **Area:** `packages/domain/src/trip/conflicts.ts` (`geographyRule`, new `transitExcusesDistance`)
- **Symptom (as filed):** `detectConflicts` compared **every pair** of located stops on a day against a flat `GEO_INFEASIBLE_KM` (150km) and never read `kind`, so a day where the trip legitimately relocates flagged every before/after pair:
  ```
  Day  7 (Odawara → Kyoto, 4 conflicts)   "Shinkansen Odawara → Kyoto" vs the 4 Kyoto stops   ~310 km
  Day 14 (Osaka → Tokyo,   6 conflicts)   the 2 Osaka morning stops vs the 3 Tokyo stops      ~400 km
  ```
  In every pair the day's own shinkansen was scheduled *between* the two stops. The data was right; the rule was incomplete. M18 had added `ActivityKind: "transit"` for exactly this reasoning and `conflicts.ts` predated it.
- **Fix (2026-08-28):** the entry's proposed rule. A day's `transit` stops contribute their start times; a far-apart pair is skipped when a transit stop sits **at or between** the two stops in time. "A distance is only a problem if nothing on the day accounts for crossing it."
- **Deliberately conservative in three ways**, because a false negative hides a real problem while a false positive is only noise:
  1. **Time order, not stored order.** `day.activityIds` is display order, which a user can reorder without changing when anything happens.
  2. **An untimed stop is never excused.** "We don't know when this is" is not evidence that travel covered it.
  3. **An untimed *transit* stop excuses nothing** — it cannot be placed in the interval.
  It does not check that the transit stop goes to the right *place*: nothing models a from/to (KI-59), so "some travel is scheduled in this interval" is the strongest available signal.
- **The weaker variant was rejected with evidence:** *skip a pair if either stop is `transit`* clears day 7 (transit is an endpoint of all four pairs) but only 3 of day 14's 6 — it leaves "Breakfast at the hotel" vs the three Tokyo stops, the same false positive with transit merely not being an endpoint.
- **Proof:** the Japan fixture goes **12 conflicts → 2**, and the two that remain are the wanted ones — "Nezu Museum" vs "Lunch at Kagari" and "Kiyomizu-dera and Sannenzaka" vs "Lunch at Omen Kodaiji". Confirmed in a real browser after a full `db:reset` + `db:seed`: the hero reads "2 open conflicts" and the Day-columns lens shows exactly two dismissible banners, where it previously stacked twelve (the pile KI-43 describes). No console errors.
- **Regression tests:** `packages/domain/test/conflicts.test.ts`, a new "a transit stop excuses the distance it crosses (KI-60)" block — seven cases covering between/endpoint/outside-the-interval, untimed stop, untimed transit, transit-only (every other `ActivityKind` must still flag), and that time-overlap detection is untouched. **Verified non-vacuous:** removing the one-line exclusion turns 5 of the 7 red.
- **Check subset:** full `pnpm check` (domain **153**, contracts 98, pages 32, fixtures 8, factories 354, web 1054/1 skipped) and `pnpm --filter web test:int` **201 passed** — the latter run because this is a domain change and the projection-rebuild golden test is in it.
- **Baseline moved with it:** `@tc/fixtures`'s `expectations.ts` pinned `conflictTotal: 12`; it is now `2`, with a comment saying to suspect the rule before the content if it climbs back.
- **Found by:** Mitchell, 2026-08-28, reviewing the reseeded demo trip — "I would expect one or two so the demo can see how they look but many many around distances being too far".
- **Cross-reference:** KI-59 (a stop still carries one city, so the domain still has no model of a stop that MOVES between two places — this fix routes around that rather than closing it), KI-43 (why a pile of banners matters), M18 (`kind`).

### KI-51 — The colour wall is blind to untracked files, so a new file is unguarded until it is staged — RESOLVED
- **Severity:** cleanup (no user impact; a hole in a CI gate, not a defect in shipped code)
- **Area:** `scripts/check-color-wall.mjs`.
- **Symptom (2026-08-27, landing-page design pass):** the script enumerates the
  files it scans with `git ls-files`, so a brand-new file that has never been
  staged is not in the list. It is not skipped with a warning — it is invisible,
  and the script prints `color wall OK` with a file count that silently excludes
  it. Reproduced directly: with the two new landing components untracked the run
  reported `309 files scanned`; `git add`ing them took the same run to
  `313 files scanned`.
- **Why it matters more than the file count suggests:** the wall is blind to
  exactly the files most likely to violate it. A raw hex or a `[13px]` bracket
  value is far likelier in freshly written UI than in a file that has already
  been through review, and an agent or contributor who runs the gate before
  staging gets a clean pass that means nothing. Three separate agents on this
  pass each hit it and each hand-checked their own files with the script's own
  regexes to compensate.
- **Not what it looks like:** this is not the pre-M5 `design-wall-pending.json`
  exemption list, which is a deliberate, shrinking allowlist. This is an
  unintended gap in enumeration.
- **Candidate fixes (not chosen yet):** scan the working tree rather than the
  index; or add untracked-but-not-ignored files via
  `git ls-files --others --exclude-standard` alongside the tracked list. The
  second keeps `.gitignore` honoured, which walking the tree naively would not.
- **Workaround in use:** `git add -A` before running the wall, and read the file
  count — if it did not go up after adding new files, the run did not see them.
- **Same class:** `check-lint-wall.mjs` and `check-case-collisions.mjs` should be
  checked for the identical `git ls-files` assumption before this is called fixed.
- **Fix (2026-08-28):** `scripts/check-color-wall.mjs` now enumerates with
  `git ls-files --cached --others --exclude-standard <same pathspec>` — the
  second candidate fix listed above. One `git` invocation, not two, so the gate
  is no faster to skip and no slower to pass; `--exclude-standard` keeps
  `.gitignore` honoured (node_modules, `.next`, generated output stay out), and
  the result is de-duplicated and sorted so the stage-1/2/3 duplicates
  `--cached` emits for an unmerged path mid-conflict can't double-report.
- **Proof:** an untracked `apps/web/src/components/Ki51ScratchProbe.tsx`
  carrying `#ff00aa` and `p-[13px]` was invisible before the change — `color
  wall OK (356 files scanned, 0 pending re-skin)`, exit 0. After it, the same
  untracked file fails the gate on both regexes and exits 1. An *ignored* file
  with the same raw hex (untracked, matched by a `.gitignore`) is still
  correctly skipped. Clean tree before and after: `356 files scanned`, exit 0,
  ~0.08s — same count, same speed. Both probe files removed.
- **No regression test:** repo-root `scripts/*.mjs` are covered by no suite
  (`apps/web`'s vitest only includes `src/**/*.test.{ts,tsx}`), and standing up
  a root test project to hold one is well outside this entry's Area. The
  enumeration line carries a comment naming KI-51 instead, so dropping
  `--others` shows up in review.
- **Same class, still unchecked:** `check-lint-wall.mjs` and
  `check-case-collisions.mjs` were left alone — both still enumerate with plain
  `git ls-files` and have the identical gap. Filed as follow-up, not fixed here
  (one KI, one blast radius).
- **A second, deliberately distinct exclusion mechanism (2026-08-29):**
  `check-color-wall.mjs` now also carries `generatedNonProduct` — a separate
  `Set` for files that are not product UI at all (currently just Sentry's
  wizard-generated `sentry-example-page/page.tsx`, which shipped raw brand
  colors straight from the scaffold). It is intentionally **not** an addition
  to `pending` above: `pending` means legacy debt being paid down and only
  ever shrinks; `generatedNonProduct` means "third-party codegen, permanently
  out of scope," and neither list should be used for the other's purpose —
  putting scaffolding in `pending` would silently redefine it as "stuff we
  tolerate" instead of "debt we're closing." Covered by
  `scripts/__tests__/check-color-wall.test.mjs`, which also updates the "no
  regression test" note above for this one script — it now has one, run under
  root `pnpm test` via `node --test "scripts/**/__tests__/**/*.test.mjs"`
  (the pattern `check-sleep-wall.test.mjs` already used).

### KI-40 — Every `activitiesPerDay >= 2` fixture shares one time window, so `overlappingDay` is indistinguishable from its siblings — RESOLVED
- **Severity (as filed):** cleanup (no live failure — the projection factory never runs the conflict engine, so the clash was unobservable)
- **Area:** `packages/factories/src/trip.ts` (`activityFactory`'s literal `timeWindow`), `packages/factories/src/scenarios.ts`
- **Symptom (as filed):** `activityFactory` gave **every** activity the identical literal window `{ start: "09:00", end: "11:00" }`. Identical windows satisfy `windowsOverlap`, so `threeDayTrip`, `overBudgetTrip`, `ungeocodedTrip` **and** `overlappingDay` all carried a mutual clash on every day, and `scenarios.overlappingDay` was not distinguished from its siblings on the projection side at all.
- **Reproduced first**, by hydrating the fixtures and running the real engine (`detectConflicts(hydrate(trip))`) — the exact thing the entry predicted a caller would do:
  ```
  threeDayTrip windows: [09:00-11:00 x6]      overlappingDay windows: [09:00-11:00 x2]
  threeDayTrip overlaps: 3    overBudgetTrip overlaps: 2    ungeocodedTrip overlaps: 1    overlappingDay overlaps: 1
  × threeDayTrip — the ORDINARY case — has no time-overlap conflicts
    → expected [ { …(6) }, { …(6) }, { …(6) } ] to deeply equal []
  ```
  Each of the three `threeDayTrip` conflicts was a full `time-overlap` object, e.g. `"Flight to Rome" and "Vatican Museums" overlap in time on the same day.` — the degenerate conflict the ordinary fixture was never meant to have.
- **Fix (2026-08-28):** the entry's own fix path. `trip.ts` now has `hourlyWindow(indexWithinDay)` — back-to-back one-hour windows walking the clock from 09:00, the projection-side twin of `commands.ts`'s `HOURLY_WINDOWS`. `activityFactory` takes an `indexWithinDay` transient (default 0 → `09:00`–`10:00`) instead of a literal window, and `tripDetailFactory` passes each activity its position within its day. Because `windowsOverlap` is strict, back-to-back windows touch but do not clash. `tripDetailFactory` also gained a `timeWindows` transient (the projection twin of `ScenarioSpec.timeWindows`), and `scenarios.overlappingDay` uses it to state a real *partial* overlap — `09:00`–`10:00` / `09:30`–`10:30`, byte-identical to what its command twin emits. The ladder has 23 slots (every hour but 23:00, whose one-hour end would be the invalid `"24:00"`); the widest fixture in the package is 12 activities per day, and the no-overlap property is now pinned by test at that width.
- **Left as filed, deliberately:** `tripDetailFactory` still hardcodes `conflicts: []` and never runs the conflict engine. The entry says that is a design question about what the factory is for and is Mitchell's, not a mechanical fix; the characterization test recording it is kept.
- **Consumer ripple: none.** `activityFactory` has no call site outside the package (only the `index.ts` re-export); consumers use `scenarios`/`tripDetailFactory`. All 31 `apps/web` unit test files that import `@tc/factories` pass unchanged — no test depended on activities sharing a window.
- **Proof:** the reproduction above now reports `threeDayTrip/overBudgetTrip/ungeocodedTrip overlaps: 0` and `overlappingDay overlaps: 1`. Check subset per `minimal-check-subset` (two files in one leaf package + its consumers, no `packages/contracts` change): `pnpm --filter @tc/factories test` → **354/354 across 5 files**; `pnpm --filter @tc/factories typecheck` and `pnpm --filter web typecheck` clean; `vitest run -c vitest.unit.config.ts` over the 31 `apps/web` unit files importing `@tc/factories` → **374/374**. The one remaining consumer, `reset-demo-data/route.int.test.ts`, uses `commandsFor` (command side, untouched), so the integration suite was not run.
- **Regression test:** `packages/factories/src/conflicts.test.ts` — a new "the projection side clashes only where it says it does" suite: an `it.each` hydrating every non-overlapping scenario and asserting zero `time-overlap` conflicts from the real engine, a check that the projection and command twins state the *same* two overlapping windows (they cannot share a constant — `commands.ts` imports `scenarios.ts`), and a 3x12-activity build that stays overlap-free. Verified as a real guard by reverting `hourlyWindow` to the old literal: 4 of the new tests go red, `Tests 4 failed | 15 passed (19)`.
- **Cross-reference:** KI-37 (the command-side window bug, resolved 2026-08-25) — same family, opposite twin. The twins now agree.
- **First noted:** 2026-08-25 (KI sweep). **Resolved:** 2026-08-28 (KI sweep).

### KI-42 — `confirmHead` silently drops queued units on a *successful* send when they no longer predict cleanly — RESOLVED
- **Severity (as filed):** correctness (silent loss of confirmed-to-the-user work — the **same class as KI-5 and KI-36**, on the one trigger neither of them covers)
- **Area:** `apps/web/src/components/trip/context/optimistic.ts` (`confirmHead`, `baseDetail`, `PendingUnit`)
- **Symptom (as filed):** when the head send *succeeds*, `confirmHead` adopted the authoritative confirmed state and re-predicted each remaining queued unit against the new base. Any unit that no longer predicted cleanly was dropped — and, via the loop's `break`, so was **every unit queued behind it**. The user had already been shown those edits as applied; they vanished with **no alert at all**, nothing counting or naming them, and no retry. The code comment claimed the loss "will be reported via `failHead` semantics at send time", which it could not be: the units were removed from `pending`, so they were never sent and `failHead` never saw them — a stated invariant nothing enforced.
- **Reproduced before fixing**, as a reducer test in `optimistic.test.ts`: queue `u1 = AddDay d-a`, `u2 = AddActivity on d-a`, `u3 = AddDay d-c`, then confirm the head with an authoritative outcome that does **not** contain `d-a` (a concurrent removal). Result:
  ```
  FAIL  src/components/trip/context/optimistic.test.ts > confirmHead retains queued units
        that no longer predict (KI-42) > keeps the unpredictable unit AND everything queued behind it
  AssertionError: expected [] to deeply equal [ 'u2', 'u3' ]
  ```
  Both units gone: `u2` because it could not re-predict, `u3` — which re-predicts perfectly well on its own — purely because it sat behind `u2`. `unsentCount` 0, no `failure`, nothing sent.
- **Fix (2026-08-28):** a unit that no longer predicts is **kept, not dropped**, and so is everything behind it. `PendingUnit.predictedDetail` becomes `TripDetail | null`, where `null` means "queued and real, but not currently predictable" — the unit stays in `pending`, is still counted by `unsentCount`, still shows as a pending history row, and is **still sent**, so the server (not the client's local guess) decides its fate. This makes the old comment's claim true rather than deleting it: if the server refuses the unit, `failHead` records a real server message and lights the save mark red with a retry (KI-36's machinery, reused as that entry predicted); if the server accepts it — the client's re-prediction can be more conservative than the server's own decision — the work simply survives. `baseDetail` now scans backwards for the last unit that *has* a prediction, so an unpredictable unit contributes nothing to `activeDetail`: the board shows the authoritative state rather than a prediction computed against a base the server has replaced. Everything after the first unpredictable unit is retained unpredicted too, even when it would predict cleanly alone — these are ordered edits, and predicting a later one against a base that skips an earlier one would render a trip no send will ever produce.
- **Deliberately NOT done:** no new alert, banner or "these could not be applied" copy. The entry's fix path offered "either a retry or an explicit message"; retention plus the existing save-light/retry surface gives the retry route with no new UI, and the honest count (`sync.unsent`) it renders is now correct where before it silently dropped to 0. No file outside `optimistic.ts` needed to change.
- **Proof:** the reproduction above now passes. Regression tests — 6 in `optimistic.test.ts` under "confirmHead retains queued units that no longer predict (KI-42)": the retained unit *and* the units behind it survive with an honest `unsentCount`; the retained head's commands are intact and no `failure` gates the sender, so the send (and therefore `failHead`) actually happens — the old comment's claim, enforced; the retained units still render as pending history rows; `activeDetail` equals the authoritative detail rather than a stale prediction; units *ahead* of the unpredictable one keep predicting (`d-b` visible, `d-d` not); and a retained unit re-predicts once the head ahead of it is confirmed, so the queue self-heals. Mutation-proved: restoring the `break` turns **5 of the 6** red (the sixth guards the display side against the retention itself, and passes either way).
- **Check subset** (per `minimal-check-subset`; changed files are `optimistic.ts` + `optimistic.test.ts`, both `apps/web`, no `packages/contracts`): `pnpm --filter web typecheck` clean, `pnpm --filter web lint` clean, `vitest run -c vitest.unit.config.ts` over `optimistic` / `TripProvider` / `context` / `SaveLight` (**47 passing**) and over the consumer components that render the queue — `TripBoardScreen`, `TimelineLens`, `ActivityEditorSheet`, `TripHeader` (**87 passing**). Not run, deliberately: the full `pnpm check`, `test:int` and e2e — five KI agents were running in parallel and that is the load condition KI-13 documents; nothing outside `apps/web/src/components/trip/context` changed.
- **What this does NOT close:** KI-5 (the queue is still in memory and a reload still loses it) is untouched and stays open, though it shares this file. There is still no way to *abandon* a unit the server will never accept except by reloading — the same gap KI-36 recorded.
- **First noted:** 2026-08-25 (KI sweep, found reading the send loop while scoping KI-36's Option 1). **Resolved:** 2026-08-28 (KI sweep).

### KI-53 — Access-module timestamps come back in two different formats depending on whether you just wrote the row — RESOLVED
- **Severity:** correctness-latent (no current consumer broke, but the same field had two shapes across the API surface)
- **Area:** `apps/web/src/server/db/schema.ts` (`trip_invites`, `trip_shares`, `saved_days`), `apps/web/src/server/access/shares.ts`, `apps/web/src/server/access/invites.ts`, `apps/web/src/server/savedDays.ts`
- **Symptom:** these columns were `timestamp(..., { withTimezone: true, mode: "string" })`. On the WRITE path the service returned the row object it had just built, so the caller got back exactly the ISO-8601 string it passed in — `2026-01-01T00:00:00.000Z`. On the READ path Drizzle handed back Postgres's own rendering of the same value — `2026-01-01 00:00:00+00`. So `createdAt` / `revokedAt` / `acceptedAt` were ISO from `createShare`, `createInvite`, `saveDay`, and Postgres-format from `listShares`, `listInvites`, `listSavedDays`, `getSavedDay`.
- **How it surfaced:** tightening `shares.int.test.ts`'s "revoking twice is a no-op" to assert the timestamp does not MOVE (CodeRabbit's suggestion on PR #71) failed with `expected '2026-01-01 00:00:00+00' to be '2026-01-01T00:00:00.000Z'` — the first revoke returned its own input, the second returned the stored row.
- **Reproduced before fixing (2026-08-28):** a throwaway `*.int.test.ts` asserting `listX()[0].createdAt === createX().createdAt` for all three modules, against the real local Postgres. All three failed identically: `AssertionError: expected '2026-01-01 00:00:00+00' to be '2026-01-01T00:00:00.000Z'` (share, invite and saved day).
- **Fix (2026-08-28, KI sweep):** the second of the two options filed — the columns on all three tables are now `mode: "date"`, and each module's `toDto` does the single `.toISOString()` at the DTO boundary (`row.revokedAt === null ? null : row.revokedAt.toISOString()` for the nullable ones). `mode: "date"` rather than a normalising `new Date(row.createdAt).toISOString()` in `toDto` because it makes the bug unrepeatable rather than merely absent: a row built in memory now carries `Date`s exactly like a row read back does, so a future write path cannot hand a raw ISO string through and typecheck. `readShare` passes `toDto(share)` into `toSharedView` for the same reason, so `sharedAt` takes the same one conversion.
- **No migration:** `mode` is a client-side mapping only; the column stays `timestamptz`. Confirmed with `pnpm --filter web db:generate` → "No schema changes, nothing to migrate", which created no file.
- **Proof:** the throwaway repro passes and was deleted in favour of permanent regression tests — `shares.int.test.ts` ("share timestamps have one shape": `createdAt`, `revokedAt`, and the public view's `sharedAt`), `invites.int.test.ts` ("invite timestamps have one shape": `createdAt`, `revokedAt`, `acceptedAt`), `savedDays.int.test.ts` ("saved-day timestamps have one shape": `createdAt` across `saveDay`, `listSavedDays` and `getSavedDay`). Each pins the ISO literal on both paths, which is exactly the assertion that failed before. Full `pnpm --filter web test:int` **200 passed, 20 files**; `pnpm --filter web typecheck` and `pnpm --filter web lint` clean.
- **Workaround removed:** `shares.int.test.ts`'s "revoking twice is a no-op" no longer reads the stored value back to dodge the format question — it asserts the literal on both paths, and its comment says why that is now possible.
- **Left alone deliberately:** `users`, `pages`, `trip_summaries`, `events` and `trip_memberships` still use `mode: "string"`. Their timestamps are not exposed on a write-path DTO the way these three were, so they do not show the split; converting them is a separate change with its own blast radius.
- **First noted:** 2026-08-27 (M11 link 4/6, CodeRabbit review of PR #71). **Resolved:** 2026-08-28 (KI sweep).

### KI-39 — The Japan seed's geocoder accepts any candidate inside the right city, not the right venue — RESOLVED
- **Severity:** correctness (a confidently wrong pin, same family as KI-15)
- **Area:** `apps/web/scripts/geocode-japan-seed.mts`,
  `apps/web/src/lib/japanTripSeedCoordinates.json`
- **Symptom:** the script's acceptance test (`withinBox`, a per-city bounding
  box — see the script's own header comment) only rejects a wrong-*city*
  match; it has no way to reject a wrong-*venue* match that happens to fall
  inside the correct city's box. Three of the 54 stops the script originally
  resolved were exactly that: a plausible-sounding, in-city LocationIQ result
  for the wrong place. All three were hand-verified and their entries deleted
  from the overlay (CodeRabbit's final PR #46 review, 2026-08-25) rather than
  shipped:
  - `d4-s4-kegon-falls` resolved to "Urami Falls, Nikko…" — a different
    waterfall in the same city.
  - `d11-s2-check-in-at-zentis-osaka` resolved to "Hotels Inn Osaka
    KitaUmeda…" — a different hotel in the same city.
  - `d14-s2-shinkansen-to-tokyo` resolved to Shinagawa Station — the wrong
    Shinkansen station; the real stop is Shin-Osaka.
  The overlay now carries 51 of the seed's 72 stops (down from 54); those
  three stops render no pin rather than a wrong one, which is the standing
  principle this branch established for `MapLens` — a missing pin is fine, a
  confidently wrong one is not.
- **Why not fixed here:** a name-identity check (e.g. requiring the
  candidate's own name/address to match the queried place, not just its
  coordinates falling in a box) is real design work on a script that already
  does one offline, hand-verified pass — not a mechanical fix, and explicitly
  deferred rather than bundled into a CodeRabbit-response task.
- **Fix path:** before the overlay is ever regenerated, add a name-identity
  check alongside `withinBox` — e.g. a fuzzy match between the queried place
  name and the candidate's returned `display_name`/address components —
  rejecting a same-city, different-venue candidate the box alone can't catch.
- **Cross-reference:** KI-15 — same family ("a plausible wrong location is
  worse than none"), different call site (live AI enrichment vs. this offline
  one-off script).
- **Fix (2026-08-28):** the name-identity check the fix path asked for, as a
  pure predicate — `placeNameVerdict`
  (`apps/web/src/server/ai/geocodeNameMatch.ts`, new; a sibling of
  `geocodeRegion.ts` rather than an addition to it, since that module's header
  promises arithmetic). Every *distinctive* token of the queried place — its
  own name minus category nouns ("Falls", "Station", "Hotel") and minus the
  geography already in the query (area, city, country) — must appear as a token
  of the candidate's own name (`display_name`'s leading segment). ALL tokens,
  not any: "Bread & Espresso" vs. "Cawaii Bread & Coffee" shares exactly one.
  The verdict is three-valued, and that is the load-bearing design decision:
  LocationIQ answers a romanised query with the object's *local-script* name
  whenever OSM has no `name:en` ("Meiji Jingū" -> 明治神宮), which is
  `not-comparable`, not `mismatch` — 29 of the 54 original resolutions look
  like that and every one is the right place. The script
  (`geocode-japan-seed.mts`) applies it after `withinBox`, prefers a
  name-verified candidate over a higher-ranked unverified one, reports rejects
  under "In the box but a different venue", and now prints an explicit
  "accepted but name-unverified" list so the next human pass knows which pins
  rest on the box alone.
- **Proof:** reproduced first — the real script run against the vendor rows
  the 2026-08-25 pass actually recorded (recovered from commit `7fb5da2`'s
  overlay, `fetch` stubbed, no live API): before, it wrote all three
  hand-caught wrong venues into the overlay ("Resolved 3/72"); after, "Resolved
  0/72 … 3 in box but wrong venue", each listed with the rejected candidate. A
  positive control in the same harness (Meiji Jingū local-script, Gōra Kadan
  romanised) still resolves, so the check does not simply reject everything.
  Replayed over all 54 of that run's resolutions offline: 11 mismatches — the
  3 deleted plus 8 more the same run shipped (see below) — 14 matches, 29
  not-comparable, and **no correct match rejected**. Regression test:
  `apps/web/src/server/ai/geocodeNameMatch.test.ts`, a table of those real
  vendor answers (37 cases). Checks run: `pnpm --filter web typecheck`, `pnpm
  --filter web lint`, `pnpm --filter web exec vitest run -c
  vitest.unit.config.ts src/server/ai/geocodeNameMatch.test.ts
  src/server/ai/geocodeRegion.test.ts src/lib/japanTripImporter.test.ts` (3
  files, 62 tests, all passing).
- **Found while proving it, deliberately NOT fixed here:** the same wrong-venue
  failure is *already shipped* in the committed overlay in eight more places
  the hand pass missed — `d2-s4-hama-rikyu-gardens` -> "Tokyo, Chiyoda",
  `d2-s5-yakitori-at-torishiki` -> "MeGuro, Shinagawa",
  `d3-s1-breakfast-at-bread-espresso` -> "Cawaii Bread & Coffee",
  `d3-s3-lunch-at-afuri` -> "WITH HARAJUKU", `d5-s5-omakase-at-sushi-yoshitake`
  -> "Sushi Wasabi, Shinjuku", `d7-s5-dinner-at-gion-nanba` -> "GION KIMUTAKO",
  `d9-s3-lunch-at-yoshida-ya` -> "Coffee Yoshida",
  `d9-s5-dinner-at-kichi-kichi` -> "KICHIRI 河原町店". The new check rejects all
  eight (they are the regression table's second block), so a regeneration drops
  them — but deleting eight demo pins from
  `japanTripSeedCoordinates.json` is a product-visible data decision, not this
  fix, and this task was scoped to one KI — handed back to the session that
  dispatched it to file or schedule.
- **First noted:** 2026-08-25 (M10 Wave 2 Phase 8b, PR #46's final CodeRabbit
  review round). **Resolved:** 2026-08-28.

### KI-28 — `m8-make-it-real.spec.ts`'s trip-actions menu can render its "Delete" item outside the viewport — RESOLVED
- **Severity:** reliability (no product impact observed yet; e2e flake, seen twice — see the 2026-08-28 recurrence below, which is what identified the mechanism)
- **Area:** `apps/web/src/app/(app)/page.tsx` (the trip list's per-card `Popover` menu, `align="end"`, and its per-card `TripDetail` fan-out), `apps/web/src/components/ui/popover.tsx` (the shared Radix wrapper — added 2026-08-24, see signature 2 below), `apps/web/src/components/home/TripCard.tsx`, `apps/web/e2e/m8-make-it-real.spec.ts` — and, added by the 2026-08-28 fix below because the measurement found a second growth source there, `apps/web/src/components/home/NextTripHero.tsx`
- **Symptom (2026-08-23, test-suite-overhaul Phase 3/4 final verification):** one run of the full `test:e2e:ci-like` suite (21 tests) flaked on `m8-make-it-real.spec.ts` — `page.getByRole("menuitem", { name: /delete/i }).click()` timed out after 30s with `element is outside of the viewport`, then passed cleanly on Playwright's automatic retry. Distinct from and unrelated to this session's other m8 fix (a `getByText` substring collision on a later line, already resolved — this failure never reached that line).
- **Originally proposed mechanism — MEASURED AND RULED OUT (2026-08-24).** The entry used to read: "the home trip list accumulates one card per e2e spec across a full suite run, so by the time `m8` runs the target card sits far enough down the (now long) grid that opening its `Popover` leaves the menu content with no room to flip inside the viewport." That was flagged at the time as "a plausible read of the symptom, not a diagnosis." It is now falsified. Driving m8's exact `trip actions for … → Delete` sequence against a real server and DB at the suite's own 1280x900 `desktop` viewport, with the menu deliberately opened *before* the per-card "planned of budget" lines land (that fan-out of one `GET /api/trips/:id` per visible card is the home page's only asynchronous layout shift, and it is what a long list makes slow):

  | trip cards in the list | Delete menuitem, worst top / bottom observed while open | click |
  |---|---|---|
  | 2-4 | 698 / 761 | ok |
  | 5-7 (worst case — the menu flips *above* the trigger here) | 745 / 832 | ok |
  | 8-31 | 513 / 624 | ok |
  | 32, 62, 92, 122, 182, 242 | 513 / 623 | ok |

  Viewport height is 900. The margin never fell below 68px, and **it does not shrink as the list grows** — two independent effects cap it: Playwright's own `scrollIntoViewIfNeeded` *centers* the trigger as soon as the list is long enough to need scrolling at all (so from ~8 cards up the menu starts mid-viewport, not at the edge), and Chrome's scroll anchoring absorbs nearly all of the late layout growth above the anchor. The residual anchor drift after the cost lines land is a constant ~73px at 32 cards and still ~73px at 242 cards; it is the target card's *own* row growth, not a per-row accumulation. Checked against both a dev server and a production build (`next build` + `CI=true`, i.e. the `ci-like` path the flake was actually seen on). **Do not spend another session on trip-list length.**
- **What *does* produce this exact error, both demonstrated in the same session — match a trace against these two signatures before anything else:**
  1. **The anchor leaves the viewport while the menu is open.** `@radix-ui/react-popper` positions with `strategy: "fixed"` and `shift({ limiter: limitShift() })`, so the content deliberately *follows* its anchor out of view rather than detaching from it. Scrolling the page to the top with the menu open moved the Delete item to `y=1783` in a 900px viewport, where it stayed — visible, attached, and permanently unclickable, failing with exactly `element is outside of the viewport`. Nothing on the home page was found that scrolls the window or moves the anchor that far, so this needs a source of scroll/relayout that this investigation did not find.
  2. **The popper never completes its first `computePosition`.** While `isPositioned` is false, `react-popper` parks the wrapper at `transform: translate(0, -200%)` and — unless `hideWhenDetached` is set, which this app's `Popover` does not set — leaves it fully *visible*. Forcing that state put the Delete item at `y=-123` with `isVisible() === true`, again failing with exactly `element is outside of the viewport`. This is the better fit for a failure that persisted the full 30s rather than resolving: it is a stuck state, not a transient one. It is also directly checkable from a trace — look for `translate(0, -200%)` on `[data-radix-popper-content-wrapper]` in the DOM snapshot at the failing step.
- **RECURRENCE, 2026-08-28 (PR #71, `integration-e2e` on `06031d2`) — signature 2 falsified, signature 1 confirmed, and the missing relayout source found.** The 2026-08-24 entry closed by saying signature 1 "needs a source of scroll/relayout that this investigation did not find." This run's call log contains it. The failure went, in order:

  ```
  - locator resolved to <button role="menuitem" ...>Delete</button>
  - attempting click action
    - element is visible, enabled and stable
    - scrolling into view if needed
    - done scrolling
    - <h3 ...>Oslo 1787874837059</h3> from <main ...> subtree intercepts pointer events
  - retrying click action
    - element is visible, enabled and stable
    - scrolling into view if needed
    - done scrolling
    - element is outside of the viewport      <- and from here on, every retry
  ```

  Two things follow, and they are what the previous investigation lacked:

  1. **Signature 2 is ruled out for this occurrence.** A popper parked at `translate(0, -200%)` because `computePosition` never completed is off-screen from its first frame; it can never first resolve to a real on-screen point that *another trip card's `<h3>`* is hit-testing over. The menu here was positioned correctly, then stopped being clickable. The stuck 30s that made signature 2 "the better fit" is explained instead by signature 1's own mechanism: once the anchor has moved, it stays moved.
  2. **The relayout source is the home page's own per-card `TripDetail` fan-out** — `page.tsx` fires one `GET /api/trips/:id` per visible card to fill each card's "planned of budget" line. The 2026-08-24 measurement already established that this lands ~73px of growth on the target card's *own* row (and correctly ruled out any per-row accumulation, which is why list length was a dead end). What it did not connect is that ~73px of anchor drift is *enough*: `@radix-ui/react-popper` uses `strategy: "fixed"` with `shift({ limiter: limitShift() })`, so an open menu follows its anchor rather than repositioning. The interception is that drift caught mid-flight — the point Playwright hit-tested is now over the neighbouring card — and the subsequent permanent "outside of the viewport" is the same drift after `scrollIntoViewIfNeeded` re-anchored against a row that had already moved.

  **Why it surfaced now:** M11 put `requireTripAccess` in front of `GET /api/trips/:id` (an extra membership/invite round-trip per request). The home page fans that endpoint out once per visible card in a single `Promise.all`, so on the long trip list an e2e suite accumulates, every card's cost line lands measurably later than it did when KI-28 was measured. That does not create the race — it is the same race as 2026-08-23 — but it widens the window in which the menu is opened *before* the anchor has settled. Recorded as a probability change, not a new defect: nothing in M11 touches the menu, the `Popover`, or the delete path.
- **Fix (2026-08-28):** the spec now waits for the target card's own cost line before opening its menu, so the anchor is settled before the gesture starts:

  ```ts
  const tripCard = page.getByTestId("trip-card").filter({ hasText: renamedTripName });
  await expect(tripCard.getByText(/planned of|No budget yet/)).toBeVisible();
  ```

  `TripCard`'s root gained `data-testid="trip-card"` to make a card addressable at all (the trigger's `aria-label` gives no handle on the row it belongs to). This is deliberately the KI-21 shape of fix — settle both ends *before* the gesture, rather than widen a timing budget or retry harder — and deliberately **not** a change to `Popover`'s collision/positioning config, which the note below still applies to: whether an anchored menu should follow its card or close when the card moves is a design decision, and the product-side question is filed separately below rather than guessed at here.
- **Was still open (product, not test) — CLOSED by the fix below:** the underlying behaviour is real outside the test. A user who opens a trip's actions menu on a cold home page load, before the cost lines land, can have that menu drift under an adjacent card. It is far less visible at human speed than at Playwright speed (the drift is one row, ~73px, and a real user's next click just re-opens it) which is why this is filed rather than fixed under an M11 PR. The candidate fixes are (a) `onOpenChange(false)` when the anchor moves, (b) reserving the cost line's height so the row never grows, or (c) `hideWhenDetached`. (b) is the one that removes the cause rather than reacting to it.
- **Fix (2026-08-28, KI sweep) — candidate (b), the cause removed rather than reacted to.** The cost line's height is now *reserved* whether or not it has landed: `apps/web/src/components/home/TripCard.tsx` and `apps/web/src/components/home/NextTripHero.tsx` render the slot unconditionally as `mt-1 min-h-5 leading-5` (exactly one `text-sm` line) with the text inside it, instead of rendering the whole `<div>` only when the prop is present. Absence is still honest absence — an unresolved or failed fetch renders empty space, never a fabricated figure, and `TripCard.test.tsx`'s "renders no planned-spend line" assertion is untouched and still passes. Neither `Popover` nor its collision/positioning config was touched, per the reasoning above; nothing about "does a menu follow its card, or close?" had to be decided, because after this the card does not move.

  **`NextTripHero.tsx` is outside this entry's declared Area and was changed deliberately.** Measurement (below) showed the drift is the sum of *two* sources, not one: 24px per trip card **plus 27px on the hero above the grid**, which pushes the entire grid — and any menu anchored to a card in it — down by that much. Fixing only `TripCard` would have left 27px of drift, which was measured to be enough to land the point aimed at "Delete" on "Duplicate". The hero's own cost line is the same `plannedOfBudgetLine` fed by the same fan-out, so it is the same one-line change.
- **Reproduced deterministically before the fix** (not waited for as a flake — the suite ran green on this branch beforehand). A harness held every `GET /api/trips/:id` until the actions menu was already open, then released it and measured. Against `next build` + `CI=true` at the suite's own 1280x900 viewport, 32 cards in the list:

  | card | delete item y, before → after the cost lines land | drift | what is under the point aimed at "Delete" |
  |---|---|---|---|
  | #0 | 698 → 725 | 27px | the **"Duplicate"** menu item |
  | #3 | 745 → 796 | 51px | the **"Duplicate"** menu item |
  | #6 | 513 → 588 | 75px | a **neighbouring trip card** |
  | #14 | 513 → 586 | 73px | a **neighbouring trip card** |
  | #31 | 513 → 587 | 74px | a **neighbouring trip card** |

  Every card grew 159px → 183px, and the document 2846px → 3139px. That last column is the CI failure verbatim: "a neighbouring trip card" under the pointer *is* `<h3 …> from <main …> subtree intercepts pointer events`. The same table after the fix: drift 0-1px on every card, and "Delete" still under the pointer every time.
- **Regression test:** `apps/web/e2e/m8-make-it-real.spec.ts` → "an open trip-actions menu does not drift when the cost lines land". It holds the whole per-card fan-out with `page.route` until the menu is open, releases it, and asserts (a) the card's height did not change, (b) the Delete item did not move, and (c) `document.elementFromPoint` at the exact point a click would have used still resolves to the **Delete** menu item — then clicks it for real. **Proved non-vacuous:** with only the two component changes stashed and the app rebuilt, it fails on both the first run and the retry, in the same place, with `expect(received).toBeLessThan(expected) / Expected: < 3 / Received: 24.296875` — i.e. exactly one card's growth. This is the layout invariant the entry's whole history is about, and it can no longer come back silently.
- **Proof:** `pnpm --filter web test:e2e:ci-like` — **42 passed** (the suite's 41 plus the new regression test), the only lane a verdict counts from (KI-27). Plus `pnpm --filter web typecheck` green, root `pnpm lint` green (ESLint + lint wall + colour wall, 356 files / 0 pending re-skin + case collisions), and `vitest run -c vitest.unit.config.ts src/components/home/TripCard.test.tsx src/components/home/NextTripHero.test.tsx "src/app/(app)/page.test.tsx"` — 39 passed / 1 skipped.
- **Left in place on purpose:** the spec's 2026-08-28 wait for the target card's own cost line before opening its menu. It is no longer load-bearing, but it is still the right shape for a test (settle before the gesture) and removing it would be churn.
- **Why it stayed open through 2026-08-27, and why no fix was attempted then:** the symptom was real (it cost a CI retry) but remained unexplained — closing it on a green non-reproduction would have been the KI-1 mistake ("probably a flake") in reverse. The 2026-08-28 recurrence is what supplied the missing evidence; the reasoning below is why `Popover` itself was still not touched. Nothing here justifies touching `Popover`'s collision/positioning config: signature 1 is arguably correct anchored-menu behavior and changing it is a design decision (does a menu follow its card, or close?), and signature 2 would need a real diagnosis before a `hideWhenDetached`-style change is anything but a guess.
- **Mitigation meanwhile:** `retries: process.env.CI ? 1 : 0` (Phase 1) already labels this a flake rather than a silent failure, which is how it surfaced. If it recurs, capture the trace (`trace: "on-first-retry"` is already on, and CI now uploads traces on failure) and check it against the two signatures above **before** attempting a fix.
- **Bound of this fix, measured (2026-08-28, CodeRabbit's review of PR #73 raised it and the numbers below settle it):** the reserved slot is **one** `text-sm` line, so the guarantee holds only while the money string fits on one line. Measured by injecting a long string (`¥1,234,567 planned of ¥5,000,000`) into the real rendered slot at each width against a production build:
  ```
  1440px slotW 523 | slot 20.2 -> 20.2 | card growth 0.0px
  1100px slotW 513 | slot 20.2 -> 20.2 | card growth 0.0px
   500px slotW 402 | slot 20.2 -> 20.2 | card growth 0.0px
   375px slotW 277 | slot 20.2 -> 40.4 | card growth 20.2px
   320px slotW 222 | slot 20.2 -> 40.4 | card growth 20.2px
  ```
  So the drift is gone at every width from 500px up, including the e2e suite's 1280px and every desktop width. At **375px and below** a long enough figure wraps to a second line and the card grows 20px again — the same mechanism, reintroduced. Not fixed here because the only one-line-forever fix is truncating a money figure, which hides information and is a product-visible choice, and because `responsive.spec.ts` widths are inside the region KI-46 already records as undesigned. Filed as **KI-56**.
- **First noted:** 2026-08-23 (test-suite-overhaul Phase 3/4 final verification). **Re-scoped, not resolved:** 2026-08-24 (KI-backlog session) — hypothesis measured and ruled out, no code change. **Mechanism identified and the test race fixed:** 2026-08-28 (M11 link 4/6, PR #71) — the entry stayed open for the product-side behaviour above, not for the flake. **Resolved:** 2026-08-28 (KI sweep) — the anchor drift is gone at 500px and up, and a deterministic regression test guards it; the narrow-width residue is KI-56.


### KI-54 — `activitiesEqual` ignored `city` and `countryCode`, so a change to either was invisible to diff/revert/undo — RESOLVED
- **Severity:** correctness (silent loss of a user's edit on revert/undo — same family as KI-5 and KI-42, on a different trigger)
- **Area:** `packages/domain/src/trip/equality.ts`
- **Symptom:** `activitiesEqual` compares `Location` **field by field**, and the list was hand-maintained: `name`, `lat`, `lng` (and, from KI-35, `area`). `city` and `countryCode` were never in it. `diffTripStates` is built on this predicate, so an activity whose *only* change was its city or country code compared EQUAL — the diff emitted no `ActivityUpdated`, and a revert or undo through that path silently kept the old value while the UI had already shown the new one.
- **Not hypothetical:** `city` is written by the geocoder on every place pick and is what `cityFor()` uses to name a day and pick its accent. The `accept-language=en` change (`9c3fe15`) re-renders a Japanese location's `city` and nothing else — precisely the edit this predicate could not see.
- **How it surfaced:** found while adding `area` to the same comparison for KI-35 (2026-08-28). `area` was added because omitting it would have had exactly this consequence; the two fields one line over already had it. Filed first, then **CodeRabbit independently flagged the same omission on PR #72 and rated it Major** — which is what changed the call from "file it" to "fix it here".
- **Fix (2026-08-28, PR #72):** `city` and `countryCode` added to the comparison, which is now every persisted field of `Location`. The comment above it says so and tells the next person to extend it in the same commit as any contract change.
- **Proof:** one test **per field** in `packages/domain/test/ki35-location-area.test.ts` (a single combined case would pass with only one of the two comparisons present — the very shape of this bug), each asserting both `tripStatesEqual` is false and that `diffTripStates` emits an `ActivityUpdated`; plus a replay test that a city-only diff, applied through `evolveTrip`, lands on the target state. Mutation-proved by removing each comparison in turn: dropping `city` fails 2 tests, `countryCode` 1, `area` 3.
- **Root cause, still standing:** the hand-enumeration itself, which has now bitten twice. A structural compare would make it unrepeatable. Not done here — it is a change to how equality is *defined*, with a blast radius across undo/revert/diff, and it wants its own diff.
- **First noted:** 2026-08-28 (KI-35 implementation). **Resolved:** 2026-08-28 (PR #72).


Closed issues, kept for the reasoning rather than the status. Nothing here
needs action — skip this section when triaging.

### KI-43 — The Day-columns lens stacks one full-width Banner per conflict above the board — RESOLVED

- **Severity:** cosmetic (no wrong data — but it hides the surface it sits on)
- **Area:** `apps/web/src/components/board/Board.tsx:201` (`ConflictBanner`)
- **Symptom:** `ConflictBanner` renders one full-width `Banner variant="warning"`
  per undismissed conflict, unbounded, between the tab strip and the day
  columns. The Japan seed carries 12, which is ~700px of stacked warning: at
  1440×900 the first day column is entirely below the fold, and the lens looks
  broken on open. Each banner also repeats both stops' full geocoded addresses,
  so a single line wraps to two.
- **Why the design disagrees:** the handoff never stacks conflicts. Timeline
  attaches `act.conf` (a compact tinted strip with Fix/Dismiss) directly under
  the activity it belongs to; Day columns puts a one-line `act.confShort` chip
  *inside* the card. `Column.tsx`/`ActivityCard.tsx` **already render that
  in-card treatment** — it receives `overlap` and `conflictIds` and uses them —
  so the wall above is redundant with it rather than the only route to the
  information.
- **Not just cosmetic in one respect:** Timeline's inline `OverlapWarning`
  covers *overlaps* only. The seed's conflicts are mostly distance conflicts
  ("~309 km apart on the same day"), which on Timeline reduce to a bare warning
  `Badge` with no explanation anywhere. So deleting the wall without moving the
  copy would lose it. The fix is to move the copy inline, not to drop it.
- **Fix path:** render the conflict against its subject the way the design does
  (in-card in Day columns, under-the-row in Timeline), and keep at most a
  collapsed summary at the top if a whole-trip count is still wanted.
- **Partly fixed (2026-08-26, PR #55):** the summary half is in. Above two
  undismissed conflicts the list collapses to one line ("12 things to look at
  on this trip" + Show), so the first day column now sits at y=420 of a 950px
  window instead of below the fold. Collapsed, not truncated — expanding still
  gives every conflict with its own Dismiss and jump.
- **Resolved (2026-08-28):** the second half is in, at a location Mitchell
  chose on a Vercel preview thread rather than the one the fix path above
  guessed: **the activity editor**, not an in-card chip. Opening a stop for
  editing now lists every conflict naming it
  (`apps/web/src/components/trip/editor/ActivityConflicts.tsx`, rendered by
  `ActivityEditorSheet`), in the conflict's own `description` — the same
  string `ConflictBanner` renders, so there is no second copy to keep in sync.
  Distance conflicts therefore have somewhere the words exist besides the
  board list, which is what this entry was actually about.
- **Deliberate difference from the fix path above:** the copy did not move
  in-card in Day columns or under-the-row in Timeline, and the collapsed board
  list stays exactly as PR #55 left it. Both surfaces keep their compact
  treatment (chip / `OverlapWarning` / triangle); the editor is the place the
  full text always exists. The handoff's per-lens conflict treatment
  (`act.conf` under a Timeline row, `act.confShort` inside a Day-columns card)
  is therefore still unbuilt as drawn — a design question that outlived this
  entry rather than a defect it is still carrying. If it is picked up, it
  starts from `docs/design-feedback/2026-08-26-design-sync-ui-audit.md` A2 and
  `.design-sync/handoff/DRIFT.md`, not from here.
- **Dismissed conflicts are shown too, marked rather than hidden**, and that
  is load-bearing rather than a flourish. It is what made it safe to fix the
  sibling bug in `overlapData.ts`'s `badgeableConflictSubjects`
  (2026-08-28): its dismissal exclusion was folded into the overlap branch
  (`c.kind !== OVERLAP_KIND || !surfaced(c)`), so a dismissed **non**-overlap
  still badged its card forever — banner gone, triangle stranded, nothing on
  screen to explain it or dismiss it again. Dismissal now suppresses the badge
  for every kind, because the editor is the surface that never filters.
- **First noted:** 2026-08-26 (design-sync UI audit, `docs/design-feedback/2026-08-26-design-sync-ui-audit.md` A2). **Resolved:** 2026-08-28.

### KI-35 — No true "area" field; route and place lines are a city-or-first-segment approximation — RESOLVED
- **Resolved (2026-08-28)** by adding the field the entry's own fix path named.
  `Location.area` (`packages/contracts/src/activity.ts`) is a real optional
  field — the sub-settlement locality, one level finer than `city` — populated
  by the geocoder from the same structured address breakdown and preferred
  ahead of the venue-name fallback in both helpers this entry names.
- **What was actually wrong, reproduced first.** Against the real Japan seed:
  `Location.parse({ …, area: "Nishi-Azabu" })` returned an object with `area`
  `undefined` (the contract had no such field, so zod stripped it); the
  importer's `AddActivity` for "Dinner at Gonpachi" carried
  `{name, city: "Tokyo", lat, lng}` and no area; and `shortPlace()` on the
  backlog idea "Kiyomizu-dera at golden hour" — which has an area
  ("Higashiyama") and no city — returned **`"Kiyomizu-dera"`**, a venue name
  in a slot that means "whereabouts". That is the symptom, verbatim.
- **The two helpers now order differently, on purpose.** `shortPlace()`
  (`lib/place.ts`) is `area ?? city ?? first segment of name`: it labels a
  *stop*, and a day inside one city is exactly where the city stops saying
  anything — four Tokyo stops rendered "Tokyo → Tokyo → Tokyo → Tokyo" where
  "Ōta → Shibuya → Nishi-Azabu → Ebisu" is the real shape of the day.
  `cityFor()` (`DayChips.tsx`) is `city ?? area`, null otherwise: it names the
  *day*, drives the day accent and the "Tokyo → Nikkō" transition, so a ward in
  that slot would split one city's days apart. **It has no `name` fallback** —
  this entry originally shipped `city ?? area ?? name`, written off a `main`
  that predated Mitchell's instruction on the #71 preview ("Never fall back to
  name, if you have absolutely no city, then make a new bucket with no city in
  title"), and the merge into `#71` resolved it to drop `name`. `area` does not
  violate that rule — a locality is a place — but a venue name does, and was
  how a restaurant came to label a whole day. Both orderings are commented at
  their call sites.
- **Grouping is untouched.** `calendarCityCards.ts` still groups strictly on
  `location.city`; nothing groups, colours, or buckets by `area`. It is
  display-only, as scoped.
- **The hand-enumeration sites.** Found by grepping every co-occurrence of
  `countryCode`/`lat`/`lng`/`city`, every `location.<field>` read and every
  `location: {` construction outside tests. Exactly one module compares a
  `Location` field by field — `packages/domain/src/trip/equality.ts` — and it
  now compares `area`, or `diffTripStates` would treat an area-only edit as a
  no-op and revert/undo would silently keep the old value.
  `diff.ts`, `hydrate.ts` and `contracts/src/detail.ts` pass `location`
  through whole and needed no change. Producers updated: the LocationIQ
  adapter, the AI geocode enrichment, `LocationInput`, the MSW handlers, the
  Japan seed importer (`stops[].area` / `unscheduled[].area` are no longer in
  `DROPPED_SEED_FIELDS`), `db-seed.ts`, and the domain property generator's
  location space.
- **Additive against a live database, tested as such.** `area` is `.optional()`
  exactly as `city` is, so a `trip_details.doc` written before this change
  still parses — `packages/contracts/test/ki35-location-area.test.ts` parses a
  full pre-`area` projection document with no `area` key anywhere and asserts
  it succeeds. That test exists because M18 added *required* fields to this
  same jsonb-returned-raw shape and 500'd every untouched board (fix commit
  `8abbaa3`); this is the tripwire for not repeating it.
- **Proof.** Every new test was mutation-checked: reverting `shortPlace`'s
  ordering fails 3 assertions across `place.test.ts` and
  `japanTripImporter.test.ts`; reverting `cityFor`'s fallback fails the
  DayChips area test; dropping `area` from `equality.ts` fails all three
  domain equality/diff assertions; dropping it from the importer or from the
  LocationIQ mapping fails their respective suites; making the contract field
  required fails the pre-`area`-document parse. Gates green from
  `/home/user/ki35-area`: `pnpm typecheck`, `pnpm lint`, `pnpm test`
  (139 domain + 53 contracts + 901 web), `pnpm test:int` (85), and
  `pnpm --filter web test:e2e:ci-like` (31 passed).
- **A third call site, found during the fix and also closed:**
  `TripBoardScreen.tsx`'s unscheduled rack computed a field it literally calls
  `area` as `location?.city ?? location?.name` — the same
  venue-name-in-an-area-slot shape, at a site this entry never named. It now
  calls `shortPlace()` like every other place line, so the rack picks up the
  new field and agrees with the timeline. Included because shipping an `area`
  field while a slot named `area` still rendered "Ugly Duck Coffee" would have
  left the entry half-true.
- **Found here, fixed here: KI-54.** `equality.ts` also omitted `city` and
  `countryCode` from its field-by-field `Location` comparison — the same
  hand-enumeration hole one field over, and a correctness bug rather than a
  cosmetic one (a city-only edit was invisible to `diffTripStates`, so
  revert/undo silently kept the old value). It was first *filed* as KI-54 on
  the reasoning that widening the comparison changes revert/undo semantics for
  two fields nobody asked about. CodeRabbit then flagged the same omission on
  PR #72 and rated it Major, which was the right correction: the list's own
  comment says every field the contract grows must be added to it, so those two
  were an omission rather than a decision. Fixed in the same PR — see KI-54,
  resolved above.
- **Severity:** cosmetic
- **Area:** `apps/web/src/lib/place.ts`, `apps/web/src/components/lenses/TimelineLens.tsx`, `packages/contracts/src/activity.ts` (`Location`)
- **First noted:** 2026-08-24 (M10 Wave 2 Phase 8, Task 8.7).

### KI-47 — No `tags` field on an activity, and five designed surfaces depend on one — RESOLVED
- **Resolved (2026-08-27)** by M18's contract PR. `ActivityTag`
  (`meal|lodging|ticketed|outdoors`) is a real field on `AddActivity`,
  `UpdateActivity`, both V1 event payloads and `ActivityView`, landing in the
  same contract change as `kind` exactly as the milestone intended — one
  `ActivityView` change, one command/event set, one projection, one changelog
  entry, and (as it turned out) **no migration at all**: the payload additions
  default, so every stored event replays as `planned` / `[]`.
- **Four values, not the handoff's six.** `considering` and `travel` are
  deliberately absent — `ActivityKind` already carries `idea` and `transit`,
  and two settable fields that can disagree about one fact is a bug generator.
  See the 2026-08-27 contracts changelog entry, and **KI-52** for the design
  delta this creates in the chip row. (This line said KI-50 until 2026-08-28 —
  KI-50 is the Google-sign-in preview redirect URI and has nothing to do with
  tags; KI-52 is *"The tag chip row ships four tags where the handoff designs
  six"*, and it cross-references back here.)
- **Where the tag data comes from:** the handoff export carries no tags on any
  of its 68 stops (its `enums` block lists only `stopStatus`), so the importer
  deliberately synthesises none — inferring them from title text is the prose
  parse the milestone disqualifies. `db-seed.ts` instead carries hand-authored
  tags on all 68 stops: 33 `meal`, 11 `outdoors`, 8 `ticketed`, 4 `lodging`,
  18 untagged.
- **One of the five surfaces below no longer exists — corrected 2026-08-29.**
  This entry was written against the 2026-08-24 handoff. **SPEC §11, dated
  2026-08-25, deleted the tag filter row**: *"The header filter row is **gone**.
  Tag chips on a stop are now the control: clicking 'Meal' on a stop dims
  everything not tagged Meal to 32% opacity across Timeline, Day columns,
  Calendar and Map… Single focus, one tag at a time — multi-select was the part
  that earned its keep least."* So `showTagFilter` / `tagFilters` / "Show
  everything" describe a control that was removed a day after this entry cited
  it, and **SPEC §10's "the filter row is the only way to thin a 402px column"
  is stale in the same way** — mobile thins a day with tag focus now. Nothing
  should be built against either sentence. What replaced the filter row is tag
  focus, which is **M18b**.
- **Status after M18b (2026-08-30):** chips on stop cards and the Add/Edit tag
  picker were built by M18's PR 2+; tag *focus* — the dimming behaviour that
  replaced the filter row — is **built by M18b** and the chips are now the
  control that drives it. M18b's gate has not closed (it needs a deployed walk;
  see that milestone file), but nothing about this entry is outstanding any
  more: the replacement for the deleted filter row exists. The Notebook
  repeater's `Only stops tagged …` filter (SPEC §7) belongs to **M14**, which
  owns the whole Notebook redesign by the 2026-08-23 routing, not to M18 or
  M18b.

- **Scheduled (2026-08-26):** this is now carried by **`docs/milestones/M18-stop-kind.md`**,
  which was widened on Mitchell's call — *"i dont want to do KIND and TAGS right
  now, but we can put it in a soon milestone"* — to land **both** missing
  activity fields in one contract change. `kind` and `tags` are the same piece
  of work (one `ActivityView` change, one command/event set, one projection, one
  migration-and-backfill decision, one changelog entry), and splitting them
  would pay that cost twice. This entry stays open as the detail on *tags*
  specifically; the schedule lives in the milestone.
- **Severity:** cleanup (a contract gap, not a defect — recorded so it stops
  being re-derived per surface)
- **Area:** `packages/contracts/src/activity.ts`
- **Symptom:** `Activity`/`ActivityView` carry no `tags`. The 2026-08-24 handoff
  builds five things on top of tags: chips on every stop card, ~~the tag filter
  row beside the TabStrip (`showTagFilter` / `tagFilters` / "Show everything")~~
  (**deleted by SPEC §11 the next day — see the correction at the top of this
  entry**), the Add-and-Edit-stop tag picker with its per-tag "power" hint, the
  Notebook repeater's `Only stops tagged …` filter (SPEC §7), and — most
  load-bearing — ~~SPEC §10's statement that on a 402px column the filter row is
  *the only way* to thin a day~~ (**stale for the same reason; mobile thins with
  tag focus**).
- **Why it belongs in the registry rather than here, eventually:** this is the
  same class as `rack-provenance` / `cost-estimate-state` / `budget-breakdown`
  in `preview-registry.ts` (designed, shelled, blocked on a missing field) — but
  unlike those, nothing in the build points at it, so it has no entry and no
  milestone. Give it one.
- **Adjacent, same shape:** the seed encodes per-stop `status`
  (`booked`/`hold`/`idea`/`transit`) and `who` **into the note text**
  (`db-seed.ts`), which is why cards read `(transit)` and
  `(idea) (Sam K + Jonah M)`. The design's `act.badge` (Booked/Hold/Idea) has
  no field behind it either, and the home hero's designed "7 not booked" tile
  is blocked on the same absence (see `NextTripHero.tsx:188-191`).
- **Escalated 2026-08-26 by design sync `fd2edd6` (SPEC §12).** The missing
  stop `kind` stopped being one cosmetic tile and became the mechanic of a
  whole lens: the new Calendar splits a travel day **at the last `transit`
  stop** (departing city gets a one-line strip, arriving city the full card)
  and flags `N to book` from "every stop whose kind is neither `booked` nor
  `transit`". Neither is computable while the kind lives inside note prose a
  user can edit — and parsing it back out would make a display concern depend
  on free text. The Japan seed has five travel days, so a Calendar built
  without it mis-renders a third of the trip rather than degrading quietly.
  **This wants a contract decision before any of SPEC §12's Calendar work is
  scheduled** — see `docs/design-feedback/2026-08-26-spec-12-calendar-city-view-review.md`.
- **First noted:** 2026-08-26 (design-sync UI audit, C4).

### KI-23 — The simulated model's `combined` surface never composes a page — RESOLVED
- **Severity:** cleanup (product fidelity, not correctness)
- **Area:** `apps/web/src/server/ai/simulatedModel.ts`, `apps/web/src/server/ai/simulatedModel.test.ts`
- **Symptom (as filed):** `doGenerate` mapped `surface === "page"` to `pageCalls()` and everything else (`"board"` **and** `"combined"`) to `planCalls()`, so with the `ai-live` flag off a `combined`-surface ask only ever produced board changes, even though `handleAiRequest.ts` exposes both tool sets on that surface (`surface === "combined" ? { ...planning.tools, ...buildPageTools().tools } : planning.tools`).
- **Reproduced before fixing** with the two new cases in `simulatedModel.test.ts`, against the unmodified model: `expected [ 'AddDay', 'AddDay', …(3) ] to deeply equal [ 'AddDay', 'AddDay', …(4) ]`, the diff missing exactly `- "compose_page"`; and the companion case showing `combined`'s calls were byte-identical to `board`'s with the whole `Sample page` `compose_page` input absent.
- **Fix (2026-08-26):** the ternary becomes an exhaustive `callsFor(surface)` switch — `page` → `pageCalls()`, `board` → `planCalls()`, `combined` → `[...planCalls(), ...pageCalls()]`, all in the one message the simulated model gets. Exhaustive on the `AiSurface` union on purpose: a fourth surface now fails typecheck here instead of silently inheriting the plan-only default, which is the shape of the original bug.
- **Proven by:** the same two cases now passing (`Tests 9 passed (9)` in `simulatedModel.test.ts`), and they stay as the regression test — one pinning the exact six-call tool sequence, one pinning that `combined` is the `board` calls followed by the `page` calls verbatim rather than a third hand-maintained script. Check subset: `pnpm --filter web typecheck`, `pnpm --filter web lint`, `pnpm --filter web exec vitest run -c vitest.unit.config.ts src/server/ai/simulatedModel.test.ts src/server/ai/modelSelection.test.ts` (`17 passed`). No integration/e2e run: `route.int.test.ts` injects `simulatedModel("board")`/`("page")` only, and `e2e/m10-simulated-ai.spec.ts` drives the UI, which posts the `apiClient` default surface `"board"` — nothing outside this file exercises the branch that changed.
- **Found while fixing, deliberately left alone (not part of this entry):** the `combined` branch of `handleAiRequest.ts` never reads the `compose_page` tool *result*. Only the `page` branch does (`result.toolResults.find((r) => r.toolName === "compose_page")`); the `board | combined` path resolves `planning.getCollected()` and returns `{ detail, history, message, … }` with no page content, and `ComposePanel`'s `board`/`combined` props have no `onApply`. So a page composed on the `combined` surface is discarded — for a **live** model exactly as much as for this simulated one, which is why the simulation is now faithful rather than newly wrong. Also noted: no caller in the app currently passes `surface: "combined"` at all (`composeAiPlan` defaults to `"board"`); it is API-reachable only. Worth its own entry if `combined` is ever put in front of a user.
- **First noted:** 2026-08-22 (commit `6073689`, the feature-flags / AI kill-switch branch's close-out). **Fixed:** 2026-08-26 (KI sweep).

### KI-44 — `.tc-page-editor` is applied to every notebook page and defined nowhere — RESOLVED

- **Severity:** cosmetic (every notebook page renders with no typography)
- **Area:** `apps/web/src/components/pages/editor/PageEditor.tsx:41`,
  `apps/web/src/app/globals.css`
- **Symptom (as filed):** `<EditorContent editor={editor}
  className="tc-page-editor" />` was the only occurrence of that class name in
  `apps/web/src` — there was no matching rule in `globals.css` or anywhere
  else. With Tailwind's preflight reset in force and nothing restoring it,
  `heading`, `paragraph` and list nodes all rendered at the same size and
  weight. On the seeded "Trip Overview" page, the `<h2>` "Overview" was
  visually identical to the sentence beneath it.
- **Why it went unnoticed:** the class *looks* intentional at the call site, and
  no test asserted rendered type scale. `PageEditor.test.tsx` covered behaviour,
  not appearance.
- **Reproduction (2026-08-26):** compiled the real `globals.css` with the real
  Tailwind 4.3.2 compiler and asked which declarations reached the editor's
  nodes. The compiled sheet contained **no `.tc-page-editor` rule at all**, and
  the only rule matching the editor's `<h2>` was preflight's
  `h1, h2, h3, h4, h5, h6 { font-size: inherit; font-weight: inherit }` —
  nothing matched its `<p>` at all, and `ol, ul, menu { list-style: none }`
  removed list markers too. Rendering `PageEditor` with the seeded
  `trip-overview` template confirmed the DOM side: TipTap emits bare elements
  with no class attribute —
  `<div class="tc-page-editor"><div class="tiptap ProseMirror"><h2>Overview</h2><p>What's this trip about? …</p>…`
  — so both nodes inherited body's 14px/400 and were pixel-identical.
- **Fix (2026-08-26):** defined the rule in `globals.css`'s `@layer components`.
  `h1`–`h6`, `p`, `ul`/`ol`/`li` are `@apply`ed from the *same* utilities
  `Heading` (`components/ui/heading.tsx`) and `Text` (`components/ui/text.tsx`)
  use — `font-display text-2xl/xl/lg/md`, `text-base text-ink` — so the editor
  and the rest of the app share one type scale and cannot drift; h4–h6 collapse
  onto `Heading level={4}` rather than inventing a fifth step. The column gets
  `max-w-measure` (design-system.md's prose tier), left-aligned so it stays
  flush with the page title, because `PageScreen` mounts the editor in a
  default 1120px `PageContainer`. Spacing is Tailwind's own 4px grid and
  nothing else. This is deliberately *only* the missing type — the Notebook
  redesign is audit finding C1, routed to a later milestone by
  `docs/plans/M10-delta/phase-9-gate.md`.
- **Proof:** the same compile now emits eleven `.tc-page-editor` rules;
  `h2` resolves to `font-size: var(--text-xl)` (24px) `font-weight:
  var(--font-weight-semibold)` against `p`'s `var(--text-base)` (14px), and
  `ul` to `list-style-type: disc`. Two regression tests were added to
  `PageEditor.test.tsx` (`PageEditor typography (KI-44)`): they render the
  editor, compile the real `globals.css`, and use `Element.matches()` against
  the real emitted DOM to assert every node type the editor produces is matched
  by a rule and that the heading's and paragraph's font sizes differ. Confirmed
  failing on the pre-fix `globals.css` (`expected 0 to be greater than 0`;
  `expected '' to contain 'list-style-type: disc'`) and passing after —
  `PageEditor.test.tsx` 4/4, `src/components/pages` 19/19, `tsc --noEmit`
  clean, `eslint` clean, color wall OK.
- **What a browser would still have to confirm:** jsdom applies no stylesheets
  and does no custom-property substitution, so no unit test can assert computed
  pixels here. The evidence is CSS-level (the rules exist and resolve to
  distinct tokens) plus DOM-level (the selectors match the nodes TipTap emits).
  The final visual read of the Notebook surface belongs to a real browser.
- **Cross-reference:** the broader Notebook gap is C1 in the audit; this was the
  one piece of it that was a plain bug rather than unbuilt design.
- **First noted:** 2026-08-26 (design-sync UI audit, A3). **Fixed:** 2026-08-26.

### KI-45 — `Preview size="container"`'s chip covers host content whenever the host's top-right corner is occupied — RESOLVED

- **Severity (as filed):** cosmetic (hides real numbers, including a currency amount)
- **Area:** `apps/web/src/components/ui/preview.tsx`
- **Symptom (as filed):** `size="compact"` reserves a `pr-6` gutter and is fine. `size="container"` deliberately reserved nothing — its own comment reasoned that the chip "insets to the border ... landing on the dotted border itself rather than on whatever content sits beneath". That holds only while the host's own top-right corner is empty. Observed covering content in five places: Trip settings' budget breakdown (the chip sits on Booked's `$4,088.25`), Who-is-invited (over the "Invite someone" button), the New-trip wizard's destination chips (over "Back to Kyoto"), the Unscheduled rack's provenance line, and the home Playbooks strip at 402px (over the "NEW ORLEANS" city chip).
- **Reproduced before fixing, in a real browser with real geometry.** jsdom has no layout, so the repro rendered the real `Preview` with markup copied verbatim from `SettingsSheet.tsx:256-283`/`:308-319` and `NewTripWizard.tsx:249-258`, dumped the HTML, compiled `globals.css` through `@tailwindcss/postcss`, and measured `getBoundingClientRect` in headless Chromium inside a 640px (`max-w-measure`) settings-sheet column. Overlap, chip vs. host content: budget breakdown **58.36 × 12.19px** over Booked's `$4,088.25`; who-is-invited **92.92 × 4.31px** over the "Invite someone" button; wizard destination chips **9.80 × 18.50px** over "Back to Kyoto". `document.elementFromPoint` at each chip's own centre returned the chip, not the content beneath — i.e. the chip paints over it, it is not merely a bounding-box brush. A full-page screenshot showed `$4,088.25` rendered as a bare "…5".
- **Cause:** the `container` branch of the wrapper's className added only `border border-dotted border-border-strong rounded-lg` — no reserved space in either axis — while the chip is `absolute right-1.5 top-1.5`, i.e. inside the box. Whether it covered anything was purely a question of whether the host happened to put content in its own top-right corner.
- **Fix (2026-08-26):** `container` now reserves a top strip the same way `compact` reserves a right one — `pt-7` on the wrapper (one class). The number is measured, not guessed: the chip sits at `top-1.5` (6px) and measures 18.5px tall, so it needs 24.5px; `pt-6` (24px) would have left half a pixel of overlap, `pt-7` (28px) clears it with 3.5px to spare. The stale comment that asserted `container` needed no gutter is rewritten in place with the measurements above and the reason the old reasoning only ever held for an empty corner.
- **Cascade check (the one non-obvious risk):** four container hosts pass their own `p-*` (e.g. `NewTripWizard`'s `p-1.5`, `p-3.5`), and `Preview` concatenates raw class strings rather than using `tailwind-merge`, so the winner is decided by the compiled stylesheet's order — the same fact the `relative`/`fixed` note at the top of this file rests on. Tailwind emits `padding-top` utilities after the `padding` shorthand, so `pt-7` wins the top edge and the caller keeps the other three. Verified, not assumed: `getComputedStyle(wrapper).paddingTop` on the wizard host is **6px before, 28px after**.
- **Proof:** the same three measurements re-run against the fix report **`overlap: null`** on all three hosts (chip bottom 45.5px, first content top 49px on the budget breakdown — the designed 3.5px clearance), and the screenshot shows `$4,088.25`, `owner`, `Invite someone` and `Back to Kyoto` all fully visible.
- **Regression test:** `preview.test.tsx` gains "reserves space for the container chip instead of overlapping the host", mirroring the existing `pr-6` test for `compact`. jsdom cannot measure pixels, so it asserts both halves of the pairing the browser pinned down — the wrapper's `pt-7` **and** the chip's `top-1.5` — because changing either alone re-opens the overlap. Confirmed non-vacuous: reverted against the pre-fix `preview.tsx` it fails with `Received: "relative border border-dotted border-border-strong rounded-lg "`.
- **Check subset** (per `minimal-check-subset`; one component file plus its test): `vitest run -c vitest.unit.config.ts` over the **21 test files that touch `Preview`** — **209 tests, all passing**; `pnpm --filter web typecheck` clean; `eslint` on both touched files clean. Not run, deliberately (three sibling KI agents were running concurrently and the full suite starves `waitFor` budgets — KI-13): full `pnpm check`, `test:int`, e2e. **No real-browser pass over the five named host screens was performed** — the browser evidence above is the real components' markup and the real compiled CSS, rendered standalone, not the running app.
- **Blast radius, stated plainly:** `Preview` is shared, so every one of the **18 `size="container"` call sites** now has 28px of top padding inside its dotted box and is that much taller. None of them position the wrapper (`fixed`/`absolute`/`sticky`), so nothing is height-constrained by the shift, and no container host renders absolutely-positioned children that would escape the padding. `size="compact"` is untouched.
- **One thing the entry listed that this does not close:** the Unscheduled rack's provenance line is `<Preview id="rack-provenance" size="compact">` (`UnscheduledRack.tsx:225`), not a `container` host, so whatever was seen there is either a misattribution in the audit or a separate compact-side problem. Left alone rather than folded in.
- **First noted:** 2026-08-26 (design-sync UI audit, A5). **Resolved:** 2026-08-26 (KI sweep).

### KI-41 — `commandsFor` is a scenario generator with no override surface, so it must invent data it has no business inventing — RESOLVED
- **Severity (as filed):** cleanup (no user impact — `@tc/factories` is test-fixture-only and never reaches the app bundle; this was the root cause behind KI-37 and two follow-on patches)
- **Area:** `packages/factories/src/commands.ts` (`commandsFor`, `CommandsForOptions`)
- **Symptom (as filed):** `commandsFor`'s entire override surface was `{ dayCount?: number }`, and its own comment conceded that was "only meaningful for `mappedTrip`". Everything else was a hardcoded switch on the scenario name: `dayCounts`, `activitiesPerDay`, `located`, `costed`, `unscheduledCount`, a three-element `realLocations` array cycled by index, a cost of `2500 + i * 1100`, and a time window synthesized from the loop index. Its own sibling in the same package, `tripDetailFactory`/`activityFactory` (`trip.ts`), *is* a Fishery factory with full `Partial<T>` overrides; `scenarios.threeDayTrip(overrides)` took `Partial<TripDetail>` while its command-side twin took essentially nothing.
- **Reproduced before fixing**, with a throwaway `src/ki41-repro.test.ts` (deleted after) whose four claims all held:
  - **The surface is absent.** A caller asking for its own window — `commandsFor("threeDayTrip", tripId, { timeWindow: { start: "14:00", end: "15:00" } })` — does not compile, and the emitted windows are still the invented `[{"start":"09:00","end":"10:00"},{"start":"10:00","end":"11:00"}]`. `@ts-expect-error` on that call plus `activitiesPerDay`, `unscheduledCount` and `cost` were **all four necessary** — `tsc --noEmit` was clean with them, and flipping one to the real `dayCount` option immediately produced `src/ki41-repro.test.ts(29,5): error TS2578: Unused '@ts-expect-error' directive.`, so the probe was non-vacuous rather than merely green.
  - **The invented values are what the entry claims.** `costs: [2500,3600,2500,3600,2500,3600]`, `locations: ["Rome","Kyoto","Barcelona","Rome","Kyoto","Barcelona"]`, `titles: ["Stop 1.1","Stop 1.2",…]` — none settable.
  - **The clamp does silently duplicate.** The shipped arithmetic at `i = 12..16` gives `[21:00-22:00, 22:00-23:00, 22:00-23:00, 22:00-23:00, 22:00-23:00]` — a plausible wrong answer from the 14th activity on, the KI-38 species.
  - **The projection twin does take overrides** (`scenarios.threeDayTrip({ name: "my own name" }).name === "my own name"`), confirming the asymmetry between the two halves of the same fixture.
  Baseline before any change: `pnpm --filter @tc/factories test` → **329 passed across 5 files**.
- **Fix (2026-08-26).** `commandsFor(scenario, tripId, overrides)` now resolves a `ScenarioSpec` — `dayCount`, `activitiesPerDay`, `unscheduledCount`, `startDate`, `budget`, `timeWindows`, `costs`, `locations`, `title`, `unscheduledTitle` — from the named scenario's defaults merged with `Partial<ScenarioSpec>` overrides, exactly the contract its projection twin has always had. Both types are exported from the package index. All three targets named in the entry's fix path are **deleted outright**: `timeWindowFor`, the `Math.min(…, 22:00)` clamp, and the `scenario === "overlappingDay" ? 30 : 60` `staggerMinutes` special case (`grep` for any of them in `commands.ts` now returns nothing). Windows are literal arrays indexed by an activity's position within its day — `HOURLY_WINDOWS` for the ordinary scenarios and `OVERLAPPING_WINDOWS` (`09:00-10:00` / `09:30-10:30`) stated outright for `overlappingDay`, so the overlap is declared rather than manufactured by matching a string. What justifies the helper existing (ADR-020: integration/e2e/seed need an ordered `TripCommand[]` replayed through the real write path) is untouched.
  - **The clamp's replacement is a throw, and it is reachable.** Mitchell's 2026-08-25 decision left the clamp in place on the premise that this refactor would delete it; it is gone. Because `activitiesPerDay` is now caller-settable, the over-ask it was defending against is finally *creatable*, so it is a loud `RangeError` naming the mismatch instead of a duplicate window: `commandsFor("threeDayTrip", id, { activitiesPerDay: 3 })` throws ``commandsFor("threeDayTrip"): activitiesPerDay is 3 but only 2 timeWindow(s) were supplied.`` That is caller-input validation, not defensive code for an unreachable state.
  - **`mappedTrip`'s early-return branch is folded into the same path.** It was the last place an override could be silently ignored. Its literal shape — title `Stop on day N`, a fixed `09:00-10:00` window, one distinct lat/lng per day — is now expressed as *defaults* (including a `title` override and a `dayCount`-length `locations` array), and is byte-identical to before, which matters because `e2e/m10-unscheduled-rack.spec.ts` asserts on it literally.
  - **One incidental correctness improvement:** the derived `endDate` is now computed with `Date.UTC` from the `yyyy-mm-dd` `startDate` instead of local-time `setDate`, so it cannot drift across a DST boundary.
- **Proof.** The reproduction's compile failures are gone: the same overrides now typecheck and are honored. `pnpm --filter @tc/factories test` → **346 passed across 5 files** (329 before + 17 new), with `conflicts.test.ts`'s zero-overlap assertions and its byte-identical-hourly-window differential — the guards on the clamp's removal — green unchanged. `pnpm --filter @tc/factories typecheck` and `pnpm --filter web typecheck` both clean; `scripts/check-lint-wall.mjs` and `scripts/check-case-collisions.mjs` (the only repo-wide parts of `pnpm lint`) pass.
- **Regression tests** (17, in `packages/factories/src/commands.test.ts`): a **differential against a verbatim inline copy of the pre-KI-41 implementation** asserting that all seven scenarios' command streams are unchanged (ids tokenized positionally, which also proves `MoveActivity.toDayId` still points at the right day), plus `mappedTrip` at `dayCount` 1/5/12; and coverage of every override — `timeWindows`, `dayCount`/`activitiesPerDay`/`unscheduledCount`, `startDate`→derived `endDate`, `budget`/`costs`/`locations`, `title`/`unscheduledTitle`, explicit-`undefined` not clobbering a default, contract validity under overrides, and the `RangeError`. **Confirmed non-vacuous by mutation**: shifting one default window from `10:00-11:00` to `10:30-11:30` turns **4 of the 25** tests in the file red (the differential for `threeDayTrip`, `overBudgetTrip`, `ungeocodedTrip`, and KI-37's own guard); the file also carries an explicit "is not a tautology" case.
- **Consumers:** all four measured consumers still compile untouched by behavior. `apps/web/e2e/responsive.spec.ts` (three `threeDayTrip` call sites) and `apps/web/e2e/helpers.ts` (`mappedTrip` with `{ dayCount }`) needed **no change** — the differential is what licenses that. `apps/web/src/app/api/dev/reset-demo-data/route.int.test.ts` kept `unscheduledHeavy`; only its comment changed, which was citing the now-resolved KI-37 as a live reason. `apps/web/scripts/db-seed.ts` does not call `commandsFor` and is unchanged. **Not run:** the e2e suite (`pnpm --filter web test:e2e:ci-like`) and the Postgres-backed `route.int.test.ts`, deliberately — three sibling KI agents were running concurrently and a parallel e2e run is exactly the load KI-13/KI-27 document. No e2e spec changed; both must be run in the main session before the sweep branch lands.
- **First noted:** 2026-08-25 (KI sweep — Mitchell, reviewing why a factory was synthesizing time windows from a loop index at all). **Resolved:** 2026-08-26 (KI sweep).

### KI-32 — The container image's Playwright browsers are a different build from the pinned @playwright/test — RESOLVED, repaired on session start
- **Severity:** reliability (local e2e could not run without a manual workaround; CI unaffected)
- **Area:** the remote container image's `/opt/pw-browsers`, `apps/web/package.json`'s `@playwright/test`
- **Symptom:** `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` ships Chromium build **1194**. `@playwright/test@^1.61.1` resolves to a version that wants build **1228**, so `pnpm --filter web test:e2e` fails immediately at `auth.setup.ts` with "Executable doesn't exist at /opt/pw-browsers/chromium_headless_shell-1228/...". The image's own guidance is not to run `playwright install`.
- **Scope:** local/container only. **CI is not affected** — `.github/workflows/ci.yml:88` runs `playwright install chromium` against its own cache, so CI gets the matching build and remains the authoritative e2e signal.
- **Workaround used (M10 Wave 2 Phase 6):** symlinked the missing `chromium-1228` / `chromium_headless_shell-1228` directories at the 1194 build. Chromium 141.0.7390.37 then drove the full 22-test suite green against a production build. The symlinks live in `/opt`, not the repo, and do not survive a new container. The sanctioned alternative is a Playwright `executablePath` pointing at `/opt/pw-browsers/chromium`.
- **Caveat this leaves on any local e2e result:** the suite ran on a Chromium build the pinned Playwright does not target. Nothing observed suggested a behavioral difference, but a green local run is corroboration, not a substitute for CI's.
- **RECURRED 2026-08-28, and the repair is not at fault.** A dispatched subagent's first e2e attempt died on this entry's verbatim symptom: `/opt/pw-browsers` held only build 1194 and nothing had linked 1228. Running `link_playwright_shell` from `.claude/hooks/session-start.sh` *unmodified* created and linked both directories and everything worked after — so the fix is correct, it simply had not run. The hook fires on session start; a subagent dispatched into an existing session apparently does not get one. Two consequences worth knowing: an agent that hits this may wrongly conclude the environment has no usable browser (see the browser note in `docs/guidelines/cloud-agent-sessions.md`, where two agents did exactly that on adjacent evidence), and the `/opt` symlinks do not survive a new container, so this will keep recurring per-container until the repair runs somewhere a subagent inherits it.
- **Why it was thought unfixable, and why that was wrong:** the original entry read *"it is an image-level mismatch, not a repo one — nothing in `travel-collab` produced it and no repo change fixes it."* The premise is right and the conclusion does not follow. `.claude/hooks/session-start.sh` **is** repo-owned and **does** run inside the container, which is exactly the seam where an image-level problem can be repaired from this repo. Pinning `@playwright/test` down to the 1194-era version would still be the tail wagging the dog; that was never the only option.
- **Fix (2026-08-26, PR #55):** `link_playwright_shell` in `.claude/hooks/session-start.sh` links any `chromium_headless_shell-*` build missing its binary at the first full `chromium-*/chrome-linux/chrome` in the image, on every remote session start. Deliberately generic — it matches on *an empty shell dir*, not on 1228 — so a Playwright bump does not silently reintroduce it. Verified by deleting the link and re-running the function: it repaired both 1194 and 1228, and `smoke` passed after. This also retires the entry's own caveat about local runs happening on an untargeted Chromium build, since the link is now applied deterministically rather than by hand.
- **Recurrence (2026-08-27, landing-page design pass) — the 2026-08-26 fix was
  not as generic as this entry claimed.** `test:e2e:ci-like` died at
  `auth.setup.ts` on the original symptom verbatim: `Executable doesn't exist at
  /opt/pw-browsers/chromium_headless_shell-1228/...`. The session-start hook had
  run and reported linking **1194**, not 1228. Cause: the loop globs
  `"$browsers"/chromium_headless_shell-*` and matches *an empty shell dir* — but
  a fresh container ships only `chromium_headless_shell-1194`, so the 1228
  directory does not exist at all, the glob never yields it, and nothing is
  linked. **The 2026-08-26 verification could not have caught this**: it deleted
  the *link* and left the directory in place, which is a different starting
  state from the one every new container actually has. "Matches on an empty
  shell dir, not on 1228" was true and was still insufficient.
- **Second fix (2026-08-27):** `link_playwright_shell` now also reads the
  required revisions from playwright-core's own `browsers.json` and creates the
  directory when it is missing, rather than only repairing directories that
  already exist. Still not pinned to 1228 — it tracks whatever the installed
  Playwright asks for, so a version bump is followed rather than silently
  reintroducing this. Verified from the real fresh-container state: deleted both
  `chromium-1228` and `chromium_headless_shell-1228` outright, ran the function
  alone, and it recreated and linked both (`Chromium 141.0.7390.37` responds).
  The full `test:e2e:ci-like` suite then ran 23 passed / 1 flaky (the flake is
  KI-28, unrelated).
- **Third fix (2026-08-27, PR #58 review) — the second fix was itself wrong on
  one of its two paths.** It hardcoded the destination layout, and Playwright's
  `EXECUTABLE_PATHS` is architecture-specific. From
  `playwright-core@1.61.1`'s own table:

  | browser | linux-x64 | linux-arm64 |
  |---|---|---|
  | `chromium` | `chrome-linux64/chrome` | `chrome-linux/chrome` |
  | `chromium-headless-shell` | `chrome-headless-shell-linux64/chrome-headless-shell` | `chrome-linux/headless_shell` |

  The headless-shell link was right for x64, which is the only reason the suite
  went green — that is what the e2e projects launch. Headed chromium was linked
  at the **arm64** path on an x64 container, so Playwright would never have
  found it. A dead link that costs nothing until something launches headed
  chromium, and nothing in the suite does. **This is the failure mode to
  remember: a green suite proved one of the two paths, and it was read as
  proving both.** Now derived from `uname -m`, and confirmed against
  Playwright's own resolver rather than a reading of the table —
  `chromium.executablePath()` returns
  `/opt/pw-browsers/chromium-1228/chrome-linux64/chrome`, which the hook now
  creates and previously did not.
- **Also third fix:** the manifest is resolved through `apps/web`'s own
  `@playwright/test` instead of `find node_modules/.pnpm … | head -1`. Only one
  `playwright-core` is in the store today, so this was latent, but two would
  have made the choice arbitrary and could link revisions the e2e suite does not
  use. `browsers.json` is not in playwright-core's `exports`, so the resolution
  walks up from the package main to the package root.
- **Lesson for the next "resolved" claim here:** verify an environment repair
  from the state a *new container* is in, not from the state you reached by
  partially undoing your own fix — and when a repair writes more than one path,
  a green test run only vouches for the paths that run actually exercised.
- **First noted:** 2026-08-24 (M10 Wave 2 Phase 6). **Fixed:** 2026-08-26 (PR #55, design-sync audit branch); **gap found and closed** 2026-08-27 (landing-page design pass).


### KI-36 — A failed send silently discards the entire pending queue, not just the command that failed — RESOLVED
- **Severity (as filed):** correctness (silent loss of the *rest of the queue*, not of the alert itself) — the **same bug class as KI-5**: an in-memory optimistic queue that can lose confirmed-to-the-user work without telling the user the true scope of what was lost. KI-5 is triggered by the user navigating away mid-send; this was triggered by the send itself failing.
- **Area:** `apps/web/src/components/trip/context/optimistic.ts` (`failHead`), `apps/web/src/components/trip/context/TripProvider.tsx` (the sequential sender), `apps/web/src/components/trip/SyncIndicator.tsx`, `apps/web/src/components/trip/TripHeader.tsx`
- **Symptom (as filed):** `failHead` responded to a failed send with `{ ...state, pending: [] }` — every unit still queued behind the one that just failed was dropped, not just the failed one. The visible alert (`setError` → `<p role="alert">`) reported only the server's rejection of the single failed command; it never said the queued edits behind it were also gone, nor how many. No retry path, no failure timestamp, no retained count.
- **Reproduced before fixing**, twice, both at the `TripProvider` level with a mocked `sendTripCommand`:
  1. *The filed symptom.* Dispatch `AddDay d-a`, hold its send open, dispatch `AddDay d-b` behind it (day count 1 → 3), then settle the first send as `{status: 500, message: "Server rejected: AddDay d-a"}`. Result: day count back to **1** (both edits gone), `error` = `"Server rejected: AddDay d-a"` and nothing else, and `sendTripCommand` **called once** — `d-b` was never sent, never rejected, and never mentioned.
  2. *The hot retry loop the entry's fix path would have created.* The entry says "change `failHead` to keep `pending`". Applied literally — retain the queue, record a `failedAt`, change nothing else — the sequential sender (`TripProvider.tsx`, `if (!optimistic || optimistic.pending.length === 0 || inFlight.current) return`) gates **only on emptiness**, so a retained queue re-fires the effect and re-sends the same rejected command immediately, without bound: `AssertionError: expected "spy" to be called 1 times, but got 41 times` for **one** user edit inside a 300ms window (41 = a deliberate safety cap in the probe, not a ceiling). `pending: []` was the only thing stopping a resend. Retaining the queue therefore *requires* an explicit failure gate; that is the shape the fix takes.
- **Fix (2026-08-25) — the entry's Option 1 (retain the failed head and expose a retry), chosen explicitly by Mitchell; Option 2 (persisting the queue across reloads) was not implemented.** Four parts:
  - `OptimisticState` grows `failure?: { at: string; message: string }`. `failHead(state, failure)` now returns `{ ...state, failure }` — the head **and** everything behind it are retained, nothing is discarded, and confirmed state is untouched. `clearFailure(state)` (identity when there is no failure, so it cannot cause a needless re-render) and `unsentCount(state)` join it.
  - **Time is passed in, never read inside the reducer.** `optimistic.ts` is not `packages/domain`, so Invariant 4 does not formally bind it, but the same discipline applies for a second, local reason: `failHead` is called from inside a `setOptimistic` updater, and React may invoke an updater more than once. The timestamp is built in the effect body (`new Date().toISOString()`), outside the updater — the same place, and for the same stated reason, that the existing code already decides `setError` from the outer scope. The reducer takes the instant as a parameter and is pure, so it is tested against a fixed instant.
  - The sender's early return grows an `optimistic.failure` clause. This is the load-bearing half: without it the retained queue is a runaway resend. Only `retry()` — which clears the failure and lets the effect pick the retained head back up — resumes sending. **Retry is manual: no timer, no backoff, nothing re-sends on its own.**
  - `TripProvider` exposes `sync: { unsent, failure, retry }` — a real count of unsent units (the retained queue's length, one unit per user edit), the real failure instant and message, and the manual retry. `SyncIndicator` takes `unsent`/`failure`/`onRetry` instead of `pending: boolean | number` (a boolean cannot tell "saving" from "couldn't save") and ships the third state.
- **Copy: deliberately NOT the design's.** The handoff (`dc.html:3106-3120`) labels this state **"Couldn't save — retrying"**. Nothing retries on its own, so that word would be false the moment it rendered — which is the entire reason this KI existed rather than the state shipping in Task 8b.3. What ships is **"Couldn't save"** plus a real **Retry** button, with the accessible name carrying the count the chip has no room for (`Couldn't save — 3 changes not sent`, singularised at 1) and the button named for what it does (`Retry saving 3 changes`). A test asserts the string `retrying` does **not** appear. The failure timestamp is real and is exposed on the context, but is deliberately not rendered by the indicator: an honest relative "(since …)" needs a ticking clock the component has not got. It is there for the sync-failure banner to use.
- **a11y:** the indicator stays a polite `role="status"` in the failed state rather than flipping to `role="alert"`. The page already raises the server's rejection in its own `role="alert"` (`TripBoardScreen`), so a second assertive announcement of one event would talk over itself; and a live region's role is registered when it mounts, so swapping it mid-life is unreliable in assistive tech. The failed state does have visible text (unlike the saved state), so the existing polite region announces it on change, and Retry is a real focusable `Button` with a descriptive name.
- **The `@ts-expect-error` pin is removed deliberately.** `SyncIndicator.test.tsx`'s compile-time assertion that `pending` could not be `"error"` existed to force this decision to be explicit rather than let the prop widen by drift. The decision has now been made, so the pin is replaced by tests of the real third state, and the contract note above it is rewritten. The component's header comment, which explained at length why this state does not ship, is rewritten to match reality.
- **One existing test's assertion was inverted, on purpose and not to make a failure go away.** `TripProvider.test.tsx`'s "rolls back the optimistic change on a server failure" asserted the day count returned to 1 after a failed send — i.e. that the edit was thrown away. That assertion was accurate about the code and wrong about the product: it encoded the discard this KI is about. It is now "keeps the optimistic change visible on a server failure, and reports the error", with the reason recorded inline.
- **Proof:** both reproductions re-run against the fix. (1) The queued-behind edit survives — day count stays **3**, `sync.unsent` is **2** — and after `retry()` both sends go through (`sendTripCommand` called **3** times, `unsent` → 0, failure cleared). (2) The same failing command is sent **exactly once**, with 300ms of room to run away in. The gate was mutation-tested: deleting the `optimistic.failure` clause from the sender turns three tests red at **2677**, 2 and 1535 calls. Regression tests: 7 new reducer tests in `optimistic.test.ts` (retention, verbatim failure record, purity under a fixed instant, failure surviving further enqueues, `clearFailure` identity) and 5 new provider tests in `TripProvider.test.tsx` (the no-loop guard, queue retention, real timestamp+message, retry drains the queue, failure outliving the transient page alert), plus 6 new `SyncIndicator` tests including the "does not say retrying" copy assertion.
- **Check subset** (per `minimal-check-subset`; only `apps/web/src` changed, no `packages/contracts`): `pnpm --filter web typecheck` clean, `pnpm --filter web lint` clean, and `vitest run -c vitest.unit.config.ts` over the 12 affected files — `optimistic`, `TripProvider`, `SyncIndicator`, `TripBoardScreen`, `context`, `TripHeader`, `board`, `HistoryPanel`, `SettingsSheet`, `toast`, `ActivityEditorSheet`, `TripDateControl` — **129 tests, all passing**. Not run (left to the main session, which runs them serially): the full `pnpm check`, `test:int`, e2e, and a browser walk — the failed state needs a server-side rejection that is awkward to stage in a live browser, and it is covered at the component and provider layers instead.
- **What this does NOT close.** The queue is still in memory: a reload or tab close still loses it (that is Option 2, and KI-5's other half). Task **8b.4's sync-failure banner is still not shipped** — this change only makes an honest one *possible*, by giving it a real count, a real timestamp and a real retry to render. And there is no "discard these edits" affordance: a permanently-rejected command can only be abandoned by reloading.
- **Does it make KI-42 worse?** No. `confirmHead`'s silent drop of units that no longer re-predict cleanly is untouched — same loop, same `break`, same behaviour on a successful send. The only interaction is that a queue now survives a failure instead of being emptied, so after a retry more units can reach the re-prediction path in one pass; the same units passed through it before, just spread across the edits the user had to redo by hand.
- **First noted:** 2026-08-24 (M10 Wave 2 Phase 8b, Task 8b.4). **Resolved:** 2026-08-25 (KI sweep).

### KI-38 — `uuidFrom` returns a malformed UUID instead of throwing once its sequence number is large enough — RESOLVED
- **Severity (as filed):** correctness (silent wrong output — same family as KI-36/KI-37)
- **Area:** `packages/factories/src/ids.ts` (`uuidFrom`)
- **Symptom (as filed):** `uuidFrom(sequence, salt)` built each UUID group with `hex(n, len).padStart(len, "0")`, which only *pads short* — it never truncates a hex string already longer than `len`. The `b` group (`hex(sequence + salt * 97, 4)`) outgrew its 4-hex-digit budget once `sequence + salt * 97 >= 0x10000`, and the trailing `e` segment had the same shape. The result was a string with the right dash *positions* but wrong-length *groups* — not a valid v4 UUID, not something `z.string().uuid()` accepts — returned with no error.
- **The entry's original "Bounds" paragraph was wrong, and that is the substance of this close.** It claimed this was "a latent trap for a future caller… not a live bug in any current test", reasoning that Fishery sequences start at 1 and no factory run approaches 65536. That reasoning only considered `sequence`; the overflowing expression is `sequence + salt * 97`, and `trip.ts:100` salts activity ids with `1000 + dayIndex * activitiesPerDay + i` and `trip.ts:105` salts the backlog with `5000 + i`. `1000 * 97 = 97,000` is already past `0x10000` at sequence 1, so the group overflowed on the *very first* activity of the *very first* trip any test built. **Every activity id and every backlog id `tripDetailFactory` produced was a non-UUID**, and had been since the salt scheme was introduced. The trap fires at `salt >= 676`, not at `sequence >= 65536`.
- **Reproduced before fixing.** A throwaway vitest probe (`src/ki38-repro.test.ts`, deleted after) printed the ids and validated each against `z.string().uuid()`. Direct probes: `uuidFrom(1, 1000)` → `9e377d99-17ae9-4001-a3e8-210f7f0f03e9` `groups=[8,5,4,4,12] uuid-valid=false`; `uuidFrom(1, 5000)` → `9e378d39-76689-…` likewise; `uuidFrom(65536)` → `79b10000-10000-40000-a000-9e37000010000` `groups=[8,5,5,4,13]`. Through the factory, a `dayCount: 2, activitiesPerDay: 3, unscheduledCount: 2` trip reported **`8/11 ids fail z.string().uuid()`** — every activity and backlog id, with only `tripId` and the two `dayId`s well-formed (`dayId` salts are `100 + dayIndex`, still inside the budget).
- **Why the whole suite was nevertheless green:** nothing validates a factory-built read model at runtime. `packages/contracts`'s `TripDetail` schema does declare `tripId`/`dayId`/`activityIds`/`backlog` as `z.string().uuid()`, but that schema is never `.parse()`d anywhere in the repo — it is consumed as a TypeScript type, and `z.infer` of `z.string().uuid()` is just `string`. Nor do these ids ever reach Postgres: `db-seed.ts` and `e2e/helpers.ts` go through `commandsFor`, which mints ids with `node:crypto`'s `randomUUID`, not `uuidFrom`. The bug was live, wrong, and unobservable — a fixture invariant with no enforcement, the "comment asserting an invariant nothing enforces" species again.
- **Fix (2026-08-25) — masking, deliberately *not* the "throw on out-of-range" the entry proposed.** Once the Bounds claim collapsed, throwing stopped being available: `uuidFrom(1, 1000)` is what `tripDetailFactory` does on every build, so a range guard would have thrown in ~34 consumer test files on the first line, and repairing that would have meant re-designing `trip.ts`'s salt scheme (a different file, a different blast radius). Instead each group is now clamped on *both* ends — `((n >>> 0) % 16 ** len).toString(16).padStart(len, "0")`. `% 16 ** len` is the **identity** for any value already inside its budget, so every id that was well-formed before is byte-identical after and only the already-broken ones change. The `>>> 0` already bounded the two 8-digit groups, so those were never at risk. The part of the entry's fix path that *was* still available is kept: `uuidFrom` now throws `RangeError` on a negative, non-integer or non-finite `sequence`/`salt`, since `n >>> 0` maps `NaN`, `-0` and `2**32` all onto `0` — the same silent-wrong-output class, in the one corner masking does not cover. No live caller passes such a value.
- **Blast radius on id *values*, not just id *shapes*:** `tripId` and `dayId` are unchanged (verified byte-for-byte). Activity ids and backlog ids **do change value** — necessarily, since they were malformed. Nothing can be depending on the old strings: the repo contains **no hardcoded UUID literal at all** (`grep -rE "[0-9a-f]{8}-[0-9a-f]{5,}-"` across `apps/` and `packages/` returns nothing) and **no snapshot files** (`*.snap`, `toMatchSnapshot`, `toMatchInlineSnapshot` — zero hits repo-wide), so every consumer reads ids off the object it just built. Relative *ordering* is also preserved: the leading 8-digit group dominates lexicographic comparison and is untouched, which matters because `conflicts.ts` sorts by content-derived conflict ids that embed activity ids.
- **Proof:** the same reproduction re-run is `0/11 ids fail z.string().uuid()`, with every group back to `[8,4,4,4,12]`. Regression test in a **new** `packages/factories/src/ids.test.ts` (8 tests): the three named KI-38 witnesses; a shape/version/variant sweep over 10 sequences × 12 salts spanning every budget boundary (676, 65535, 65536, 2^32); a differential against a verbatim inline copy of the pre-fix implementation over `sequence 0..200 × salt 0..300`, asserting byte-identical output everywhere the *old* code was already well-formed (>1000 pairs compared) — that is the "masking is the identity in range" claim, checked rather than asserted; determinism and collision-freeness over the salt bands `trip.ts` actually uses; the `RangeError` guards; and a `tripDetailFactory` end-to-end check that a 3-day × 12-activity + 6-backlog trip yields only valid UUIDs and no duplicates. **The test was confirmed non-vacuous**: reverted against the pre-fix `ids.ts` it reports **6 of 8 failing**; it is green on the fix. Check subset (per `minimal-check-subset`; only `packages/factories/src` changed): `pnpm --filter @tc/factories typecheck` clean, `pnpm --filter @tc/factories test` **13/13 across 2 files**, plus `scripts/check-lint-wall.mjs` and `scripts/check-case-collisions.mjs` (the only repo-wide parts of `pnpm lint`; `pnpm lint`'s eslint step is `--filter web` and does not cover this package).
- **First noted:** 2026-08-24 (M10 Wave 2 Phase 8b, found auditing the module while filing KI-37). **Resolved:** 2026-08-25 (KI backlog pass).

### KI-37 — `commandsFor`'s second-activity time window is malformed for any scenario with 2+ activities on a day — RESOLVED
- **Severity (as filed):** correctness (silent wrong output — same family as KI-36)
- **Area:** `packages/factories/src/commands.ts` (the `AddActivity` loop inside `commandsFor`)
- **Symptom (as filed):** the per-activity `timeWindow` was built as
  `` `0${9 + i}:00` `` for `start` — correct only for `i === 0` (`"09:00"`);
  for `i >= 1` the template produced `"010:00"`, five characters, which the
  contract's `HHMM` regex rejects, so the command came back `invalid-command`
  rather than as a wrong-but-usable time.
- **Reproduced first**, as a new `packages/factories/src/commands.test.ts` that
  runs every scenario's `commandsFor` output through the real `TripCommand`
  schema. Four of the seven scenarios failed, all on the same string:
  `threeDayTrip: {"type":"AddActivity",…,"title":"Stop 1.2","timeWindow":{"start":"010:00","end":"11:00"},…} -> [{"validation":"regex","code":"invalid_string","path":["timeWindow","start"]}]`,
  and identically for `overBudgetTrip`, `overlappingDay`, `ungeocodedTrip`.
  `emptyTrip` (no activities), `unscheduledHeavy` (1/day) and `mappedTrip`
  (its own literal `09:00`–`10:00` window) passed, exactly as the entry's
  Bounds predicted.
- **The `end` claim in the original entry was checked, not assumed, and holds.**
  `` `1${0 + i}:00` `` yields `"11:00"` at `i === 1` — valid — and only
  overflows at `i >= 10`; the largest `activitiesPerDay` any current scenario
  uses is 2, so `end` was never malformed in practice. Only `start` ever
  produced an invalid string.
- **Fix (2026-08-25):** the entry's own fix path. The inline template is
  replaced by a local `timeWindowFor(i)` that zero-pads with
  `String(hour).padStart(2, "0")`, so activity `i` of a day gets
  `09:00`–`10:00`, `10:00`–`11:00`, … The start hour is additionally capped at
  22, so no future scenario with a large `activitiesPerDay` can emit a `24:00`
  end or a start past the end of the day — the same class of latent overflow,
  closed by construction rather than left to the next caller. `mappedTrip`'s
  branch returns before this code and is untouched, so the shape
  `e2e/m10-unscheduled-rack.spec.ts` asserts on literally is unchanged.
- **Output change for consumers:** the only bytes that change are the ones that
  were invalid. `i === 0` windows are byte-identical (`09:00`–`10:00`), `end`
  is byte-identical everywhere, and `i === 1` `start` goes `"010:00"` →
  `"10:00"`. Of the three `commandsFor` call sites outside the package, two
  (`e2e/helpers.ts` → `mappedTrip`, `reset-demo-data/route.int.test.ts` →
  `unscheduledHeavy`) have byte-identical output. The third,
  `e2e/responsive.spec.ts` → `threeDayTrip`, now has its second-per-day
  `AddActivity` *accepted* where it was silently 400ing, so those trips hold
  six stops instead of three; that spec asserts only on rail/tab/sheet
  behaviour and no activity count or title, so nothing there depends on the
  old number.
- **Proof:** the reproduction above now passes — `pnpm --filter @tc/factories test`
  is 13/13 across `commands.test.ts` (8) and `trip.test.ts` (5), and
  `pnpm --filter @tc/factories typecheck` is clean. Check subset per
  `minimal-check-subset`: one file changed in one leaf package, no
  `packages/contracts` change, so the package's own typecheck + test is
  sufficient; the ~34 consumer test files were deliberately not run here (the
  serial full `pnpm check` covers them, and a parallel full run is the KI-13
  load pattern).
- **Regression test:** `packages/factories/src/commands.test.ts` (new file) —
  a `it.each` over every scenario name asserting every emitted command parses
  as a `TripCommand`, so any future scenario or field that violates the
  contract fails in the factory package itself rather than downstream, plus a
  literal assertion that a day's first two windows are `09:00`–`10:00` and
  `10:00`–`11:00`.
- **First noted:** 2026-08-24 (M10 Wave 2 Phase 8b, reset-demo-data fix wave). **Resolved:** 2026-08-25 (KI backlog pass).

### KI-6 — `listPages` lazy-instantiation race on concurrent first visits — RESOLVED
- **Severity (as filed):** correctness (non-atomicity), low likelihood
- **Area:** `apps/web/src/server/pages.ts` (`listPages`'s zero-rows guard that seeds a trip's default pages on first Notebook visit)
- **Symptom (as filed):** two concurrent first-visit requests (two tabs, or a double-fetch) each observe zero rows before either has inserted, and both seed — producing duplicate default pages for the same trip.
- **Reproduced first, and the reproduction needed one non-obvious ingredient.** A plain `Promise.all([listPages(t), listPages(t)])` against real Postgres *passes* on the unfixed code: with a cold `pg` pool the second call has to open a fresh connection (TCP + auth) while the first reuses a live one, so the first reliably finishes both inserts before the second even issues its `SELECT`. Pre-opening a few pool connections (four `select 1` round-trips fired concurrently before the racers start) removes that handicap and the race fires every time: both callers returned `[ 'Trip Overview', 'Trip Overview', 'Day Sheet', 'Day Sheet' ]` and a subsequent read saw the same four rows. That warm-up is now a commented, load-bearing line of the regression test — without it the test is green on broken code, which is the failure mode this entry was always at risk of.
- **Fix (2026-08-24):** the partial-index option this entry named first, because it makes the database the arbiter rather than trusting every present and future call site to be careful. Migration `0005_massive_paladin.sql` adds `pages_system_seed_unique`, a unique index on `pages (trip_id, title) WHERE actor_id = 'system'` — scoped to system-seeded rows, so users remain free to name their own pages anything, including "Trip Overview". `listPages` now seeds with one multi-row `INSERT ... ON CONFLICT DO NOTHING` followed by a re-read, instead of a per-row `createPage` loop: the racer that loses inserts nothing and reads back the winner's rows. The zero-rows check stays as an optimisation and its comment now says so explicitly (it previously claimed to *be* the idempotency guarantee — the "comment asserting an invariant nothing enforces" species from the Testing model section). The transactional alternative was rejected: with zero rows there is nothing for `SELECT ... FOR UPDATE` to lock, so it would have needed an advisory lock or `SERIALIZABLE`, both heavier and neither enforceable at the data layer.
- **The migration de-duplicates before indexing.** Any database that already hit the race holds duplicates and `CREATE UNIQUE INDEX` would fail outright on it, so `0005` first collapses each `(trip_id, title)` system group to its earliest-created row (the one the winning request returned and that any deep link points at). No-op on a clean database. This was exercised for real: the migration was applied to a dev database that the reproduction had *just* polluted with duplicates, and succeeded.
- **Proof:** the regression test (`pages.int.test.ts`, "does not duplicate default pages when two first visits race") was run in all three states. Pre-fix code with no index: fails, `expected [ 'Day Sheet', 'Day Sheet', 'Trip Overview', 'Trip Overview' ] to deeply equal [ 'Day Sheet', 'Trip Overview' ]`. Pre-fix code *with* the index: fails differently — `duplicate key value violates unique constraint "pages_system_seed_unique"` — which is what confirms the index predicate actually matches the seeded rows, and why the `ON CONFLICT DO NOTHING` in `pages.ts` is required rather than optional (without it the losing tab gets a 500 instead of its pages). Fixed code with the index: passes. Check subset (per `minimal-check-subset`; only `web` files changed, none under `packages/contracts/src`): `pnpm --filter web typecheck` clean, `pnpm --filter web lint` clean, `pnpm --filter web test:int` **80/80 across 12 files** — the whole integration suite, since the skill says integration tests don't scope cleanly file-by-file. The jsdom unit suite was skipped deliberately: no unit test imports `pages.ts` or `db/schema.ts` (both are server-only), and every consumer of the changed code is in the integration suite that ran.
- **First noted:** 2026-07-21 (M7 Task 3.2 / gate-close). **Resolved:** 2026-08-24 (KI backlog pass).
### KI-29 — a stop with two time-overlaps shows only one of them in the day columns — RESOLVED
- **Severity:** correctness (a real overlap is invisible in one view; reachable in two others)
- **Area:** `apps/web/src/components/board/Board.tsx` (`overlapsByActivity`), `apps/web/src/components/lenses/overlapData.ts` (`badgeableConflictSubjects`), `apps/web/src/components/board/ActivityCard.tsx` (the compact chip)
- **Symptom:** a stop can be the later half of more than one crossing pair — three mutually overlapping stops produce three `time-overlap` conflicts, two of which attach to the latest stop. `overlapsByActivity` keys one `Overlap` per `laterActivityId`, so the first wins and the rest are dropped. Because M10 Phase 5 also stopped passing `hasConflict` for `time-overlap` conflicts (so a stop shows the rich warning and not also a bare triangle), the dropped pair has **no day-column surface at all** — where before Phase 5 it would at least have shown a generic conflict badge. Dismissing the visible chip then leaves a second, invisible overlap on the same stop.
- **What bounds it:** no conflict is unreachable. The trip-level conflict banner still lists every overlap's description, and the Timeline lens renders every warning with its own fix and dismiss action — only the day-column view is lossy. The chip that *is* shown is accurate; nothing is misreported.
- **Why not fixed in the PR that introduced it (#29, M10 Wave 2 Phase 5):** the dropping is deliberate and documented at the call site — a column card has room for exactly one chip — but what a card should show when a stop has N overlaps is a design question, and the handoff this phase implements (`current/Trip Planner Redesign.dc.html`) specifies a single chip. Found by CodeRabbit on PR #29 and confirmed rather than dismissed; see that thread for the full exchange.
- **Options when it is picked up, cheapest first:** keep the triangle *in addition to* the chip when a stop has more than one overlap, so the extra is at least signalled (a few lines, no new design copy); render a count in the chip; or stack chips and change the card's layout. The first needs only a narrowing of `badgeableConflictSubjects` to "overlaps this card actually renders".
- **Where it gets settled:** M10 Wave 2's Phase 9 gate review (`docs/plans/M10-delta/phase-9-gate.md`), where this wave's design questions are decided.
- **Fix (2026-08-24):** the cheapest of the three options above, and only that one — `badgeableConflictSubjects` was narrowed from "every conflict whose kind isn't `time-overlap`" to "every conflict this lens does not actually render something richer for". It now takes the trip detail plus the set of overlap conflict ids the calling lens will really put on screen: `TimelineLens` passes every overlap of every day (it lays them all out, so nothing changes there), and `Board` passes the one-chip-per-stop subset that survived `overlapsByActivity`'s keying — so the pair that keying drops gets the generic triangle back on both of its subjects. Dismissal is still deliberately *not* a triangle: a dismissed overlap counts as surfaced, so dismissing a chip does not resurrect a badge, which is what the Board lens has always done for other kinds. The same narrowing incidentally re-covers any overlap no lens can render at all (a conflict naming a removed activity, or a stop whose times are gone), which had the same silent-invisibility shape. No new copy, no count in the chip, no layout change, and `ActivityCard.tsx` was not touched.
- **Only the cheapest option was taken.** A count in the chip and stacked chips remain a **Phase 9 gate design question** (`docs/plans/M10-delta/phase-9-gate.md`) — the triangle signals "there is more here than this chip says", it does not say how much or which. That is a deliberate floor, not the finished treatment.
- **Proof:** reproduced first as a failing test — three mutually overlapping stops (09:00–12:00, 10:00–13:00, 11:00–14:00) on one day produce three `time-overlap` conflicts; the two later stops each render their one chip, and before the fix `within(activity-card).queryAllByRole("img", { name: "conflict" })` was `[]` on both ("expected [] to have a length of 1 but got +0"), i.e. the third pair had no day-column surface at all. After the fix both carry exactly one triangle and the fully-chipped stop carries none. Regression tests: `board.test.tsx` "still signals an overlap that no chip could render, with the generic triangle" (the reproduction itself) plus four unit tests on the rule in `overlapData.test.ts` (rendered overlap not badged, unrendered overlap badged on both subjects, dismissed overlap not resurrected, non-overlap kinds unaffected). `pnpm --filter web exec vitest run -c vitest.unit.config.ts` over `board.test.tsx`, `TripBoardScreen.test.tsx`, `overlapData.test.ts`, `TimelineLens.test.tsx`, `ScheduleLens.test.tsx`, `OverlapWarning.test.tsx` — 107/107; `pnpm --filter web typecheck` and `pnpm --filter web lint` both clean.
- **First noted:** 2026-08-23 (PR #29 review, M10 Wave 2 Phase 5). **Resolved:** 2026-08-24.
### KI-31 — The Preview registry's orphan guard cannot see a Preview whose only usage is a dead component — RESOLVED
- **Severity (as filed):** cleanup (a guard that reads as green while not guarding)
- **Area:** `apps/web/src/lib/preview-registry.test.ts`, `apps/web/src/components/trip/AddSavedDayButton.tsx`
- **Symptom (as filed):** the orphan test scanned every non-test `.tsx` for `<Preview id=...>`, including *component definitions*. `AddSavedDayButton.tsx` self-wraps in `<Preview id="add-saved-day">`, so that registry entry counted as used purely because the file exists — but nothing in the app renders `AddSavedDayButton` any more. The `add-saved-day` entry was a live orphan the orphan guard was structurally unable to report.
- **Reproduced before fixing:** a throwaway `Ki31Probe.tsx` (a `<Preview id="ki31-probe">` in a file nothing imports) plus a matching registry entry left the old test at "2 passed" — a registry id whose only usage is its own unrendered component was invisible, exactly as filed.
- **Fix (2026-08-24), the entry's option (b):** the scanner now builds an import graph over `src/**/*.ts{,x}` (resolving `@/…` alias and relative specifiers, `.tsx`/`.ts`/`index.*`), counting only imports made by non-test files — a component whose only importer is its own unit test is not rendered by the app. Next.js app-router entry points (`page`/`layout`/`route`/…) are rendered by the framework and are exempt. The orphan check now uses only `<Preview id>` occurrences in files that are *rendered*; the "every used id is registered" check still scans every non-test file, where over-inclusion is harmless. **A second phantom-usage source turned up while proving this:** the regex also matched ids inside *comments*, and `EndOfTrip.tsx` explains in prose why it does not reuse `<Preview id="add-saved-day">` — a rendered file, so file-level reachability alone would not have caught it. Comments are now stripped before scanning.
- **Decision (Mitchell, 2026-08-24): keep the parked entry.** `AddSavedDayButton.tsx` is real code M11 will use, not dead code — the parking is correct and stays. The reasoning that produced it follows.
- **Judgement call on the now-visible `add-saved-day` orphan — reviewed and accepted:** the guard turning red on `add-saved-day` was the point, but neither cheap close was available. Deleting `AddSavedDayButton.tsx` is ruled out by `docs/plans/M10-delta/phase-6-growth.md` Step 3 item 7 ("Keep the component file"), and deleting *just* the registry entry does not typecheck — `Preview`'s `id` prop is typed `PreviewId`, so with the entry removed `pnpm --filter web typecheck` fails with `AddSavedDayButton.tsx(15,14): error TS2322: Type '"add-saved-day"' is not assignable to type …` (verified, then reverted). Dropping the entry would therefore mean gutting the Preview wrap out of the file the plan says to keep and rewriting its three tests, and would also contradict `docs/milestones/M10-visual-craft.md:101`, which records `add-saved-day` as having a real usage. Instead the exception is now *explicit and self-expiring*: a `PARKED` map names each id parked in a not-yet-rendered shell and the file that parks it, and a companion test fails if that file stops existing, stops using the id, or becomes rendered — so the entry cannot quietly outlive its reason. M11's insert-a-saved-day work removes both the parking entry and the exception.
- **Regression tests added** (`preview-registry.test.ts`, "the orphan scanner itself"): an id whose only occurrence is in an unimported component is *not* counted as used; an id in an imported component still is; a Next.js entry point counts as rendered though nothing imports it; and a measured bound (5 unimported files of 177 non-test sources today, ceiling 10%) that fails loudly if the specifier resolver ever regresses and starts reading live files as dead.
- **Proof:** with the probe in place the fixed test reports exactly one failure — `registry entry "ki31-probe" is unused — remove it (a <Preview id> inside a component nothing imports does not count)` — where the old test reported none; with the probe removed, `pnpm exec vitest run -c vitest.unit.config.ts src/lib/preview-registry.test.ts` is 7/7 green, and `pnpm --filter web typecheck` and `pnpm --filter web lint` both pass.
- **Noticed and left alone:** `components/ui/tabs.tsx` is an unused UI primitive (no Preview id, so out of this entry's blast radius).
- **First noted:** 2026-08-24 (M10 Wave 2 Phase 6). **Resolved:** 2026-08-24 (KI backlog pass).
### KI-20 — Itinerary, Daily overview and Full-trip lenses have no navigation entry — RESOLVED
- **Severity (as filed):** cosmetic (no code path is broken; a real feature is unreachable through the UI)
- **Area:** `apps/web/src/components/trip/TripViewTabs.tsx`, `apps/web/src/components/trip/context/LensRouter.tsx`
- **Symptom (as filed):** M10's four-tab strip (Timeline / Day columns / Calendar / Map) matches the redesign, which never contemplated the other three. Their components, `LensRouter` entries and `?lens=` URLs all still work — only the nav affordance is gone.
- **Reproduced before fixing (2026-08-24):** a throwaway vitest file rendered `TripViewTabs` inside a real `LensRouter` and diffed `LENSES` against the rendered `role="tab"` set. Tabs were `["Timeline", "Day columns", "Calendar", "Map"]` while `LENSES` still carried `Itinerary`, `Daily` and `Trip` with no tab of any name; a second case confirmed `?lens=Itinerary` still resolved to a live `Itinerary` lens. Unreachable-but-live, exactly as filed.
- **Decision (Mitchell, 2026-08-24): retire, not re-home.** The four-tab strip is the redesign as drawn; these three lenses were never contemplated by it. A fifth tab or an overflow menu was the rejected alternative — the "More" popover this strip replaced is precisely what M10 removed.
- **Fix (2026-08-24):** `LENSES` is now `["Board", "Map", "Schedule"]` — one entry per tab, no tab-less lens left to find. `ItineraryLens.tsx`, `DailyOverviewLens.tsx` and `FullTripOverviewLens.tsx` were deleted, along with the three data modules only they used (`itineraryData.ts`, `dailyOverviewData.ts`, `tripOverviewData.ts`) and those modules' unit tests; `TripBoardScreen.tsx` lost its three imports and three render branches. `formatMoney.ts` and the `ui/` primitives they shared with surviving lenses were left exactly where they are. **Old bookmarks degrade, they do not crash:** `LensRouter`'s derivation already fell back to `"Board"` for any unrecognised `?lens=` value, so `?lens=Itinerary` now silently lands on Day columns — that fallback is now covered by a test rather than merely being true.
- **Proof:** the same reproduction re-run shows `Itinerary`/`Daily`/`Trip` gone from `LENSES` and `?lens=Itinerary` resolving to `Board`. `pnpm --filter web typecheck` and `pnpm --filter web lint` are clean (nothing dangles — no unresolved import, no stale Preview-registry entry; the three lenses never had one). Narrowed test subset — `TripViewTabs.test.tsx`, `context.test.tsx`, `navigation.test.tsx`, `TripBoardScreen.test.tsx` — is 36/36 green.
- **Regression test:** `TripViewTabs.test.tsx` gained "exposes exactly one selected tab for every lens LensRouter accepts (KI-20)", which walks every `(lens, view)` pair, asserts exactly one tab is selected in each, and asserts the four tabs are exactly what those states cover. Adding a lens to `LENSES` without a tab for it turns that red. `TripBoardScreen.test.tsx` gained "falls back to the Board lens for a retired `?lens=` value". No test was weakened to close this: the two tests that exercised the retired lenses were removed with them, and the editor open/seed/dispatch/close coverage that happened to be driven through `ItineraryLens` was re-pointed at the surviving Schedule lens's per-activity Edit button rather than dropped.
- **Two files outside the entry's Area, flagged deliberately:** `e2e/m4-money-and-lenses.spec.ts` read its money rollups off all three retired lenses, so those assertions moved to surviving surfaces (Timeline's per-day cost pill for the day subtotal; the over-budget conflict's own "Trip total (519.00 EUR)" text for the trip-wide rollup) rather than being deleted. `TODO.md`'s design-backlog line no longer lists these three among the surfaces design owes coverage for.
- **Left standing, and deliberately kept:** `TripDetail.unscheduledCostSubtotal` lost its two *trip-page* readers here (the Full-trip and Itinerary lenses). It is **not** orphaned — the Notebook still renders it: `packages/pages/src/macros/block.ts`'s `costs.table` block macro (registered in `packages/pages/src/registry.ts`, resolved through `apps/web/src/components/pages/MacroView.tsx`) pushes an "Unscheduled" row whenever the subtotal is above zero. An earlier draft of this entry claimed it was "displayed by no UI at all"; that was wrong, and is corrected here so a future cleanup pass doesn't delete a live field on the strength of it. Whether the *trip page* should surface it again is a separate design question, not a condition of this retirement.
- **First noted:** 2026-08-14 (M10 Wave 2, Phase 1, Task 1.2). **Resolved:** 2026-08-24 (retired by decision).

### KI-18 — Day accents collide: Kyoto and Osaka render identically — RESOLVED
- **Severity:** correctness (the accent system's entire purpose is defeated)
- **Area:** `apps/web/src/lib/dayAccent.ts`
- **Symptom (as filed):** `dayAccentFor` was `djb2(city) % 5` over five families. Run over real city names, **seven of thirteen land on `danger`** (Kyoto, Osaka, Niagara Falls, Lisbon, Paris, Barcelona, Portland), three on `info`, two on `success`, one on `brand`. The design handoff's own headline trip — Tokyo -> Kyoto -> Osaka — rendered Kyoto and Osaka the same colour. A day with **no** located activity hashed the empty string into `info` and rendered bright blue, visually claiming to be a city of its own.
- **Why it happened:** the prototype used ten buckets **with linear collision probing** (`cityBuckets()`); only the bucketing was carried over, not the probing — and the probing is the part that guarantees distinctness.
- **Fix (2026-08-24, M10 Wave 2 Phase 8, Task 8.2):** `dayAccentFor` (one city at a time, so probing was structurally impossible) is gone, replaced by `dayAccents(cities: (string | null)[])`, which resolves a whole trip's cities in one call. Two-pass hash + linear-probe over the same five semantic families: distinct non-null cities are sorted (so the result is independent of the order days appear in the input) and each claims its raw `hash(city) % 5` bucket in pass 1; any city that collided in pass 1 probes forward from its hash bucket, wrapping, until it finds a free one in pass 2. Past five distinct cities every bucket eventually fills and the probe has nowhere free to go — it falls back to the raw (colliding) hash bucket rather than throwing, an explicit, tested degrade rather than a crash. `AccentFamily` gained an explicit `"neutral"` member: a day with no known city maps straight to `{ tint: "neutral", ink: "neutral", solid: "neutral" }` without ever consuming one of the five buckets, replacing the old accidental "empty string hashes to `info`" behavior with an honest "we don't know" render (moss/slate tokens) that claims no false city.
- **`dayAccent.test.ts`'s weak assertion was replaced, not kept alongside the new suite.** The old `it("spreads distinct cities across families")` — materially weaker than its name claimed, since 7-of-13 collisions didn't fail it — is gone. The new suite asserts the actual guarantees: Tokyo/Kyoto/Osaka get three distinct colours; the same city gets the same colour throughout one trip; a `null` city gets `"neutral"` without spending a bucket; assignment is independent of input order; and eight distinct cities into five buckets degrades without throwing.
- **Every caller updated to call `dayAccents` once over a whole trip's days, not per-day:** `DayChips.tsx`, `TimelineLens.tsx`, `Board.tsx`, `CalendarLens.tsx`, `mapRailData.ts` now each compute the trip's accents array once (memoized where the surrounding code already memoized) and index into it — this is what actually enables cross-day collision probing, since a per-day call can never see any other day's assignment. `PlaybookCard.tsx`, `PlaybooksStrip.tsx`, `TripCard.tsx` color one independent item at a time (no shared trip-day context to batch against) and simply call `dayAccents([x])[0]!`, preserving their prior one-item-at-a-time behavior through the new API.
- **First noted:** 2026-08-14 (external design review of PR #23). **Resolved:** 2026-08-24 (M10 Wave 2 Phase 8, Task 8.2).

### KI-33 — `UnscheduledRack.tsx` and `unscheduledRack.ts` collide on a case-insensitive filesystem, breaking two test files AND `next build` locally — RESOLVED
- **Severity (as filed):** reliability (25 unit tests failed and `pnpm --filter web build` failed outright on macOS/Windows; CI unaffected)
- **Area:** `apps/web/src/components/trip/` — the component `UnscheduledRack.tsx` and the logic module `unscheduledRack.ts` (plus their two test files, `UnscheduledRack.test.tsx` and `unscheduledRack.test.ts`, which collided on the same rule), both from M10 Wave 2 Phase 3
- **Symptom (as filed):** on a case-insensitive filesystem the specifier `@/components/trip/UnscheduledRack` could resolve to `unscheduledRack.ts` once both were in the module graph, so `TripBoardScreen` rendered `undefined` where the drawer should be. `tsc` reported TS1149; `next build` failed to compile outright, which also blocked `pnpm --filter web test:e2e:ci-like` locally — not degraded, blocked.
- **Fix (2026-08-24):** renamed the logic module to the thing it exports — `unscheduledRack.ts` → `fitIntoDay.ts`, `unscheduledRack.test.ts` → `fitIntoDay.test.ts` — which is the option this entry itself named first. Four importers updated: `board/ActivityEditor.tsx` and `board/TripBoardScreen.tsx` (the `Slot` type and `fitIntoDay` respectively), `fitIntoDay.test.ts`'s own relative import, and a stale path reference in a `lenses/TimelineLens.tsx` comment. The component keeps its name; no component file was renamed, so no import of `UnscheduledRack` changed. **Note the entry undercounted the collision** — the two *test* files collided by the same rule and were renamed together.
- **Proof, all on macOS APFS (the filesystem that exhibited the bug):** `pnpm --filter web typecheck` exits 0 (TS1149 gone); `pnpm --filter web test` is **668/668 across 102 files**, up from the 640/665 this entry describes; `pnpm --filter web build` **completes and emits a route table**, where it previously failed to compile. That third one is the material change: a production build, and therefore `test:e2e:ci-like`, is possible on a dev machine again.
- **Why it was picked up outside a Phase 3 task:** the entry asked for exactly this ("flagging for priority at the next gate review rather than leaving it indefinitely") on the grounds that it blocked building the app at all on a common dev OS. It was taken as part of the 2026-08-24 dev-speed pass rather than a milestone phase, since the thing it unblocks — trustworthy local verification — is what that pass was for.
- **First noted:** 2026-08-24 (M10 Wave 2 Phase 7). **Resolved:** 2026-08-24 (dev-speed pass).

### KI-30 — "+ Add stop" late in a day prefills an invalid time window instead of being prevented — RESOLVED
- **Severity:** correctness (a reachable action that cannot succeed; no data corruption)
- **Area:** `apps/web/src/components/lenses/TimelineLens.tsx` (`nextSlot`), `apps/web/src/lib/time.ts` (`toTimeString`'s clamp), `packages/contracts/src/activity.ts` (`TimeWindow`'s `start < end` refinement)
- **Symptom (as filed):** `nextSlot()` prefilled the add-a-stop editor with `{ start: toTimeString(lastEnd), end: toTimeString(lastEnd + DEFAULT_SLOT_MIN) }`. `toTimeString` clamps to 23:59, so on a day whose last stop already ended at or near midnight both ends collapsed to `23:59` — and `TimeWindow` refines `start < end`, so the prefilled window was invalid. The user got a validation failure from an action the UI had offered.
- **Fix (2026-08-24, M10 Wave 2 Phase 6):** `nextSlot` now returns `{ start, end } | null` and does its arithmetic in minutes, comparing against `DAY_END_MIN` *before* formatting — the rule `overlapData.ts`'s `repairedEnd()` established, which this entry named as the worked example. Three branches: an empty day prefills 09:00–10:00 (also a deliberate move from the old 06:00, per the phase file, and now agreeing with `unscheduledRack.ts`'s `DEFAULT_START_MIN`); a day with room offers `lastEnd` to `min(lastEnd + 60, DAY_END_MIN)`, so a day with 29 minutes left is offered those 29 minutes rather than a truncated hour; and a day already running to 23:59 returns `null`.
- **The decision the entry asked for — what the affordance does at the end of a day:** it is **withheld, not degraded**. On `null` the per-day dashed add row is not rendered and the day-header's "Add stop" goes `disabled` with a `title` saying why. This deliberately mirrors `suggestedEnd: null` making `OverlapWarning` render no fix button at all, so the missing control and the missing command are one rule in both places rather than the UI being trusted as the only gate. A shorter-but-real slot is offered wherever one exists; only a genuinely full day has nothing to offer.
- **The audit the entry asked for — every arithmetic caller of `toTimeString`:** `overlapData.ts:70` (`repairedEnd`) was already guarded and is the precedent. `unscheduledRack.ts:80` (the `!chosen` fallback) is safe by construction: `start = max(0, min(cursor, DAY_END_MIN − 15))` is ≤ 23:44, so `start + 15` never reaches the clamp. `unscheduledRack.ts:99` (`fitIntoDay`'s main return) is safe because every gap `freeGaps` emits ends at either a booked window's start or `DAY_END_MIN`, and `start + duration ≤ chosen.end` in every branch — the tightest being `usable < 75`, where `duration` floors at 15 and `air ≤ floor((usable − 15) / 2)`, so `air + 15 ≤ usable`. Both were left unchanged. No other caller in `apps/web/src` does arithmetic before formatting.
- **First noted:** 2026-08-23 (PR #29, while fixing the overlap-repair truncation). **Resolved:** 2026-08-24 (M10 Wave 2 Phase 6).

### KI-13 — `pnpm check` is not reliably green: jsdom component tests time out under parallel load — RESOLVED, re-scoped per the plan's own decision rule (not reproducible, not a single-run close)
- **Severity:** reliability (false failures; no product impact)
- **Area:** `apps/web` unit suite; `pnpm check` = `typecheck && lint && test` recursively
- **Prior history (2026-07-26 through 2026-08-16), unchanged, kept for context:** three independent observations of the same symptom — a generic `Test timed out in 5000ms` inside a `waitFor`/`findByText` call, a different random subset of component tests failing each run — traced across three sessions to three different *causes* of the same underlying mechanism (wall-clock `waitFor` budgets starving under resource pressure): a cold post-install state (rebuilt esbuild binaries, empty transform caches), an external CPU-heavy process sharing the machine (a game at 85.8% CPU), and a non-reproduction on a fast, idle 10-core machine even with every core deliberately saturated. That last data point is why this entry was never closed on a single green run — "probably environmental" had already been said twice.
- **This session's reproduction attempts (2026-08-23, test-suite-overhaul Phase 4, Task 4.1), per `scripts/repro-ki13.sh` (saturates every core, then runs the full apps/web unit suite):** **did not reproduce**, on either the pre-Phase-1 config (jsdom for all 95 files) or the post-Phase-1 config (Phase 1's environment split, node for 35 of them) — 95/95 files, 569/569 tests green on both, every time. `environment` did rise under saturation (post-Phase-1: 105-108s vs an idle 58s median; pre-Phase-1: 165s vs its own idle baseline) — real contention, just never enough to cross a 5-second `waitFor` budget on this hardware.
- **Task 4.4's three-times proof, all green, both conditions:** `pnpm check` **3 consecutive runs on an idle machine**, and **3 consecutive full-suite runs under `scripts/repro-ki13.sh`'s CPU saturation** — 6/6, zero failures, matching the bar this entry's own mitigation note sets ("do not trust a single `pnpm check` exit code"). **Not retested this session: the cold-install condition** (a fresh `CI=true pnpm install` with caches cleared, the 2026-07-26/07-27 trigger) — flagging this honestly rather than claiming a bar this session didn't clear; the two conditions that were retested are the ones repeatedly implicated since 2026-08-16.
- **Disposition, per `docs/plans/test-overhaul/phase-4-ki13.md`'s own decision-rule table (row 2 — "cannot reproduce on the pre-fix config either, and all three proofs are green"):** **closed as no longer reproducible**, not as root-caused. The mechanism this entry describes (wall-clock waits starving under resource pressure) was never directly observed in this session — Phase 1's environment split (fewer jsdom worlds under contention) is a plausible contributor given it measurably lowered `environment` time under load, but that is not the same claim as "found and fixed the cause," and this entry does not make the stronger claim. Real, incidental improvements landed alongside this investigation regardless of the reproduction outcome: `MoneyInput.test.tsx` (this entry's own canonical slow file, recorded at 11,675ms in-suite vs 191ms alone) and `toast.test.tsx`/`LocationInput.test.tsx` now use `userEvent.setup({ delay: null })` instead of the default import, which removes a real per-keystroke `setTimeout` `userEvent` schedules by default — a genuine, if narrower, instance of "remove the wall-clock wait" that no longer depends on whether the broader flake ever recurs. `debounce.test.ts` and `SyncIndicator.test.tsx` (also named as candidates) were audited and found already correct (fake timers already in use; no real-clock exposure at all, respectively) — no change needed.
- **If this recurs:** the reproduction condition is
  `scripts/repro-ki13.sh` — **deleted 2026-08-28** now that this entry is
  closed and the script's own header records that it reproduces nothing on this
  codebase. Retrieve it from history rather than rewriting it:
  `git log --diff-filter=D --name-only -- scripts/repro-ki13.sh`, then
  `git show <sha>^:scripts/repro-ki13.sh`. Re-run it before assuming anything, and check `ps aux` sorted by CPU for an external consumer per this entry's own long-standing mitigation — the historical causes (cold install, an external CPU hog) are both still live possibilities this closure does not rule out.
- **First noted:** 2026-07-26. **Resolved:** 2026-08-23 (test-suite-overhaul Phase 4).

### KI-19 — The e2e suite runs at exactly one viewport, so responsive bugs are invisible to it — RESOLVED, a narrow-viewport project is now a gate condition
- **Severity:** reliability (the gate couldn't see a class of real defect)
- **Area:** `apps/web/playwright.config.ts`, `apps/web/e2e/responsive.spec.ts`
- **Symptom:** M10 Wave 1's gate passed 11/11 specs against a production build while the trip page was completely inert below 1180px (KI-16). The config set `use: { baseURL }` and **no `viewport`**, so every spec ran at Playwright's 1280x720 default — above the 1179px breakpoint at which the blocking scrim turns on.
- **Fix (2026-08-23, test-suite-overhaul Phase 3, Task 3.4):** `playwright.config.ts` now declares a `"narrow"` project (1100x800, `devices["Desktop Chrome"]`) that runs only `e2e/responsive.spec.ts`, alongside the existing `"desktop"` project (1280x900, explicit rather than Playwright's un-set default — closes the blind spot the symptom above describes even for the un-narrowed suite). `responsive.spec.ts` covers five breakpoint-dependent behaviors in one spec rather than running all 15 specs at both widths: the assistant rail's overlay mode and its scrim actually dismissing it (the KI-16 regression guard), the trip page staying interactive (a view-tab click still changes the lens), a sheet's Close button staying reachable at a narrow width (KI-17's other half), the Playbooks strip's 1180px 4-col-to-2-col reflow (asserted via `getComputedStyle().gridTemplateColumns`, not a class name), and the home hero's 1024px collapse to one column (asserted the same way, at an explicit 1000px `page.setViewportSize` within the same spec — below the "narrow" project's own 1100px, which is above that particular breakpoint). All 5 verified green, part of the full 21-test suite run (`test:e2e:ci-like`).
- **Re-confirmed at M10's Wave-2 gate, 2026-08-27:** `narrow` has since grown to 11 specs (the landing page's own breakpoints were added in PR #58), and the whole suite is 31 tests across `setup`/`desktop`/`narrow`. Green 31/31 on two consecutive `test:e2e:ci-like` runs against a production build. The gate condition this entry describes is live and holding.
- **First noted:** 2026-08-14 (external design review of PR #23). **Resolved:** 2026-08-23 (test-suite-overhaul Phase 3).

### KI-21 — `m1-board.spec.ts` and `m4-money-and-lenses.spec.ts` fail intermittently under load, both inside `dragCardTo` — RESOLVED, the auto-scroll race is gone
- **Severity:** reliability (no product impact; made "full e2e suite green" an unreliable signal)
- **Area:** `apps/web/e2e/helpers.ts` (`dragCardTo`)
- **Symptom, and the trace-level root cause found 2026-08-23 (M10 Phase 3 landing session, PR #26):** `dragCardTo`'s post-move polling loop ran its full 5-second budget without a drag target's box ever registering as fully in-viewport, because a day column could sit a few px below the fold and `Board.tsx`'s drag-triggered `autoScrollWindowForElements` didn't reliably finish bringing it into view inside that budget on a loaded machine. Reproduced deterministically on the pre-fix code, on both the sandbox and real CI. Full prior history (three earlier observations across 2026-08-16 and 2026-08-23, each narrowing the mechanism) preserved in git history for this entry.
- **Fix (2026-08-23, test-suite-overhaul Phase 3, Task 3.3), in the order the plan prescribed, stopping once the drag was deterministic:** (1) Phase 1's taller default viewport (720px → 900px) removed KI-21's specific 8px-below-the-fold trigger but not the class of bug. (2) `dragCardTo` now calls `target.scrollIntoViewIfNeeded()` **before** starting the drag, rather than depending on drag-triggered auto-scroll to finish inside a hand-rolled timing budget — this removes the race entirely instead of widening the window: both ends are on screen before the mouse ever moves. (3) The manual polling loop is gone; `dragCardTo` no longer tries to guess when a drop "registered" — every caller already asserts the moved card's new location with a web-first `expect(...).toBeVisible()`, and Playwright's own auto-waiting is a better judge of that than a fixed-budget poll ever was. All three `waitForTimeout` calls in `helpers.ts` are deleted along with the loop that needed them.
- **Verified:** `m1-board.spec.ts` and `m4-money-and-lenses.spec.ts` green **10 consecutive runs** on an idle sandbox, plus **2 more runs under deliberate full-CPU-saturation load** (`for i in $(seq 1 $(nproc)); do (while :; do :; done) & done`, the exact KI-13/KI-21 reproduction condition) — 12/12, zero failures, matching this entry's own acceptance bar rather than a single green run.
- **First noted:** 2026-08-16 (map-rail-focus-tracking session). **Resolved:** 2026-08-23 (test-suite-overhaul Phase 3).

### KI-25 — The simulated-AI e2e guarantee depended on how the dev server was started — RESOLVED, the guarantee is now unconditional
- **Severity:** reliability (test-environment gap, no product impact)
- **Area:** `apps/web/playwright.config.ts`, new `apps/web/e2e/global.setup.ts` and `apps/web/src/app/api/health/ai-mode/route.ts`
- **Symptom:** `playwright.config.ts` set `AI_LIVE: "false"` in `webServer.env`, but `reuseExistingServer: !process.env.CI` meant that env block only applied when Playwright started a *fresh* server. Locally, running against an already-running dev server (the common case while iterating) ignored `webServer.env` entirely and used whatever `AI_LIVE` that server actually had, which could be `true` from a developer's `.env.local` — so a local "pass" wasn't by itself proof no real model was contacted, only CI's was.
- **Fix (2026-08-23, test-suite-overhaul Phase 3, Task 3.5):** a new unauthenticated, read-only endpoint, `GET /api/health/ai-mode`, reports `{ live: boolean }` from `modelSelection.ts`'s own `aiLive()` — the single place the flag is already resolved, not a second copy of the logic. `playwright.config.ts`'s new `globalSetup` (`e2e/global.setup.ts`) queries that endpoint once, before every project including auth setup, and **throws** if it reports `live: true` — independent of how the server was started or why. This also gives **KI-24** the observability its entry names as missing: the effective mode is now queryable rather than inferable from a log line (KI-24's own override-semantics question is untouched — this endpoint only reports the resolved mode, it does not change what sets it).
- **Verified end-to-end, both directions:** a real server started with `AI_LIVE=true` and `reuseExistingServer` (the exact scenario the symptom describes) makes the whole suite refuse to run at `globalSetup`, with the message naming the cause; the normal `AI_LIVE=false` path runs unaffected (confirmed as part of the full 21-test `test:e2e:ci-like` run).
- **First noted:** 2026-08-22 (M10 Phase 4 budget branch, PR #25). **Resolved:** 2026-08-23 (test-suite-overhaul Phase 3).

### KI-27 — Local e2e runs against `pnpm dev` are not a reliable stand-in for CI — RESOLVED, `test:e2e:ci-like` added
- **Symptom (2026-08-22/23, M10 Phase 4, PR #25):** `playwright.config.ts` started `pnpm dev` (Next.js dev server, on-demand per-route compilation) locally, only switching to `pnpm start` (the production build CI actually runs against) when `process.env.CI` was set. This produced two distinct false signals in the same session: a genuinely-fixed `Popover`/`Sheet` z-index bug looked possibly-still-broken because an unrelated spec intermittently failed against the dev server with a symptom that changed shape between runs (dev-server on-demand-compile lag, not a real regression); and a genuinely real `TripDateControl` overflow regression was initially obscured by that same dev-server noise, only reliably reproduced after rebuilding production and re-running with `CI=true`. Full original write-up preserved in git history for this entry.
- **Fix (2026-08-23, M10 Phase 3 landing session):**
  1. **`pnpm --filter web test:e2e:ci-like`** (`apps/web/package.json`) — `pnpm build && CI=true pnpm test:e2e`, a first-class command that builds production and runs the full suite against `pnpm start`, matching CI's `integration-e2e` job exactly rather than requiring anyone to remember the `CI=true` incantation.
  2. **`playwright.config.ts`'s `webServer.env`** now sets `AUTH_TRUST_HOST: "true"` when `process.env.CI` is set. Auth.js v5 rejects `next start` (production-mode) traffic from an untrusted host unless the platform sets this itself (Vercel does); CI's own workflow env already covers the real CI run, but running this config directly with just `CI=true` — which `test:e2e:ci-like` does — needs it wired in the same place `AI_LIVE`/`AUTH_DEV_LOGIN`/`DATABASE_URL` already are, not left as an undocumented env var a developer would have to already know to export. Confirmed fixed: before this change, `CI=true pnpm --filter web test:e2e` failed every spec on `UntrustedHost`; after, the `UntrustedHost` failures are gone and the suite runs 14/15 (verified locally, production build, full 15-spec suite) — the one remaining failure is `m1-board.spec.ts`'s pre-existing, unrelated drag flake (KI-21), not anything this fix touches.
  3. **`docs/guidelines/quality-enforcement.md`** documents when to reach for `test:e2e:ci-like` vs. plain `test:e2e` (fast dev-mode iteration while writing a spec vs. a trustworthy result before believing a fix or a flake, or before opening/updating a PR).
- **Deliberately not done:** mitigating `pnpm dev`'s compile lag directly (a warm-up navigation before the suite runs) — `test:e2e:ci-like` sidesteps the problem instead of papering over it, since it doesn't touch the dev server at all. `reuseExistingServer: !process.env.CI` is left as-is; dev-mode `test:e2e` is still the right tool for fast iteration on one spec, it's just no longer the only tool, and no longer implicitly trusted for a final answer.
- **Amendment (2026-08-26, PR #55 design-sync branch) — the "deliberately not done" line above is partially revisited.** This bit again, the same way and worse: `m4-money-and-lenses` failed repeatedly in the dev lane and was reported to Mitchell as environmental, "local hardware". It was neither. `playwright.config.ts` set no `timeout` and no `expect.timeout`, so every test ran on Playwright's 30s/5s defaults — budgets sized for a prebuilt server, spent instead on the cold per-route compile this entry already documents at 3.8s. The tell was in the evidence the whole time and was misread: **the failure point wandered between runs** (a rack card one run, a trip link the next, a heading the next), which is what a timeout does and what a real defect does not. Under `test:e2e:ci-like` the same spec passes in 17.9s. Container resources were never the constraint (4 CPUs, 15GB free).
- **What changed:** `timeout: process.env.CI ? 30_000 : 120_000` and `expect: { timeout: process.env.CI ? 5_000 : 20_000 }`. CI's budgets are untouched — there, slowness against a production build is a genuine regression and must still fail. This is not the warm-up navigation the entry declined; it is the non-CI budget matching what the non-CI server actually does. **It does not make the dev lane authoritative** — `test:e2e:ci-like` is still the trustworthy lane and the guidelines' rule stands unchanged. It removes a class of *false* failures from the iteration lane, which is the specific harm `quality-enforcement.md` warns about ("easy to mistake for a genuine failure"). **Measured limit of the fix:** it is enough for a single spec run alone (`m4` passes solo in the dev lane afterwards), and *not* enough for the full suite — at default worker parallelism the dev lane still failed `m4` and `m6` (21/23) because contention stretches the cold compiles further still. So this narrows the noise band; it does not move the trust boundary, and KI-27's original conclusion stands unchanged.
- **The process failure, recorded because it is the more useful lesson:** `docs/guidelines/quality-enforcement.md` already says to run `test:e2e:ci-like` "always before opening/updating a PR whose diff touches a user-facing flow", and this entry already existed. Both were on the shelf and neither was read; a day went into re-deriving KI-27 from scratch and the conclusion drawn was wrong anyway. Read `known-issues.md` for the symptom before theorising about the environment.
- **First noted:** 2026-08-22/23 (M10 Phase 4 budget branch, PR #25). **Fixed:** 2026-08-23 (M10 Phase 3 landing session).

### KI-26 — `pnpm build` warns `Module not found: '@vercel/flags-definitions'` on every production build — DOWNGRADED, confirmed harmless upstream noise
- **Severity:** cosmetic (build-log noise; does not fail the build or affect runtime) — unchanged, but now root-caused rather than merely observed.
- **Area:** `apps/web/src/server/flags.ts` → `@flags-sdk/vercel`'s `vercelAdapter()` → `@vercel/flags-core`'s bundled `dist/chunk-*.js` (`readBundledDefinitions` / `BundledSource`, `src/utils/read-bundled-definitions.ts` and `src/controller/bundled-source.ts` in the package's own source map).
- **Symptom:** every `pnpm build` (including CI's `integration-e2e` job) logs `⚠ Compiled with warnings` and `Module not found: Can't resolve '@vercel/flags-definitions'`, import trace `@vercel/flags-core` → `@flags-sdk/vercel` → `./src/server/flags.ts` → `./src/app/.well-known/vercel/flags/route.ts`. Build still completes and the app runs/deploys fine.
- **Root cause, confirmed 2026-08-23 (M10 Phase 3 landing session):** `@vercel/flags-definitions` is not a real installable dependency — it doesn't exist on the public npm registry (`npm view` 404s) and isn't listed in `@vercel/flags-core@1.7.1`'s own `dependencies`. Reading the package's unminified source (via its bundled `.cjs.map`) shows exactly what it's for: `readBundledDefinitions()` does `await import(/* turbopackOptional: true */ "@vercel/flags-definitions")` inside a `try/catch` that explicitly handles `error.code === "MODULE_NOT_FOUND"` by returning `{ definitions: null, state: "missing-file" }` — a normal, anticipated state, not an error path. This is Vercel's own build pipeline synthesizing a project-specific bundled-definitions module *only when deploying on Vercel's platform*, purely as a cold-start optimization (serving flag definitions from a bundled file instead of a network round-trip on the first evaluation). `BundledSource.tryLoad()` (the only caller relevant to this app's path) returns `undefined` on a `"missing-file"` state rather than throwing, and the SDK falls through to its live-fetch path — which is exactly what already-verified runtime behavior confirms: `aiLiveFlag` resolves correctly, and Mitchell manually verified the deployed Flags behavior end to end before PR #24 merged (see "Where we are" in `docs/STATUS.md`).
- **Why not "fixed" outright:** the only way to make the warning itself disappear is `next build --turbopack` (`apps/web/package.json`'s `dev` script already uses `--turbopack`, but `build` uses plain `next build`, i.e. webpack for production) — Turbopack is the bundler that actually understands the `turbopackOptional` hint and suppresses the warning; webpack doesn't recognize that annotation and surfaces the `Module not found` warning it can't otherwise resolve. Switching the production build's bundler is a materially larger, riskier change (Turbopack's production-build support was still maturing as of Next 15.5) than this cosmetic warning justifies, and is unrelated to Phase 3/M10 scope — not undertaken here.
- **Disposition:** downgraded from "Open, not yet investigated" to resolved-as-understood. No code change. Re-open only if a future Next.js/Turbopack-production-build adoption is on the table anyway (in which case this warning's disappearance is a nice side effect, not the driver) or if this warning is ever seen alongside an actual Flags-resolution failure (it hasn't been).
- **First noted:** 2026-08-22 (M10 Phase 4 budget branch, PR #25, reading CI's `integration-e2e` job logs). **Root-caused:** 2026-08-23 (M10 Phase 3 landing session).

### D-2 — `TripDateControl` had no UI mount point — RESOLVED
- **Decided (2026-08-22, Task 4.2, M10 Phase 4):** at the time, read as a
  deliberate "dormant, not deleted" hold, same standing principle as D-1
  (below, still open) gives anchors.
- **Correction (2026-08-22, M10 Phase 4, restore-date-editing task):** this
  was wrong — the product owner confirmed the read-only Dates row was an
  *unintentional* capability loss, not a deferral, and asked for it back.
  Unlike D-1, there was never a design decision to make dates read-only; the
  redesign spec simply didn't give `TripDateControl` a new home when it
  re-laid-out the settings sheet.
- **Fix:** the settings sheet's Dates row (`SettingsSheet.tsx`) is a real
  trigger again — clicking it opens a `Popover` that mounts
  `TripDateControl` unmodified, the same click-a-row/open-a-small-control
  idiom `TripHeader`'s own History popover uses. `TripDateControl.tsx` itself
  was never touched (its `SetTripDates`/`SetTripStartDate` dispatch logic,
  shrink-confirm dialog, and `TripDateControl.test.tsx`'s 7 tests are
  byte-identical) — only its mount point changed. This also fixed
  `e2e/m3-place-and-time.spec.ts` and `e2e/m8-make-it-real.spec.ts` (M8's own
  milestone gate spec), both of which had been failing waiting for a
  `Start date` field with nowhere to appear.
- **First noted:** 2026-08-22 (Task 4.2). **Resolved:** 2026-08-22 (same day,
  restore-date-editing task).

### KI-14 — A dismissed conflict stayed dismissed forever, silently suppressing a re-created problem — RESOLVED
- **Severity:** correctness (a real, current conflict was hidden from the user with no signal)
- **Area:** `packages/domain/src/trip/decide.ts` (`lapsedDismissals`), `TripState.dismissedConflictIds`
- **Symptom:** conflict ids are **content-derived** (`time-overlap:<dayId>:<actA>:<actB>`) and `dismissedConflictIds` was append-only, so a dismissal outlived the thing it dismissed: dismiss an overlap → fix it → re-create the same overlap and the identical id was regenerated and filtered out. Permanently invisible, no way to recover it from the UI. Plain M1/M3 behavior, reachable by anyone dragging activities around.
- **Decision (Mitchell, 2026-07-27): dismissal is OCCURRENCE-scoped**, not content-scoped — "this instance is fine; if it comes back, tell me again." Rejected the content-scoped reading ("this exact overlap is fine forever"), which is defensible for deliberately-overlapping activities but makes the dangerous failure the default. **No un-dismiss UI was added and none is needed:** a state change re-surfaces the conflict on its own, and `DismissConflict` is an ordinary command with a history entry, so undo already reverses a misclick (`diffTripStates` step 7 emits the `ConflictUndismissed`).
- **Fix (2026-07-28):** `decideTripCommand` now appends a `ConflictUndismissed` for every dismissed conflict the command stops producing, in the same batch as the causing command (so it stays one history entry, described as "… , Restored a conflict"). The invariant is that `dismissedConflictIds` only ever holds ids of currently-detected conflicts.
  - **Why decide and not evolve:** the log has to carry the lapse or a replay resurrects the stale id, and running the conflict engine inside the reducer would make every projection rebuild O(events × activities²). `decide` already called `detectConflicts` to validate `DismissConflict`.
  - **Why not read-time filtering in `tripDetailFromState`:** it would not have fixed the bug — the id survives in `TripState`, so re-creating the conflict suppresses it again; only the projection would have been lying instead of the state.
  - **Cost:** a `dismissedConflictIds.length === 0` early-out means the common case (no dismissals) does no extra work at all.
  - The client predictor (`predictBatch`) reuses the same decider, so optimistic updates lapse dismissals identically — no client/server divergence.
- **Pinned by** five tests in `dismissal.test.ts`, including two that guard against *over*-firing: a dismissal survives a command that leaves the conflict detected, and `DismissConflict` never lapses the dismissal it just created.
- **First noted:** 2026-07-27 (invariant-probe pass over the domain). **Resolved:** 2026-07-28.

### KI-1 — `diffTripStates` ignored day ORDER, so a revert could silently redate the trip — RESOLVED
- **Severity:** correctness (was logged as "reliability, possibly correctness — unconfirmed" for 14 days; it was correctness)
- **Area:** `packages/domain/src/trip/diff.ts` (step 3, day reconciliation)
- **What it actually was:** the M2 round-trip property test failed ~1-in-5 runs
  from 2026-07-12. The open question on this entry was whether the invariant was
  violated or the generator was producing states it was never meant to cover.
  **It was the code.** Shrinking the counterexample gives six operations: add day
  B, add day A, remove B, re-add B. B is appended, so an earlier state holds
  `[B, A]` while the later one holds `[A, B]` — the *same set* of dayIds in a
  different order.
- **Root cause:** step 3 rebuilt day order only when a target day was *missing*
  from current (`firstMissing !== -1`), resting on its own comment's claim that
  "both states' day lists preserve the stream's original append order". Removing
  and re-adding a day breaks that claim. With nothing missing, the diff emitted
  **no day events at all**, so `RevertToState`/undo/redo produced the wrong day
  sequence — and a day's ordinal *is* its array position, so wrong order silently
  redates every activity after it.
- **Fix (2026-07-27):** compare survivors against the target position by
  position and rebuild from the first index where they disagree. One rule covers
  both missing-day and order-only divergence, and minimality is preserved (an
  append-only difference still emits just the `DayAdded`; identical lists still
  emit nothing). Pinned by three deterministic regression tests in
  `diff.property.test.ts` ("diffTripStates day ordering (KI-1 regression)").
- **Reachability while it was open:** latent, never active. The UI mints
  `crypto.randomUUID()` per `AddDay` and the AI resolver mints ids server-side,
  so no code path re-added a dayId. It would have stopped being latent at M13
  (concurrent replay) and M11 (fork-with-lineage, where preserving day ids across
  a clone is the obvious implementation).
- **Lesson worth keeping:** a property test found a genuine correctness bug in
  the most-trusted subsystem and it was filed as possible flake for two weeks.
  Seven runs and reading the shrunk counterexample was all it took. **A
  `fast-check` failure that reproduces from its own seed is a bug report, not
  noise** — see KI-13 for why a genuinely flaky suite makes that mistake easy.
- **First noted:** 2026-07-12 (M5 Wave-2 integration). **Resolved:** 2026-07-27.

### KI-7 — `ai` / `@ai-sdk/gateway` provider-type version skew (V1 vs V2) — RESOLVED
- **Severity:** was assumed type-level only; turned out to be a genuine
  runtime incompatibility (see Correction below).
- **Area:** `apps/web/src/server/ai/handleAiRequest.ts` (`aiModel()` call
  site) — corrects the original entry's `route.ts` reference; the handler
  moved to its own module in a later fix (Next.js route-export rule).
- **Symptom:** the installed `@ai-sdk/gateway` resolved to `1.0.41`, built
  against `@ai-sdk/provider`'s `LanguageModelV2`, while the repo pinned
  `"ai": "^4.0.0"`, whose `LanguageModel`/`generateText` types are `V1`.
  `aiModel()`'s return type didn't structurally satisfy `LanguageModel` per
  TypeScript, bridged at the time with a documented cast.
- **Correction (2026-07-21, after a live call was made):** this was NOT
  type-level only. `ai@4`'s `generateText` checks a model's
  `specificationVersion` at runtime and throws `"Unsupported model version.
  AI SDK 4 only supports models that implement specification version 'v1'.
  Please upgrade to AI SDK 5 to use this model."` — the cast satisfied the
  compiler but not the actual runtime check, so every real (non-mocked) call
  through this path would have failed with a 422. Confirmed against npm:
  every published `@ai-sdk/gateway` version since its first 1.0.0 stable
  release targets the V2+ spec — there was no V1-compatible gateway version
  to pin to instead.
- **Fix:** upgraded straight to latest (`ai@^7.0.34`,
  `@ai-sdk/gateway@^4.0.26`) rather than stopping at v5, since three real
  breaking-change generations (v5/v6/v7) existed and stopping partway would
  have deferred two more migrations. The cast is gone; `aiModel()`'s return
  type now satisfies `LanguageModel` directly (both packages build against
  the same `@ai-sdk/provider@4.0.3`).
- **First noted:** 2026-07-21 (M7 Task 5.5 / gate-close). **Resolved:**
  2026-07-21 (AI SDK v4→v7 upgrade, post-merge PR fix).

### KI-8 — AI planning tools: verbatim-id/format gaps in the same class as the `AddActivity.dayId` bug — RESOLVED
- **Severity:** correctness (unrecoverable whole-batch failures / one silent data-corruption case)
- **Area:** `apps/web/src/server/ai/{planningTools,context,handleAiRequest}.ts`
- **Background:** a real (non-mock) model's `AddActivity` batch failed entirely with `day-not-found` because `AddActivity.dayId` required an exact UUID copied verbatim from context, with no fallback — unlike `UpdateActivity`/`MoveActivity`/`RemoveActivity`, whose id-bearing fields were already swapped for human-friendly `*Ref` fields resolved via `buildRefResolver` (`REF_TOOL_TYPES` in `planningTools.ts`). That specific bug was fixed first (`AddActivity` now resolves `dayRef`), then a full audit (2026-07-24) found the same bug class in three more places, all now fixed:
  - **`RemoveDay.dayId` → `dayRef`:** mirrors the `AddActivity` fix (resolved via `resolver.resolveDay`), plus a guard that rejects a ref resolving to the backlog (`null`/"backlog") — `RemoveDay` has no backlog concept, so it never builds a command with no `dayId`.
  - **`DismissConflict.conflictId` → `conflictRef`:** active (non-dismissed) conflicts are now surfaced in the typed context envelope (`context.ts` `activeConflicts` → `AiEnvelope.conflicts`) in a stable `{ ref, kind, description }` form on planning surfaces; the model dismisses one by its 1-based `ref`, resolved server-side back to the real compound id. The raw UUID-embedding id is never shown to the model. Chosen over a read-only list-conflicts tool to fit ADR-015's "typed context envelope, not a transcript dump".
  - **`Money.amountMinor` silent corruption:** mitigated at the prompt/description layer — every money-bearing tool description (`SetTripBudget`, `AddActivity`/`UpdateActivity`) and the system prompt now state amounts are integer minor units (cents), with a worked example. This is a soft guard (a model can still emit a wrong-magnitude int); the durable, type-enforced follow-up is tracked in **KI-9**.
  - **Minor cleanups:** the "generate a fresh random UUID" system-prompt instruction now covers `AddDay.dayId` (not just `activityId`); the system prompt now spells out the case-sensitive enum/code formats (`Weekday` `mon`..`sun`, uppercase ISO-4217 currency, uppercase ISO-3166 country) that otherwise fail at the tool-time Zod boundary.
  - Also hardened alongside: the planning tools now build each command via `BatchableCommand.safeParse` (a shared `collect()` choke point) instead of an unchecked `as` cast, so a resolver/schema drift fails at the tool with a clear error instead of relying solely on the downstream batch re-parse. `pageTools.ts` was audited and found clean (closed-enum macro names, server-resolved day binding).
- **First noted:** 2026-07-24 (M7, post-real-model testing; full audit via subagent). **Resolved:** 2026-07-24 (M7; RemoveDay/DismissConflict/Money/prompt fixes + `collect()` parse boundary).

### KI-2 — Money formatting differs between UI and domain conflict text — RESOLVED
- **Severity:** cosmetic
- **Area:** `apps/web/src/components/lenses/formatMoney.ts` vs. the domain's
  `fmt` in `packages/domain/src/trip/conflicts.ts`
- **Symptom:** the UI groups thousands (`1,111,106.00 USD`, added in M5 Wave-3
  for comment #22), but the **over-budget conflict banner text is generated in
  `packages/domain`** and stayed ungrouped, so the same amount could render
  two ways. Accepted knowingly at the time: `packages/domain` was off-limits
  to that UI-only wave.
- **Fix (2026-08-09, Task 19):** grouped the domain's `fmt` the same way —
  `Math.abs(minor) / 100` through `toLocaleString("en-US", { minimumFractionDigits:
  2, maximumFractionDigits: 2 })` with a manual sign prefix, mirroring
  `formatAmount`'s own construction in `formatMoney.ts`. This is a real
  `packages/domain` change — an explicitly pre-approved, one-time exception to
  M10's "zero diff to `packages/`" rule (Mitchell, mid-session decision on
  Task 19); it does not reopen `packages/domain` generally.
- **Proof:** `packages/domain/test/over-budget.test.ts` adds a case asserting
  the over-budget conflict description renders `"Trip total (1,111,107.00
  USD) exceeds the budget (1.00 USD) by 1,111,106.00 USD."` for a
  budget/cost pair chosen so the difference matches
  `formatMoney.test.ts`'s existing `111110600` minor-unit grouping fixture —
  same amount, same grouped string, on both surfaces.
- **First noted:** 2026-07-13 (M5 Wave-3). **Resolved:** 2026-08-09 (Task 19).
- **Re-confirmed (2026-08-22, Task 4.1, M10 Phase 4):** extended the gate to
  every new per-stop/per-day/per-trip cost surface added this task —
  `TimelineLens`'s activity-row cost and day-header cost chip, the board
  `ActivityCard`'s cost, and `NextTripHero`'s "planned of budget" line — all
  route through `formatMoney`, keyed off the trip's own `currency` (never a
  per-`Money` read). Audit: `grep -rn "amountMinor" apps/web/src/components |
  grep -v formatMoney` turns up only test fixture literals, `MoneyInput`'s own
  edit-field parsing (no currency suffix needed there), and
  `ItineraryLens.tsx`'s `formatAmount` alias (`import { formatMoney as
  formatAmount }` — already the real formatter under a local name). No
  violations found; the entry still reads true.

### KI-16 — The assistant rail's scrim makes the whole trip page inert below 1180px — RESOLVED
- **Severity:** correctness (the page does not respond to input at all)
- **Area:** `apps/web/src/components/assistant/AssistantRail.tsx` (the scrim div), `apps/web/src/app/globals.css:101-108`
- **Symptom:** on any viewport narrower than 1180px, every control on `/trips/[tripId]` is dead — tabs, day chips, activity cards, Add stop, edit, remove, drag and drop. Measured live at 1100x800: `document.elementFromPoint(200, 500)` returns `div.assistant-rail-scrim` over a day column, and clicking the "Timeline" tab does nothing.
- **Why it happens:** the rail always rendered `<div aria-hidden className="assistant-rail-scrim fixed inset-0 z-40 bg-ink/32" />` with `pointer-events: auto` and **no click handler**. `globals.css` turns it on at `max-width: 1179px`. In the design prototype the scrim is `onClick={{ closeAsst }}` — dismissing the rail is its only purpose. Ours blocked and dismissed nothing.
- **Why the gate missed it:** see KI-19.
- **Fix (2026-08-14, `fe6c0f7`):** the scrim is now a real `<button type="button" aria-label="Close the assistant" onClick={onHide}>`, same visual layer, but it dismisses the rail on click instead of just sitting over the page. Follow-up (`d0b1f32`) added the `no-restricted-syntax` eslint-disable the raw-`<button>` lint rule requires outside `components/ui`, with a comment explaining why the `Button` primitive doesn't fit an invisible full-viewport click-catcher.
- **First noted:** 2026-08-14 (external design review of PR #23). **Resolved:** 2026-08-14 (M10 Wave 2, Phase 0, Task 0.1).

### KI-17 — Sheets and dialogs render underneath the assistant rail — RESOLVED
- **Severity:** correctness (more than half of the most-used form is unreachable)
- **Area:** `apps/web/src/components/ui/sheet.tsx:29-30`, `apps/web/src/components/ui/dialog.tsx:11-12`
- **Symptom:** with the rail open at 1280px, the Add-stop / edit-activity sheet is covered on its right ~356px, including its title and its Close button. Measured: `[role="dialog"]` spans x 640-1280 with `z-index: auto`; `aside[aria-label="Assistant"]` spans x 924-1280 with `z-index: 50`.
- **Why it happens:** neither primitive set **any** z-index, so Radix's portalled content stacked purely by DOM order and lost to a fixed `z-50` sibling rendered outside the portal.
- **Fix (2026-08-14, `d473cb2`):** a named `.overlay-layer { z-index: 60; }` class in `globals.css` (Tailwind's scale stops at 50 and the color wall bans `z-[60]`, so this couldn't be a utility class), applied to both `sheet.tsx` and `dialog.tsx`'s portalled content. Every dialog/sheet/popover surface now sits above the rail.
- **First noted:** 2026-08-14 (external design review of PR #23). **Resolved:** 2026-08-14 (M10 Wave 2, Phase 0, Task 0.2).

### KI-4 — Minor M5 Wave-3 cosmetic/dead-code notes — RESOLVED
- **Severity:** cosmetic / cleanup
- **Area:** `apps/web/src` (various)
- Non-blocking findings from the Wave-3 per-task + final whole-branch reviews
  (all shipped as-is by decision — no wrong behavior reachable by a user);
  all five closed in Task 19 (2026-08-09):
  - **FIXED:** `board/Column.tsx` — the `sectionRef` prop was dead (its only
    caller, the removed day-pager `scrollToDay`, was already gone); deleted
    the prop, its type, and the `ref={sectionRef}` wiring. `Board.tsx` never
    passed `sectionRef` to `<Column>`, so no call site changed.
  - **FIXED:** `lenses/MapLens.tsx` — removed the inert `grow` class from
    `.map-lens-canvas`; the `minHeight`/`height: 70vh` inline styles do the
    actual sizing, unchanged.
  - **CLOSED BY OBSOLESCENCE:** `lenses/TimelineLens.tsx` — the hour-gridline
    `<div>`s lacking `pointer-events-none`. Task 10's structural rewrite
    (horizontal Gantt-bar-with-hour-axis → vertical day-header + activity-row
    list) removed the hour-gridline code entirely; there is nothing left in
    the file for this bullet to apply to.
  - **CLOSED BY OBSOLESCENCE:** `lenses/TimelineLens.tsx` — axis tick labels
    clipping at narrow widths. Same Task 10 rewrite; there is no axis-tick-
    label code left in the file.
  - **FIXED:** `ui/segmented-control.tsx` — verified the claim first (the
    base `gap-0.5` class *was* redundant: `cn`'s `twMerge` silently dropped
    it in favor of the subtle variant's `gap-3` on every render). Moved
    `gap-0.5` into the pill-only branch so no dead class is emitted for
    either variant; the merged output is identical to before.
- **First noted:** 2026-07-13 (M5 Wave 3). **Resolved:** 2026-08-09 (Task 19).

## Dormant by decision

Features that still exist in the domain but have no UI reaching them. Not bugs
and not debt to pay down — deliberate holds, with a tripwire so the decision
resurfaces when keeping them actually costs something.

### D-1 — Anchors: domain kept, UI retired
- **Decided:** 2026-07-28 (Mitchell), during the Phase 1 gate review. **Executed in M8.**
- **What stays:** the `Anchor` contract, the anchor-violation conflict rules in
  `packages/domain/src/trip/conflicts.ts`, and their tests
  (`anchor-conflicts.test.ts`, `anchors-state.test.ts`,
  `apps/web/src/server/anchors.int.test.ts`).
- **What goes:** `apps/web/src/components/board/AnchorEditor.tsx` and every UI
  entry point to it.
- **Why:** anchors were never made legible. M3's gate proved the *rules* fire,
  never that anyone could see or use them. `publicHoliday` was worse than
  invisible — a selectable option with a country picker whose oracle is a
  permissive stub (`isPublicHoliday: () => true`), so it could never produce a
  conflict. A control that cannot do anything is a lie in the UI.
- **The tripwire — this is the point.** The anchor domain tests stay in the
  suite, so a future change that breaks anchors **fails the build**. Whoever
  hits it should read this entry and *decide* — revive with a real UI, or
  delete the feature — rather than reflexively repairing code no user can
  reach. A comment alone would never have surfaced; a failing test will.
- **Related dead weight, cleared:** `ConflictContext.timezone`, injected from
  `TRIP_TIMEZONE` and read by no rule, was removed in M8 Wave B (Task B2), in
  the same pass as the anchors-UI retirement. See the Amendment (2026-08-07)
  in `docs/architecture/ADR-006-conflict-evaluation-context.md`.

## Deferred design work (tracked elsewhere, pointer only)

Not bugs — design decisions awaiting a brainstorm, so they live with the
feedback that raised them, not here:

- **M5 PR #11 Group-4 comments** (Map-lens rework, Schedule nested toggle,
  Timeline time-of-day axis, header cost-vs-budget clarity, full-width
  perception): `docs/design-feedback/2026-07-13-pr11-wave2-vercel-comments.md`.
