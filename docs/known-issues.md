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
- **Same bug class, different trigger:** **KI-36** is the failed-send half of
  this — `failHead` in the same `optimistic.ts` drops the whole pending queue
  on a failed send, not just on abrupt navigation.
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

### KI-23 — The simulated model's `combined` surface never composes a page
- **Severity:** cleanup (product fidelity, not correctness)
- **Area:** `apps/web/src/server/ai/simulatedModel.ts`
- `doGenerate` maps `surface === "page"` to `pageCalls()` and everything else
  (`"board"` and `"combined"`) to `planCalls()`. A real, live `combined`
  request composes both a page and board activities (`handleAiRequest.ts`
  exposes both tool sets for that surface). So with the `ai-live` flag off, a
  `combined`-surface ask only ever produces board changes — the simulation
  under-represents what live `combined` mode can actually do. Not a
  correctness bug (the response is still marked `simulated: true` and the
  board changes it does make are real), just a demo-fidelity gap. Fixing it
  means having `combined` emit both `planCalls()` and `pageCalls()` and
  updating `simulatedModel.test.ts`'s expectations accordingly.

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

### KI-28 — `m8-make-it-real.spec.ts`'s trip-actions menu can render its "Delete" item outside the viewport
- **Severity:** reliability (no product impact observed yet; e2e flake, seen once, passed on retry)
- **Area:** `apps/web/src/app/page.tsx` (the trip list's per-card `Popover` menu, `align="end"`), `apps/web/src/components/ui/popover.tsx` (the shared Radix wrapper — added 2026-08-24, see signature 2 below), `apps/web/e2e/m8-make-it-real.spec.ts`
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
- **Why still open, and why no fix was attempted:** the symptom is real (it cost a CI retry) but remains unexplained — closing it on a green non-reproduction would be the KI-1 mistake ("probably a flake") in reverse. Nothing here justifies touching `Popover`'s collision/positioning config: signature 1 is arguably correct anchored-menu behavior and changing it is a design decision (does a menu follow its card, or close?), and signature 2 would need a real diagnosis before a `hideWhenDetached`-style change is anything but a guess.
- **Mitigation meanwhile:** `retries: process.env.CI ? 1 : 0` (Phase 1) already labels this a flake rather than a silent failure, which is how it surfaced. If it recurs, capture the trace (`trace: "on-first-retry"` is already on, and CI now uploads traces on failure) and check it against the two signatures above **before** attempting a fix.
- **First noted:** 2026-08-23 (test-suite-overhaul Phase 3/4 final verification). **Re-scoped, not resolved:** 2026-08-24 (KI-backlog session) — hypothesis measured and ruled out, no code change.


### KI-32 — The container image's Playwright browsers are a different build from the pinned @playwright/test
- **Severity:** reliability (local e2e cannot run without a manual workaround; CI unaffected)
- **Area:** the remote container image's `/opt/pw-browsers`, `apps/web/package.json`'s `@playwright/test`
- **Symptom:** `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` ships Chromium build **1194**. `@playwright/test@^1.61.1` resolves to a version that wants build **1228**, so `pnpm --filter web test:e2e` fails immediately at `auth.setup.ts` with "Executable doesn't exist at /opt/pw-browsers/chromium_headless_shell-1228/...". The image's own guidance is not to run `playwright install`.
- **Scope:** local/container only. **CI is not affected** — `.github/workflows/ci.yml:88` runs `playwright install chromium` against its own cache, so CI gets the matching build and remains the authoritative e2e signal.
- **Workaround used (M10 Wave 2 Phase 6):** symlinked the missing `chromium-1228` / `chromium_headless_shell-1228` directories at the 1194 build. Chromium 141.0.7390.37 then drove the full 22-test suite green against a production build. The symlinks live in `/opt`, not the repo, and do not survive a new container. The sanctioned alternative is a Playwright `executablePath` pointing at `/opt/pw-browsers/chromium`.
- **Caveat this leaves on any local e2e result:** the suite ran on a Chromium build the pinned Playwright does not target. Nothing observed suggested a behavioral difference, but a green local run is corroboration, not a substitute for CI's.
- **Why not fixed here:** it is an image-level mismatch, not a repo one — nothing in `travel-collab` produced it and no repo change fixes it. Pinning `@playwright/test` down to the 1194-era version to match the image would be the tail wagging the dog.
- **First noted:** 2026-08-24 (M10 Wave 2 Phase 6).


### KI-34 — `TripSummary` has no start date, so "next trip" and trip-card dates are approximations
- **Severity:** correctness (the "next trip" selection — see below — can genuinely surface the wrong trip, not just an approximate date) / cosmetic (the `createdAt` display fallback). Split rather than a single label, per CodeRabbit's review of PR #35: the two consequences below are not the same class of problem.
- **Area:** `packages/contracts/src/trip.ts`, `apps/web/src/app/page.tsx`, `apps/web/src/components/home/NextTripHero.tsx`, `apps/web/src/components/home/TripCard.tsx`
- **Symptom:** `TripSummary` (what `/api/trips` returns for the whole list) carries no start/end date field at all — only `createdAt`, an instant recording when the trip record was made, not when it happens. Two consequences, deliberately not the same severity:
  - **Correctness:** `page.tsx`'s `nextTrip` is `visibleTrips[0]`, the first trip in the list order the API returns, not the true next-upcoming-by-date trip — there is no date to sort by. If `/api/trips`'s order is ever not chronological (nothing in the contract guarantees it is), the hero can present a genuinely wrong trip as "next", not merely an approximate date on the right one.
  - **Cosmetic:** `TripCard` shows `Created {date}` (derived from `createdAt`) in the slot the design's trip card uses for the trip's actual dates; `NextTripHero`'s meta row does the same when its own `TripDetail` fetch (which does carry a real `startDate`) hasn't resolved yet or the trip has none set. The trip shown is still the right one here — only its displayed date is an approximation.
- **Why it's not fixed here:** the real fix is a contract change — adding a start date (or a denormalized "sort key" date) to `TripSummary` — which this plan (`docs/plans/M10-delta/phase-8-polish.md`, Task 8.5) explicitly rules out of scope: it is presentational-only, no `packages/contracts` growth. Fabricating a placeholder date on the card instead of the honest `createdAt` label would be worse than the current approximation, not better, so neither `nextTrip`'s selection nor `TripCard`'s date line changed for this task.
- **Fix path:** add a start date to `TripSummary`, then swap `nextTrip` to a real date-sort and `TripCard`'s date line to that field, the same way `NextTripHero` already prefers its real `TripDetail.startDate` over `createdAt` once that fetch resolves.
- **First noted:** 2026-08-24 (M10 Wave 2 Phase 8, Task 8.5).

### KI-35 — No true "area" field; route and place lines are a city-or-first-segment approximation
- **Severity:** cosmetic
- **Area:** `apps/web/src/lib/place.ts`, `apps/web/src/components/lenses/TimelineLens.tsx`, `packages/contracts/src/activity.ts` (`Location`)
- **Symptom:** `shortPlace()` (this task, `lib/place.ts`) and `cityFor()` (`DayChips.tsx`, earlier work) both face the same gap: `Location` has no dedicated "area"/"neighborhood" field, only the geocoder's structured `city` and the full `name` label. Both helpers fall back to `location.city` when present, else the first comma-delimited segment of `name` — a real but imprecise stand-in that can occasionally read oddly, since that first segment is the *venue name* for a location with no `city`, not an area (e.g. "Ugly Duck Coffee" rather than "Rochester"). The timeline's day-header route line and each activity's place line both inherit this via `shortPlace()`.
- **Why it's not fixed here:** the real fix is a contract change — a dedicated `area` field on `Location` — which this plan (`docs/plans/M10-delta/phase-8-polish.md`, Task 8.7) explicitly rules out of scope: it is presentational-only, no `packages/contracts` growth.
- **Fix path:** add a real `area` field to `Location`, populated by the geocoder alongside `city`, and prefer it in both `shortPlace()` and `cityFor()` ahead of their current fallbacks.
- **First noted:** 2026-08-24 (M10 Wave 2 Phase 8, Task 8.7).

### KI-36 — A failed send silently discards the entire pending queue, not just the command that failed
- **Severity:** correctness (silent loss of the *rest of the queue*, not of
  the alert itself) — the **same bug class as KI-5**: an in-memory optimistic
  queue that can lose confirmed-to-the-user work without telling the user the
  true scope of what was lost. KI-5 is triggered by the user navigating away
  mid-send; this is triggered by the send itself failing.
- **Area:** `apps/web/src/components/trip/context/optimistic.ts:81-83`
  (`failHead`)
- **Symptom:** `failHead` responds to a failed send with
  `{ ...state, pending: [] }` — every unit still queued behind the one that
  just failed is dropped, not just the failed one. A failed send **does**
  raise a visible alert: `TripProvider.tsx:137` calls
  `setError(result.error.message)`, and `TripBoardScreen.tsx:249-251` renders
  it as `<p role="alert">{error}</p>` until the next successful send. But
  that alert reports only the server's rejection of the one failed command —
  it never says that the queued edits behind it were also dropped, nor how
  many. There is no retry path, no on-device persistence of the discarded
  units, no failure timestamp, and no retained count exposed anywhere. The UI
  has already shown the user's edits as applied (client-side prediction); on
  a failed send those edits vanish from the queue with the alert giving no
  indication that anything beyond the reported error occurred.
- **Blocks:** Task 8b.4 (M10 Wave 2 Phase 8b) — the design's persistent
  sync-failure banner needs a real, live count of unsent changes and a real
  `(since <time>)` timestamp to render (`Your last three changes are saved on
  this device but haven't reached the trip yet`, plus a **Retry now** action).
  None of that state exists: the count is always what was about to be
  discarded, not what's retained, there is no failure timestamp, and there is
  nothing to retry against. Every clause of the design's copy would be false,
  so the banner has no honest trigger and was **deliberately not shipped**;
  the phase record is
  `docs/design-feedback/2026-08-23-design-sync-review.md` §6. The same root
  cause forced Task 8b.3 to ship only the saved/saving states of its
  three-state save indicator, dropping the error state.
- **Options (cheapest first):**
  1. **Retain the failed head and expose a retry.** Change `failHead` to keep
     `pending` (or at least its head) instead of clearing it, add a `failedAt`
     timestamp and a `retry()` that re-sends the retained head. Gets the
     banner and the save indicator's error state to an honest minimum: a real
     count, a real timestamp, a real retry action. Does not survive a reload
     or tab close — an in-memory queue is still lost the moment the tab goes
     away.
  2. **Persist the queue across reloads** (e.g. `localStorage` or IndexedDB,
     keyed by trip), replayed on mount. Closes the reload/tab-close gap KI-5
     also describes, not just the failed-send gap; substantially more surface
     (serialization, staleness against a since-changed server state, cross-tab
     conflicts) for one fix.
- **First noted:** 2026-08-24 (M10 Wave 2 Phase 8b, Task 8b.4 — found while
  implementing the phase plan's sync-failure banner; the plan itself directs
  stopping and reporting rather than fabricating a trigger).


### KI-40 — Every `activitiesPerDay >= 2` fixture shares one time window, so `overlappingDay` is indistinguishable from its siblings
- **Severity:** cleanup (no live failure today — the projection factory never runs the conflict engine, so the clash is currently unobservable)
- **Area:** `packages/factories/src/trip.ts` (`activityFactory`'s literal `timeWindow`, and `tripDetailFactory`'s hardcoded `conflicts: []`), `packages/factories/src/scenarios.ts`
- **Symptom:** `activityFactory` (`trip.ts:47`) gives **every** activity the identical literal window `{ start: "09:00", end: "11:00" }`. Identical windows satisfy the domain's `windowsOverlap` (`a.start < b.end && b.start < a.end`), so every scenario with `activitiesPerDay >= 2` — `threeDayTrip`, `overBudgetTrip`, `ungeocodedTrip` **and** `overlappingDay` — is carrying a mutual time clash on every day. `scenarios.overlappingDay` is therefore not distinguished from its siblings on the projection side at all: the thing its name promises is a property all four share.
- **Why nothing fails today:** `tripDetailFactory` hardcodes `conflicts: []` (`trip.ts:151`) and never calls `detectConflicts`, so the clash is never computed and never observed. The moment a caller hydrates one of these fixtures and runs the real engine — which is a reasonable thing to do — `threeDayTrip` starts reporting a degenerate `time-overlap` conflict it was never meant to have, and any assertion of the form "the ordinary case has no conflicts" breaks.
- **Distinct from the command side, which is fixed.** `commandsFor("overlappingDay")` emitted `09:00-10:00` and `10:00-11:00` — touching, not overlapping — and now emits a real partial overlap (`09:00-10:00` / `09:30-10:30`), verified through `decideTripCommand` → `evolveTrip` → `detectConflicts` in `packages/factories/src/conflicts.test.ts`. This entry is the *projection*-side twin of that problem, and the two are now asymmetric: the command twin overlaps deliberately, the projection twin overlaps accidentally and everywhere.
- **Why not fixed here:** staggering `activityFactory`'s default window is a one-line change with a blast radius nobody has measured — `@tc/factories` is consumed by ~34 `apps/web` test files (`TimelineLens`, `overlapData`, `calendarData`, `ScheduleLens`, `CalendarLens` and others) whose layout and grouping assertions may depend on every activity sharing a window. Verifying that is a scoped change of its own, not a rider on a KI sweep.
- **Fix path:** stagger `activityFactory`'s `timeWindow` by index the way `commandsFor` now does, run the full `apps/web` unit suite, and repair whatever depended on the shared window. Then decide separately whether `tripDetailFactory` should compute `conflicts` via the real engine instead of hardcoding `[]` — that is a design question about what the factory is for (an inert skeleton vs. a self-consistent projection), and it is Mitchell's, not a mechanical fix.
- **Cross-reference:** KI-37 (the command-side window bug, resolved 2026-08-25) — same family, opposite twin.
- **First noted:** 2026-08-25 (KI sweep, found while making `commandsFor("overlappingDay")` actually overlap).

### KI-41 — `commandsFor` is a scenario generator with no override surface, so it must invent data it has no business inventing
- **Severity:** cleanup (no user impact — `@tc/factories` is test-fixture-only and never reaches the app bundle; this is the root cause behind KI-37 and two follow-on patches)
- **Area:** `packages/factories/src/commands.ts` (`commandsFor`, `CommandsForOptions`)
- **Symptom:** `commandsFor`'s entire override surface is `{ dayCount?: number }`, and its own comment concedes that is "only meaningful for `mappedTrip`". Everything else is a hardcoded switch on the scenario name: `dayCounts`, `activitiesPerDay`, `located`, `costed`, `unscheduledCount`, a three-element `realLocations` array cycled by index, a cost of `2500 + i * 1100`, and a time window synthesized from the loop index. It is not a factory — a factory returns a default-shaped model the caller overrides per test. Its own sibling in the same package, `tripDetailFactory`/`activityFactory` (`trip.ts`), *is* a Fishery factory with full `Partial<T>` overrides and seeded faker; `scenarios.threeDayTrip(overrides)` takes `Partial<TripDetail>` while its command-side twin takes essentially nothing. Same conceptual fixture, two different contracts.
- **Why this matters — it is the root cause behind three separate patches:** because no caller can say what a window should be, the generator has to invent one from `i`, and every downstream problem follows from that single fact:
  1. Inventing it as `` `0${9 + i}:00` `` produced `"010:00"` — **KI-37** (resolved 2026-08-25).
  2. An invented value can run past midnight, so KI-37's fix added a `Math.min(..., 22:00)` clamp — which silently emits duplicate `22:00-23:00` windows from the 14th activity on a day rather than failing loudly, the very shape of defect KI-38 was about. Unreachable today (`activitiesPerDay` maxes at 2 and is not caller-settable), and now guarded by `conflicts.test.ts`'s zero-overlap assertions, but it is defensive code for a situation the caller cannot even create.
  3. `overlappingDay` needed a *different* invention rule, so a scenario-name special case (`staggerMinutes`) was bolted into the helper — the factory manufacturing an overlap by matching on a string, instead of a test simply passing two overlapping windows.
- **Deliberate decision (Mitchell, 2026-08-25):** the clamp in (2) is **left as-is rather than converted to a throw**, on the explicit premise that this entry's refactor deletes it. If this entry is closed as won't-fix instead, revisit the clamp — that premise is the only reason it was left.
- **Fix path:** give `commandsFor` the override surface its projection twin already has — named scenarios keep supplying defaults, callers override what their test actually cares about — then delete `timeWindowFor`, the clamp and the `staggerMinutes` special case outright. What justifies `commandsFor` existing at all is unaffected and should be preserved: per its header and ADR-020, integration/e2e/seed paths need an ordered `TripCommand[]` replayed through the real write path, because directly inserting projection rows would silently diverge from replay. That argues for a command-emitting fixture; it does not argue for one without overrides.
- **Blast radius (small — measured 2026-08-25):** only four real consumers. `apps/web/e2e/responsive.spec.ts` (three call sites, `threeDayTrip`) and `apps/web/src/app/api/dev/reset-demo-data/route.int.test.ts` (`unscheduledHeavy`). `apps/web/e2e/helpers.ts` uses `mappedTrip`, which early-returns before any of this code. `scripts/db-seed.ts` imports the package but does not call `commandsFor`.
- **Cross-reference:** KI-37 (the symptom, resolved), KI-40 (the projection-side twin's shared-window problem — same package, different half).
- **First noted:** 2026-08-25 (KI sweep — Mitchell, reviewing why a factory was synthesizing time windows from a loop index at all).

### KI-39 — The Japan seed's geocoder accepts any candidate inside the right city, not the right venue
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
- **First noted:** 2026-08-25 (M10 Wave 2 Phase 8b, PR #46's final CodeRabbit
  review round).

## Resolved

Closed issues, kept for the reasoning rather than the status. Nothing here
needs action — skip this section when triaging.

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
- **If this recurs:** re-run `scripts/repro-ki13.sh` before assuming anything, and check `ps aux` sorted by CPU for an external consumer per this entry's own long-standing mitigation — the historical causes (cold install, an external CPU hog) are both still live possibilities this closure does not rule out.
- **First noted:** 2026-07-26. **Resolved:** 2026-08-23 (test-suite-overhaul Phase 4).

### KI-19 — The e2e suite runs at exactly one viewport, so responsive bugs are invisible to it — RESOLVED, a narrow-viewport project is now a gate condition
- **Severity:** reliability (the gate couldn't see a class of real defect)
- **Area:** `apps/web/playwright.config.ts`, `apps/web/e2e/responsive.spec.ts`
- **Symptom:** M10 Wave 1's gate passed 11/11 specs against a production build while the trip page was completely inert below 1180px (KI-16). The config set `use: { baseURL }` and **no `viewport`**, so every spec ran at Playwright's 1280x720 default — above the 1179px breakpoint at which the blocking scrim turns on.
- **Fix (2026-08-23, test-suite-overhaul Phase 3, Task 3.4):** `playwright.config.ts` now declares a `"narrow"` project (1100x800, `devices["Desktop Chrome"]`) that runs only `e2e/responsive.spec.ts`, alongside the existing `"desktop"` project (1280x900, explicit rather than Playwright's un-set default — closes the blind spot the symptom above describes even for the un-narrowed suite). `responsive.spec.ts` covers five breakpoint-dependent behaviors in one spec rather than running all 15 specs at both widths: the assistant rail's overlay mode and its scrim actually dismissing it (the KI-16 regression guard), the trip page staying interactive (a view-tab click still changes the lens), a sheet's Close button staying reachable at a narrow width (KI-17's other half), the Playbooks strip's 1180px 4-col-to-2-col reflow (asserted via `getComputedStyle().gridTemplateColumns`, not a class name), and the home hero's 1024px collapse to one column (asserted the same way, at an explicit 1000px `page.setViewportSize` within the same spec — below the "narrow" project's own 1100px, which is above that particular breakpoint). All 5 verified green, part of the full 21-test suite run (`test:e2e:ci-like`).
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
