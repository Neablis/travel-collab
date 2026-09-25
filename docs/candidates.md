# Candidate ideas (unscheduled)

Captured so they are not lost; **not committed to a milestone yet**. Moved out
of `TODO.md` on 2026-09-21: it was 39KB of this file's 107KB, and a session
asking "what is next" never needs it, while `TODO.md` is the file `CLAUDE.md`
points every session to for exactly that question.

`pnpm candidates` lists these as one line each — title, date, and whether an
entry is unplaced, placed into a milestone, or due for deletion at a gate.

**The lifecycle, which is a rule and not a convention.**
`docs/milestones/README.md` states that an entry absorbed into a milestone is
*"annotated in place and deleted at those gates"*. An entry that says a gate
deletes it is **deleted by `pnpm milestone close`** when that gate closes —
not by anybody remembering. That automation exists because the rule was being
skipped: M23's entry survived its own gate closing on 2026-09-19 and was still
here two days later.

- **An architecture map that is generated, drift-checked, and annotated at gate
  close (designed 2026-09-18 — `docs/specs/2026-09-18-architecture-map-and-drift-audit-design.md`).**
  Mitchell's ask: a skill that reviews the codebase and keeps an up-to-date
  diagram of the code and its models, audits it for drift, and updates it — so
  that reviewing a new feature means reading the diagram rather than re-reading
  the whole codebase, keeping structure consistent and duplication visible.
  **Repo automation in the sense of `AGENTS.md`'s "Repo automation" section, not
  a milestone** — which is why it is here rather than in the list above.
  Three things were settled in the conversation that designed it:
  - **Two layers.** A mechanical layer **generated from source and drift-checked
    in CI** (the `content:verify` / `seed:verify` / lint-wall precedent), and an
    annotation layer **written by a person or agent**. The split is the one
    `pnpm state` and `/roadmap` already use, and the reason is this repo's own
    history: `STATUS.md` records that a drifted first-read file is worse than
    none, and that **the stale section was the defect, length only the symptom**.
  - **The annotation layer is written at GATE CLOSE, not from scratch** —
    Mitchell's argument, and it is right: describing a part of the system is far
    cheaper at the end of the milestone that built it, with the context live,
    than reconstructed cold later. Its home is the **gate-close checklist** in
    `docs/milestones/README.md`, which has already grown once for exactly this
    reason (step 5, STATUS.md, was missing and cost two gates).
  - **Known issues bind to diagram nodes, and the binding is DERIVED.** KI
    entries already carry an `- **Area:**` line of real paths; map path → node
    from those rather than adding a field, so none of the ~68 open entries needs
    editing and there is nothing new to keep in sync. The payoff: an agent about
    to change an area can ask what is already known-broken there, which makes
    `CLAUDE.md` rule 2 structural rather than remembered.
  **One thing it will not do, stated so it is not expected**: a diagram does not
  enforce DRY, it makes duplication *visible*. `KI-20260905-o`'s 21 files
  hand-enumerating activity fields would render beautifully and still compile
  green. What enforces DRY here is executable — the lint wall, the contracts
  protocol, `soleWriter.test.ts`, `planVersions.noExtension.test.ts`.
  **Approved in principle 2026-09-18; the spec is for approval and mints
  nothing.** Proposed to run before M23.
  **Status (audited 2026-09-25): the drift-check half shipped** — `pnpm arch`
  runs dependency-cruiser inside `pnpm lint` (#204, `AGENTS.md`'s architecture
  wall). **What is left:** a committed map, or the `pnpm map --for <path>`
  query that `docs/reviews/2026-09-23-architecture-wall-first-run.md` proposes
  instead (`pnpm arch:graph` only prints Mermaid on demand); the gate-close
  annotation step, which `docs/milestones/README.md` records as not adopted and
  `scripts/milestone.mjs`'s checklist does not have; and the KI `Area:` → node
  binding.

