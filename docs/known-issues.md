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

### KI-2 — Money formatting differs between UI and domain conflict text
- **Severity:** cosmetic
- **Area:** `apps/web/src/components/lenses/formatMoney.ts` vs. the domain's
  `fmt` in `packages/domain/src/trip/conflicts.ts`
- **Symptom:** the UI groups thousands (`1,111,106.00 USD`, added in M5 Wave-3
  for comment #22), but the **over-budget conflict banner text is generated in
  `packages/domain`** and stays ungrouped, so the same amount can render two
  ways. Accepted knowingly: `packages/domain` was off-limits to that UI-only
  wave. **Fix path:** when a domain change is next in scope, group `fmt` to
  match (or move money formatting to a shared contracts-level helper).
- **First noted:** 2026-07-13 (M5 Wave-3).

### KI-3 — Minor M5 re-skin cosmetic/cleanup notes
- **Severity:** cosmetic / cleanup
- **Area:** `apps/web/src` (various)
- Collected small findings from the Wave-1/Wave-2 reviews, none blocking:
  - Trip "currency" field label renders lowercase — pre-existing copy, not a
    re-skin change; reads as a raw word, not "you're setting the trip budget".
  - Sign-in link (Track A) is a real `<a>` styled as a secondary button but
    missing the focus-ring / `cursor-pointer` a real `Button` has.
  - `text-danger-ink` used as a raw utility in a couple of places instead of a
    `Text` variant.
  - `Board.tsx` carries an unspecified `items-start` on its flex layout.
  - Near-duplicate link-button `className` strings across 3 lens files (DRY).
- **First noted:** 2026-07-11/12 (M5 Wave 1/2).

### KI-4 — Minor M5 Wave-3 cosmetic/dead-code notes
- **Severity:** cosmetic / cleanup
- **Area:** `apps/web/src` (various)
- Non-blocking findings from the Wave-3 per-task + final whole-branch reviews
  (all shipped as-is by decision — no wrong behavior reachable by a user):
  - `board/Column.tsx` — the `sectionRef` prop is now dead (its only caller,
    the removed day-pager `scrollToDay`, is gone); safe to delete the prop,
    its type, and the `ref={sectionRef}` wiring in a cleanup pass.
  - `lenses/MapLens.tsx` — the `grow` class on `.map-lens-canvas` is inert (no
    flex/bounded-height ancestor); the `minHeight`/`height: 70vh` inline styles
    do the sizing. Harmless dead class.
  - `lenses/TimelineLens.tsx` — the hour-gridline `<div>`s lack
    `pointer-events-none`; non-blocking today (buttons paint on top), but worth
    adding before any click-to-create-at-time affordance lands on the bar.
  - `lenses/TimelineLens.tsx` — axis tick labels are left-aligned at their
    `left:%`, so the last label ("9p") can clip against the row's right edge at
    narrow widths (centering needs an inline `translateX(-50%)`, which is
    allowed under the geometry inline-style exception).
  - `ui/segmented-control.tsx` — a redundant `gap-0.5` base class is overridden
    in the subtle variant (cosmetic).
- **First noted:** 2026-07-13 (M5 Wave 3).

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
- **First noted:** 2026-07-20 (M6, post-merge CI investigation).

### KI-6 — `listPages` lazy-instantiation race on concurrent first visits
- **Severity:** correctness (non-atomicity), low likelihood
- **Area:** `apps/web/src/server/pages.ts` (`listPages`'s zero-rows guard
  that seeds a trip's default pages on first Notebook visit)
- **Symptom:** `listPages` seeds default pages (Trip Overview, Day Sheet)
  the first time it sees zero rows for a trip. Two concurrent first-visit
  requests (e.g. two tabs opened at once, or a double-fetch) can each
  observe zero rows before either has inserted, and both seed — producing
  duplicate default pages for the same trip.
- **Scope:** known and accepted at the point of writing `pages.ts` (Task
  3.2); the brief that specified `listPages` explicitly scoped a fix out
  ("a later task could add a unique partial index; out of scope now").
- **Fix path:** a unique partial index on `pages (tripId, title)` (or
  similar) scoped to system-seeded rows, or a transactional
  check-then-insert, would close the race.
- **First noted:** 2026-07-21 (M7 Task 3.2 / gate-close).

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

### KI-13 — `pnpm check` is not reliably green: jsdom component tests time out under parallel load
- **Severity:** reliability (false failures; no product impact)
- **Area:** `apps/web` unit suite — `TripBoardScreen`, `PageScreen`, `MoneyInput`, `LocationInput`, `TripProvider` tests; `pnpm check` = `typecheck && lint && test` recursively
- **Symptom:** `pnpm check` fails with a **different set** of component tests each run (observed 2026-07-26 on a clean tree at `e9fe19b`: 9 failures, then 2 on the very next run), while every named file passes in isolation. `MoneyInput.test.tsx` took **11,675 ms** inside the full run versus **191 ms** alone. Failures surface as real-looking assertion messages ("expected spy to not be called"), not obvious timeouts, which is what makes them convincing.
- **Why it happens:** these are `user-event`/`waitFor` tests whose implicit timeouts are wall-clock. `pnpm -r` runs packages in parallel and `check` stacks typecheck and lint alongside, so on a loaded machine the jsdom environment starves and waits expire. Distinct from the `packages/domain` `diffTripStates` property failure seen in the same session — that one turned out to be a real bug, not flake (KI-1, since fixed), which is exactly why a genuinely flaky suite is dangerous: it made a true failure look like noise for two weeks.
- **Why it isn't fixed:** the real repairs are unattractive — pinning `fileParallelism`/`maxWorkers` down slows the suite for everyone, and raising every `waitFor` timeout hides genuine regressions. Neither is worth doing before someone confirms which of the two is actually biting in CI (CI has so far been green, so this may be local-hardware-specific).
- **Mitigation:** **do not trust a single `pnpm check` exit code.** Re-run the specific failing files alone before believing a failure, and prefer running the gates separately: `pnpm typecheck`, `pnpm lint`, per-package `vitest run`, and integration via `cd apps/web && set -a && . ./.env.local && set +a && pnpm exec vitest run` (vitest does not auto-load `.env.local`).
- **Risk if ignored:** a red `pnpm check` that is *usually* noise trains everyone to wave it through — which is precisely how a real regression ships.
- **First noted:** 2026-07-26 (verifying the flattened repo after the worktree cleanup).
- **Reproduction attempt, 2026-07-28 — could not reproduce, and the stated cause looks wrong.** On a 10-core machine at commit `a068fc2`: `pnpm test` (recursive, the configuration that stacks packages in parallel) passed **3/3 in ~10s**; passed **2/2 in 12-13s** with all 10 cores deliberately saturated by spin loops; and passed in 12s with every `.vite` transform cache deleted. Per-file timings on an idle machine total **6.3s** for all 188 web unit tests, worst file `TripBoardScreen.test.tsx` at 1,255ms — not the 36,235ms recorded on 07-26.
- **Revised hypothesis:** both observations (2026-07-26, and again on 07-27 during the audit — 6 failures then 1, ~152s, `environment 701s`) happened **immediately after a fresh `CI=true pnpm install`**, not merely under parallel load. A cold post-install state — rebuilt esbuild binaries, empty transform caches, collection alone taking ~106s — plausibly starves the wall-clock `waitFor` budgets in a way steady-state load does not. Post-warm-up, `environment` drops from 701s to 41s.
- **Practical implication:** do not spend effort pinning `fileParallelism` or raising `waitFor` timeouts yet — the evidence no longer supports the diagnosis those would treat. **Do** re-run the suite once after any dependency install before believing a failure. Kept open rather than closed because two independent observations are real and unexplained; it needs one reproduction on a cold install to confirm or kill.

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

## Resolved

Closed issues, kept for the reasoning rather than the status. Nothing here
needs action — skip this section when triaging.

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

## Dormant by decision

Features that still exist in the domain but have no UI reaching them. Not bugs
and not debt to pay down — deliberate holds, with a tripwire so the decision
resurfaces when keeping them actually costs something.

### D-1 — Anchors: domain kept, UI retired
- **Decided:** 2026-07-28 (Mitchell), during the Phase 1 gate review. **Executed in M8.**
- **What stays:** the `Anchor` contract, the anchor-violation conflict rules in
  `packages/domain/src/trip/conflicts.ts`, and their tests
  (`anchor-conflicts.test.ts`, `anchors-state.test.ts`).
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
- **Related dead weight to clear in the same pass:** `ConflictContext.timezone`
  is injected from `TRIP_TIMEZONE`, documented in ADR-006, and read by no rule.

## Deferred design work (tracked elsewhere, pointer only)

Not bugs — design decisions awaiting a brainstorm, so they live with the
feedback that raised them, not here:

- **M5 PR #11 Group-4 comments** (Map-lens rework, Schedule nested toggle,
  Timeline time-of-day axis, header cost-vs-budget clarity, full-width
  perception): `docs/design-feedback/2026-07-13-pr11-wave2-vercel-comments.md`.