- **Stripe test mode alongside live, without a redeploy to switch.** Asked for
  2026-09-16: *"i would like to be able to use test card without needing to take
  down prod with new ENV variables."* The want is real — today the only way to
  exercise a paid flow against a deployment is to swap `STRIPE_SECRET_KEY` and
  `STRIPE_WEBHOOK_SECRET` and redeploy, which means production is either live or
  testable and never both.

  **Not a config change, and the reason is a data problem rather than a wiring
  one.** There is no `livemode` column on `subscriptions` or `billing_events`
  (`schema.ts:679`), and `revenue.ts:270` sums every live subscription into MRR
  through `conferringNow()` — so a test-mode subscription would be counted as
  real revenue with nothing to filter it out by. `users.stripe_customer_id` is a
  single column (`schema.ts:104`), so a test `cus_` and a live `cus_` for one
  person collide. Minimum honest scope:

  - migration adding `livemode` to `subscriptions` **and** `billing_events`
  - `users.stripe_customer_id` keyed per mode
  - every read that assumes "a subscription means money" filtered on it —
    `revenue.ts`, the admin console's tier and underwater panels
  - the webhook verifying against both secrets, taking mode only from the
    **verified** event, never from the unverified payload (ADR-047 keeps this
    seam narrow on purpose)
  - the per-account switch strictly server-side and admin-gated: a flag that
    grants real entitlements for a test card is a free-premium switch if it is
    ever client-readable
  - integration coverage for the mode boundary itself

  **What covers the want in the meantime**, and why this stayed unscheduled:
  `entitlement_grants` already gives a specific account premium with no payment,
  through the admin console, and `revenue.ts:272-278` reads grants separately
  from paying subscriptions so a granted tester never pollutes MRR. That covers
  "let these accounts use the paid features". It does not cover exercising
  checkout, the webhook, or the decline → grace → lapse chain — and those are
  better walked in an environment that is entirely test mode (local with
  `stripe listen`) than in a live one with a mode switch inside it.

- **The header's "Add stop" on desktop — where should creating an UNSCHEDULED
  stop live?** Reported on the preview, 2026-09-15: *"This Add Stop button i
  believe was added for mobile, it shouldnt show in desktop"*. The premise is
  not what the code does, which is why this is a design question rather than a
  fix: it is not a phone control and it is not a duplicate. Each day column
  already has its own `+ Add` (`Column.tsx` → `openCreate({ dayId })`), and the
  header's bare `openCreate()` with no day is the ONLY way to make a stop that
  belongs to no day — it is the Backlog column's old button, folded into the
  header when that column became the Unscheduled drawer (`Board.tsx:396`). The
  drawer itself only moves existing stops onto days; it mints nothing. So
  hiding the header button on desktop removes a capability at that width rather
  than tidying a duplicate, and the real options are: give the Unscheduled
  drawer its own create affordance and then drop the header button, accept the
  header button as the home for it, or decide unscheduled stops are phone-only.
  Not guessed at in the M21 branch — RULES.md 2 ("no purposeless UI") and RULES.md
  4 ("challenge to simplify") point opposite ways here until someone picks.
  *(Filed 2026-09-15 from PR #177's preview feedback.)*
- **A capability `premium` does not grant would make M20's fourth-plan proof
  unconditional.** `studio` grants `trip.collaborators` without `ai.command`,
  which makes it incomparable with `plus` — but it is still a *subset of
  `premium`*, because the latest `premium` holds every capability. A fourth
  capability now exists (`api.tokens`, `packages/contracts/src/entitlement.ts`)
  and did not change that: `premium@v2` grants it (`planVersions.ts`). So the
  proof still becomes unconditional only the day a capability exists that no
  `premium` version grants. **Stale on the way, noticed 2026-09-25:**
  `planVersions.fourthPlan.test.ts` asserts `setOf("premium").size === 3`, which
  holds because `setOf` returns the first entry (`premium@v1`), and its comment
  that premium "holds the whole vocabulary" is no longer true of v1 — a
  one-line fix to fold into whatever touches that test next. *(Filed 2026-09-13
  with the M20 build; not a defect, a sharper version of a claim already
  true.)*

- **`open` ("What needs you") is built as a two-column table and the design is
  not a table (raised by Mitchell on the PR 170 preview, 2026-09-13).** *"it
  looks nothing like the designs"*, and he is right — the row SHAPE is wrong,
  not its styling.

  `openBlock` in `Trip Planner Redesign.dc.html:5612` emits
  `{ label, sub, right, tone, act }` per row:

  | design | what it holds | what is built |
  |---|---|---|
  | `label` | *"Overlap on Day 6"*, *"Day 3 has nothing on it"*, *"2 ideas are parked"* — a sentence | a bare tag: "Overlap" / "Empty day" / "Parked" |
  | `sub` | *"Sat 12 Apr · Kyoto"*, or the parked titles | nothing |
  | `right` | *"Fix in Plan"*, *"Plan it"*, *"Place them"* — an action | nothing |
  | `tone` | `warning` / `info` / `plain`, as a row tint and ink colour | nothing |
  | `act` | navigates to Plan | nothing |
  | empty | *"Nothing is waiting on you — every day has something on it and no two stops collide."* | "nothing is waiting on you" |

  **Two of those are architecture, not layout.** `RepeatRow` is `lead` +
  `cells`, so a sub-line and a right-hand action have nowhere to go; and `Seg`
  is a closed union of text and chip (ADR-037 decision 3 — no HTML crosses the
  seam), so `act` is a widget emitting an interactive control, which that
  decision exists to prevent. Either the row type grows a third slot and a tone,
  or `open` stops being a `repeat` and gets its own shape. That is an ADR-037
  conversation.

  The `tone` tint is the easy third: `--color-warning-tint` / `--color-info-tint`
  / `--color-moss` are all in the theme already.

  **Fixed separately and not part of this**: the lead column collapsing under a
  long value, which is what he saw as *"the Issue text is still going down side
  of page"*. That was `minmax(0, 1fr)` letting the label track starve, and it
  hit every repeat widget rather than this one.

- **The Overview notebook's identity moves from `context.kind` into the
  database (raised by Mitchell on the PR 170 preview, 2026-09-13).** His words:
  *"let's make sure the overview notebook is special cased in db in some way
  rather than having to use special logic to know it's a trip overview
  notebook"*.

  Today it is `PageContext.kind === "overview"` inside the `pages.context`
  jsonb (`buildContext` in `packages/pages/src/templates.ts`). The delete
  refusal used to read it in SQL; since M13 (#201) it reads it in
  `apps/web/src/server/pageCommands.ts` instead, so it is no longer even
  enforced at the database. Either way it is a string inside a document, so
  nothing in the schema says a trip has exactly one, and the uniqueness that
  matters (`pages_system_seed_unique`) is keyed off the seed rather than off
  this.

  A real column — `pages.kind`, or a nullable `pages.is_overview` with a partial
  unique index on `(trip_id)` — makes "one undeletable Overview per trip" a
  constraint rather than a convention, and turns the guard into a plain
  predicate. **It is a Drizzle migration**, which per ADR-004 means a
  `migrate-production` dispatch by hand after merge, so it wants its own PR
  rather than riding one that is green.

  Also needed with it: the contracts changelog entry retiring or narrowing
  `PageContext.kind`, and a decision on whether the field stays in `context` as
  a mirror (two sources of truth) or leaves (a breaking read for anything
  holding an old `PageContext`).

- **The seeded Overview is titled `Overview — <trip name>` (same thread).**
  *"use the trip name for its title like Overview - <trip name>, since there
  will be one for every trip"*. `instantiateDefaults(tripId)` is handed an id
  and not a name, so this needs the trip's name at seed time or a title derived
  at read time — and a decision about the trips that already have one called
  "Overview". His premise is a list that spans trips; the index at
  `/trips/:id/pages` shows one trip's, so it may be aimed at a surface that
  does not exist yet. Worth asking before building.

  Filed alongside: *"might want to bucket up the notebooks for overviews or not
  show them here"* — explicitly tentative, and not clear enough to build from.

- **`open` takes filters: which kind of open item, and over which days (raised
  by Mitchell on the PR 170 preview, 2026-09-13).** His words: *"This component
  that shows issues should have a optional param for filtering on the type,
  Overlap / Parked, etc and a date picker that defaults for all trip"*.

  `open.ts` currently says the opposite in a comment — *"It declares no
  filters… a 'what needs you, on day 3 only' is a question nobody asked"* —
  which is now false and is part of the work rather than a note to update
  afterwards.

  **The two halves are not the same size, and that is the whole reason this is
  here rather than in PR 170.**

  *The date picker is small.* `dates` is an existing `FilterDimension` with a
  schema, a control and a label already, and "defaults to all trip" is ADR-039
  decision 2 for free — an absent filter is the widest one. `open` declaring it
  is `filterParams(["dates"])` plus a predicate per row class, and every row
  already knows its day except a parked idea, which has none (so it either
  always shows or never does — a decision, not a lookup).

  *The type filter is not.* It cannot be the existing `kind` dimension: that is
  `ActivityKind` (booked, idea), and this is a different vocabulary — Overlap,
  Too far, Anchor, Over budget, Empty day, Parked. Nor can it be a seventh
  `FilterDimension`: dimensions narrow an entity's selection, `LEGAL_FILTERS`
  is keyed by entity, and `open` deliberately has none (it is a registered
  widget, not a primitive — see its own header). So it is an `extra` param, the
  slot `count`'s `of` and `attribute`'s `field` use — **and neither of those
  renders a control.** `attribute.field` says why in as many words: chosen once
  by the preset, with no control that could fill it in afterwards. Mitchell
  asked for a control, so this needs a new `WidgetInputType`, its option list,
  its rendering in both the desktop panel and the phone sheet, and its wording
  in the bind summary.

  **The open design question**, which is why this wants his answer before it is
  built: does the control offer the three row CLASSES (conflict / empty day /
  parked) or the six LABELS the left column actually shows? Six matches what is
  on screen, which argues for six; three matches how the resolver is built, and
  `Conflict.kind` is `z.string()` in the contract rather than an enum, so a
  six-value control is a closed vocabulary over an open one and a kind the
  domain adds later would be unreachable by the filter.

  Either way it is a contracts change with a changelog entry, and it belongs
  with the widget work rather than bolted onto a design-sync PR that is green.

- **The assistant asks to change the app's own state, and you approve it
  (raised by Mitchell on the PR 141 preview, 2026-09-04).** His words: *"The AI
  assistant needs a tool to toggle the trip overview page to editing, it would
  be really cool if the AI assistant had to access for sensitive access (Like
  turning on edit mode) and we had a approve/deny button in the assistant to
  take that action."* **The approve/deny half already exists** — a planning
  turn's write tools do not execute, they collect, and the turn ends with a
  resolved proposal that only commits when a human clicks Approve
  (`buildProposal` / `commitProposal` in `server/ai/writeTools.ts`, ADR-022 §4,
  ADR-033 decision 5). So this is not new machinery; it is the machinery the
  trip board's assistant already runs on.

  **What is genuinely new is the proposal's contents.** Today a proposal is a
  list of domain commands, and "turn on edit mode" is not one — it changes
  client state, not the trip. A UI-action proposal is a different class: it
  cannot be replayed from the event log, it has no `actor_id`, and it is not
  undoable. That is an ADR before it is a feature, and it is the reason this is
  parked rather than built. It is also where *"sensitive access"* wants
  defining: today the guard is role-based (`minimumRoleFor`), and a per-action
  approval tier is a different axis from a role. Generalises well past edit
  mode, which is the argument for doing it properly once. Vercel toolbar thread
  `ULm7F9Ys7Cyx`.

- **Pricing on the landing page (designed 2026-09-02, `SPEC.md` §17.1).** A
  section plus a `#pricing` nav anchor on M15's existing landing route — three
  plan cards, each enumerating its own contents in full. **Parked here by
  Mitchell, 2026-09-02**, having been ruled out of both commercial milestones:
  M20 forbids a price string in its own diff, and all seven of M21's links are
  authenticated. **The full requirement lives in
  `docs/milestones/M21-subscriptions-and-billing.md` under *An unowned
  surface*** and is not copied here, per this file's own rule. Two constraints
  on wherever it eventually lands: it may only **name a price at or after
  M21**, or it ships priceless; and it is a **section on a route that already
  exists**, so it is small wherever it goes. Revisit when M21 opens.
  **Unblocked (audited 2026-09-25):** M21's gate closed 2026-09-19 with prices
  set, so it can now name one. `PlansScreen` / `PlanComparison` on the
  signed-in `/plans` route (#177) are the obvious parts to reuse; the landing
  route (`LandingScreen.tsx`) still has no section and no `#pricing` anchor.

- **The phone has no conflict state (2026-09-01, DRIFT §8).** The remainder
  of the "shared day gets a map, Playbooks becomes a fifth phone tab" entry,
  audited 2026-09-25. Everything else in it shipped: the shared day's map
  (`SharedDayMap.tsx`, #196/#197), the five-tab `PhoneTabBar` (#143), and where
  the phone edits (M26 link 13's phone treatment of Plan). DRIFT §8's *"the
  phone has no conflict state"* — which project rule 6 requires — is recorded
  by `docs/milestones/M26-design-parity.md` as design-owed rather than built:
  it needs a design before it needs a build.

- **PLACED 2026-09-18 — this is M24, and its open question is answered.**
  *Scheduled as `docs/milestones/M24-travel-legs.md`. The question below —
  does a mode inherit from `kind` or carry its own field — is answered: it
  carries its own, legal only when `kind === "transit"` and enforced by the
  schema, so the two cannot disagree. The entry's own note that this is "worth
  deciding once for both" still holds for M19 link 1, which may answer
  differently for costs only with a stated reason. M24's gate deletes this
  entry at close.*

- **Transport mode per leg — the map legend's modes (2026-09-01, out of the
  milestone audit).** `map-legend-modes` in `preview-registry.ts` was tagged
  **M9** and is not M9's work: M9's scope has no transport-mode link, no
  contract change and no migration. It was **retagged `unplaced`** rather than
  moved to a milestone that merely sounds adjacent — the registry's own rule is
  that a tag is a claim the milestone will wire the shell up, and a false claim
  costs a future gate, which is how M11b's *"no M11-tagged entry remains"* box
  got stuck.
  What it would need: a field modelling how you get from one stop to the next.
  **`ActivityKind` already carries `transit`** (M18), so the stop knows it *is*
  travel — what nothing records is *by what*. `activity.ts` warns explicitly
  against a second field that could disagree with `kind`, so this is the same
  design question M19's link 1 has to answer about costs: inherit, or carry its
  own. Worth deciding once for both.
  Not scoped, not placed, and deliberately not attached to a milestone until
  someone wants it.

- **Save light: move Retry out of the mark and into a popover on it
  (2026-08-26, Mitchell, PR #55 — "nice to have, to do later").** SPEC's "The
  logo is the save light" justifies putting trip-scoped save state in an
  account-scope bar on the grounds that it is *status, not an action* — which
  is exactly the exemption `RULES.md` 1 needs. What shipped makes the mark
  itself a Retry **button** while a send has failed, because the design gives
  the failure a colour and no way out of it and this queue only retries when
  asked (KI-36); that keeps `RULES.md` 6's "recover from the worst" but spends
  the very justification SPEC used.
  The better shape, deferred rather than rejected: the mark stays status-only
  and **clicking it opens a small popover** carrying the failure detail and the
  Retry control. The top bar then holds status, the action sits one level in,
  and rule 1 is clean again. It also gives the failure message and
  `failure.at` timestamp somewhere to live — today nothing renders either, and
  `SaveLight.tsx` documents why it will not fake a relative "(since …)" without
  a ticking clock.
  Not free: a popover on the logo is a new interaction on the one element
  present on every route, so it needs its own dismiss/focus behaviour and a
  decision about whether it opens at rest (probably not — there is nothing to
  say when everything is saved).

- **Design-sync items with no milestone yet (2026-08-23).** From
  `docs/design-feedback/2026-08-23-design-sync-review.md`, which writes each one
  up in full. **Audited 2026-09-25; what shipped is gone from this entry:**
  `TripSummary.startDate` (#218, KI-034), start-only trip dates (M10 Task 8b.6),
  trip lifecycle (SPEC §27, M26 D13), the landing page (SPEC says it needs no
  states) and first run (rebuilt as the new-trip conversation, SPEC §30–32).
  What is left is design work, not build work:
  - **History beyond the popover** and **`MapRail`** — `SPEC.md` §8 still lists
    both as not designed.
  - **Auth-screen error/empty states** — not yet checked against the design.

- **M8 Wave C/D trim: quick-add, search-to-add button, move-via-menu,
  first-run state, empty states (Mitchell, 2026-08-07).** Deferred out of M8
  rather than done reflexively, once Wave A merged. None of these close a
  capability gap: an activity — including one with a real geocoded place —
  can already be added via the existing `+ Add activity` editor
  (`ActivityEditor.tsx`/`LocationInput.tsx`), and reordering already works by
  dragging. What's deferred is speed (a faster input, a dedicated search
  button, a menu instead of a drag) and presentation (first-run/empty-state
  copy and layout) — genuine ergonomics and polish, but not blockers against
  the Phase 1 gate, and exactly the surface a separate, already-underway
  design-tool brainstorm for the product's future look and feel is likely to
  reshape. Building it now risks the "redone twice" cost M5's own Wave 1
  re-skin already paid once when the layout moved underneath it — the same
  argument M10's own scope doc makes about not polishing a structure that is
  still moving, applied here to interaction/ergonomics work instead of visual
  polish. **Kept, not deferred:** the KI-5 visible-sync-state indicator
  (correctness/trust, not ergonomics — doesn't depend on quick-add existing)
  and the M8 e2e gate script, resized to exercise the existing
  add-activity/drag-and-drop flow. Full reasoning in
  `docs/milestones/M8-make-it-real.md`'s "Scope trim" section — the original
  step-by-step plan (`docs/plans/2026-07-28-M8-make-it-real.md`, including
  the deferred C1–C3/D1–D2 task write-ups) was deleted at M8's gate close
  per `docs/plans/README.md`'s staging-area rule. Revisit once M10's
  direction is set — these are exactly the kind of task that direction
  should inform, not the reverse.
  **Status (audited 2026-09-25):** D1 and D2 landed in a different shape —
  first run became the Home-level new-trip conversation (`FirstTripStart`,
  then SPEC §30–32), and Map, Notebook and Calendar have empty states. **What is
  left:** C1 quick-add (`AppHeader.tsx` still omits the prototype's), C2 a
  search-to-add button (place search lives only inside the editor), C3 a
  "Move to…" menu for a *scheduled* stop (the editor's Day select is disabled
  in edit mode; only the rack's dropdown moves anything, and only off the
  rack), and empty states for the day column, the rack and History.

- **Trip list row: show the trip's length (Mitchell, 2026-08-01, from M8
  dogfooding).** The rest of this entry shipped: the card shows a formatted
  start date (or "Created <date>") instead of the raw ISO `createdAt` (#218,
  KI-034), and a "{planned} planned of {budget}" cost line (`TripCard.tsx`).
  The trip's length in days is still not on the card.

- **Duplicate and the undo-toast's Restore: no optimistic update yet (Mitchell,
  2026-08-01, from M8 dogfooding).** Delete's optimism (page.tsx's
  `deletingIds` filter-set, M8/A15 follow-up) and the rename/date/budget
  optimism fix (TripHeader reading `activeTrip` instead of `trip`) both landed
  as small, well-scoped fixes. Duplicate (network round-trip before the
  redirect fires) and Undo (`page.tsx`'s `undoDelete` does a full `load()`
  refetch rather than re-inserting the row locally) are lower-value/more work
  for now — deferred rather than done reflexively.

- **Contained activities: a meal inside a day-long activity is not a conflict
  (Mitchell, 2026-08-02, from M8 dogfooding).** Every day of the Rochester run
  raised a `time-overlap` warn, all three the same shape: a long anchor
  activity (Niagara Falls 09:00–16:00, the Strong Museum 10:00–16:00) and a
  lunch sitting *inside* it. The AI was not wrong — you *do* eat lunch during
  a museum day — and the user's reading was "we might want a feature for when
  the lunch is at the event." So this is not a prompt fix: telling the model
  the conflict rules would only teach it to stop scheduling lunch, which is
  worse. **The domain models overlap but has no notion of containment.**
  Directions to weigh in a brainstorm, not yet decided: (a) real nested/child
  activities in `packages/domain`; (b) a span/kind distinction so a long
  activity is a *container* rather than a peer; (c) leave the model alone and
  refine the rule in `conflicts.ts` — suppress `time-overlap` when one window
  fully contains the other and the inner one is short; (d) do nothing and let
  dismissal absorb it (status quo — but three warns on a three-day trip is
  the AI teaching users to ignore the conflict UI, which is the real cost).
  Note (c) is the cheapest and (a) is the most honest; the choice depends on
  whether containment ever needs to mean anything beyond silencing a warn.
  Deliberately kept out of M9 — it is a `packages/domain` contract question
  with conflict-detector consequences and deserves its own design pass.

- **AI cost/quality tuning — "best model for my buck" (Mitchell, 2026-07-25).**
  **Thread (1), prompt trimming, was measured on 2026-07-27 and is NOT worth
  doing.** The per-round-trip payload is small: context envelope ~623 tokens for
  a 7-day/21-activity trip (board surface; 858 for `combined`), derived planning
  tool schemas ~816 tokens, system rules ~450 — about **1,900 tokens per model
  round-trip**. The live run that recorded ~33.5k input tokens was therefore
  ~18 round-trips, not a fat prompt: the cost was **step count**, which the
  2026-07-26 step-budget fix already addressed (system prompt now tells the
  model to emit every call in one message; typical runs should be 1–3 steps).
  Trimming `context.ts` would save tens of tokens per step and cost legibility.
  **Watch `meta.steps` instead — that is the cost driver, and it is already
  instrumented.**
  **Thread (2), the model harness, still stands and is the valuable half:**
  build a small harness that runs a fixed set of representative prompts (e.g.
  "plan a N-day trip", "move X to day 2", "add lunch on day 3") against several
  gateway models and records, per model, the `meta` we already emit
  (input/output tokens, steps, durationMs) alongside a quality score (did the
  batch apply? correct day placement? no dropped/duplicate commands?). Goal:
  pick the cheapest model that clears a quality bar. Weak models loop and
  over-generate; the harness makes that measurable instead of anecdotal.
  **Status (audited 2026-09-25):** the measuring side exists — `ai.ask` usage
  records and the `ai-usage` skill that reports them, and a replay harness over
  recorded transcripts (`server/ai/eval/replay.int.test.ts`, which closed
  KI-011). What does not exist is the comparison itself: nothing runs the same
  prompts against several models and scores them side by side.

- **Drag works in Calendar: from the rack onto a day, and a stop between days
  (2026-08-23, manual QA on PR #26's preview deploy).** What is left of the
  "unscheduled rack is Board-view-only" entry, audited 2026-09-25: the Timeline
  gap went with the Timeline (#170); the drawer now renders only where a stop
  can be dropped, gated by `board/lensAcceptsDrops.ts` (#55), which also settled
  where it shows; and its bottom clearance is reserved (`globals.css`, #98).
  Nothing under `apps/web/src/components/lenses/` registers
  `dropTargetForElements`, so two gaps remain, and closing either brings the
  drawer to Calendar:
  1. Drag from the rack onto a day in Calendar — no drop target exists.
  2. `CalendarLens.tsx`'s day cards and stop chips are built to the design's
     drag affordance (dc.html:670-672's 6-dot grip) but are not draggable;
     `cursor: grab` is withheld so the UI never promises a drag it can't
     perform. Wiring them needs a drop target in the calendar lens itself and
     reuses `MoveActivity`, the command Board's `ActivityCard` drag already
     dispatches.

- **A parked stop remembers which day it came from (2026-09-22).** Half of the
  `rack-provenance` preview M13 link 5 retired. That link modelled **who**
  parked a stop (`bookedBy`), and the rack now says so; it did not model
  **which day it was parked from**, because a backlog stop keeps no record of
  the day it was moved off — `MoveActivity` carries `toDayId` and nothing
  about where it left. Worth having: the rack's whole problem is that a stop
  out of its day loses the context that explains it. **Not costed and not
  placed** — it needs a decision about whether the origin is a field on the
  activity (which replay would have to maintain) or something read back off
  the event log, and that is a real design question rather than a line.

- **Design critique: phone and tablet layout, decided once (2026-09-25).**
  Mitchell, after the overnight KI sweep: *"I want to do a design critique
  soon too, so we can combine those layout issues."* Five open entries are
  one conversation, not five fixes — each was left by the sweep because it
  says it needs a layout decision, and deciding them separately would give
  three answers to "what does a phone show":
  - `KI-2026-09-24-i` — the pinned phone trip header takes ~305 of 844px, so
    Plan's first stop starts at the fold (what collapses, what pins; SPEC
    §13.4–13.5).
  - `KI-2026-09-25-f` — a trip opens on a phone into the desktop Overview
    document in a padded card, ~8,560px tall (what Overview IS on a phone, or
    whether a phone lands elsewhere — SPEC §24 says Overview, with no phone
    exception; the phone tab bar now marks nothing current there, per
    `resolved/KI-20260924-l-…`).
  - `KI-2026-09-24-j` — tablets (768–1100px) get the desktop layout with
    mouse-sized controls, and the Ask button covers stop costs (does a touch
    tablet keep SPEC §13.1's 44px floor; what the tablet board looks like).
  - `KI-048` items 3 and 5 — the day-chip row gives no sign it scrolls, and
    the trip-settings date editor opens as a popover over "Total for the trip"
    (inline is already the settled answer; it needs building and an e2e).
  - Worth walking in the same session, already fixed but new on screen:
    the Plan board's sticky stand-in scrollbar (`resolved/KI-20260922-b-…`,
    never looked at on a Windows mouse), the Calendar's hidden-days control
    (`resolved/KI-20260924-k-…`), and phone tag chips' 44px hit area
    (`resolved/KI-20260924-m-…`).
  **Output of the critique:** a decision per bullet recorded in the entries
  (or a SPEC amendment through a design sync — `.design-sync/**` is a build
  input), then one milestone or one PR per decision. **Not placed.**

- **The cloud container's e2e browser matches the one CI runs (2026-09-25,
  `KI-2026-09-25-i`).** `/opt/pw-browsers` files Chromium 141 under the
  revision `@playwright/test@1.62.1` asks for as Chrome Headless Shell 151.
  That gap hid a real KI-5 data-loss bug overnight: the spec passed locally
  every time and failed in CI every time, and only downloading CI's exact
  build from Chrome for Testing reproduced it. Small and mechanical:
  `link_playwright_shell` in `.claude/hooks/session-start.sh` compares the
  linked binary's version with `browsers.json`'s `browserVersion` and installs
  the matching build (Chrome for Testing is reachable through the proxy;
  `cdn.playwright.dev` is not), or warns loudly, and `pnpm state`'s LANES line
  reports the mismatch instead of "OK browser". **Repo automation, not a
  milestone. Not placed — do it before the next e2e-heavy change.**

- **`/ask` survives a throw while building its proposal (2026-09-25,
  `KI-2026-09-24-w`).** A throw inside `buildProposal` (called from
  `messageMetadata` on the stream's `finish` part in `handleAskRequest.ts`)
  errors the response body instead of reaching `onError`, so the client gets
  neither the failure message nor a proposal. No known trigger today — it needs
  a bug in `buildProposal` — and the entry has a reproduction already
  (`route.int.test.ts` with `buildProposal` mocked to throw). Small. It is AI
  code, so it belongs with M9's carried cluster; it is listed here only because
  the 2026-09-24 KI pass never gave it a `Milestone:` line and the overnight
  sweep missed it. **Either take it standalone or give the entry M9's
  Milestone line and a row in M9's Parked table.**
