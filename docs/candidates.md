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
- **`ADMIN_USER_IDS` must be set in production before `/admin` is reachable
  there.** The operator console is gated on `users.is_admin` and nothing in the
  product sets that column, so the allowlist read at sign-in
  (`apps/web/src/lib/adminBootstrap.ts`) is the only way a first operator
  exists. Unset promotes nobody, which is the safe default and also a console
  nobody can open. *(Filed 2026-09-13 with the M20 build.)*
- **A fourth capability would make M20's fourth-plan proof stronger.**
  `studio` grants `trip.collaborators` without `ai.command`, which makes it
  incomparable with `plus` — but it is still a *subset of `premium`*, because
  `premium` holds the whole three-word vocabulary. That is a fact about the
  vocabulary rather than the plans, and `planVersions.fourthPlan.test.ts` says
  so rather than hiding it. The day a capability exists that `premium` does not
  grant, the proof becomes unconditional. *(Filed 2026-09-13 with the M20
  build; not a defect, a sharper version of a claim already true.)*

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
  jsonb, and the delete refusal reads it in the `WHERE` clause with
  `coalesce(context->>'kind', '') <> 'overview'`. That works and is enforced at
  the database — but it is a string inside a document, so nothing in the schema
  says a trip has exactly one, and the uniqueness that matters
  (`pages_system_seed_unique`) is keyed off the seed rather than off this.

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

- **The shared day gets a map, and Playbooks becomes a fifth phone tab
  (designed 2026-09-01, `.design-sync/handoff/SPEC.md` §16, `DRIFT.md` §2d).**
  Both arrived in the 2026-09-02 handoff and **neither has an owner: M11b's
  gate closed 2026-08-31**, so the shared day is a shipped surface and this is
  an addition to it. Two pieces, and they are not the same size:
  - **The map on the shared day** is the smaller one and is buildable — it
    needs no field the library does not already have. Its three constraints are
    each a bug the design file hit: the map node **stays mounted** (a
    conditional container detaches it mid-style-load and the load aborts
    silently — DRIFT §6 build-check 5, and this is its second recurrence);
    pins draw immediately while lines wait for the style; and style-load
    recovery is **per instance**, rebuilding at 3.5s and 7.5s with a list-only
    fallback at 11s. Accents reaching a map paint property must leave `oklch`
    first (build-check 2) — MapLibre parses CSS Color 3 only and falls back to
    black in silence.
  - **The fifth phone tab is the larger one, and it lands on a gap that
    predates this handoff: no milestone in this file owns the phone at all.**
    `SPEC.md` §13's mobile foundations, §16's tab bar (Plan / Map / Notebook /
    Playbooks / Trips, superseding §13's four) and DRIFT §8's *"the phone has
    no conflict state"* — which project rule 6 requires — are all designed and
    all unowned. **Placing the phone is a milestone-sized decision**, not
    something to bolt onto whichever milestone touches a screen next.
  - **WHERE DOES THE PHONE EDIT? Open, and deliberately deferred — 2026-09-12.**
    SPEC §24 deletes the Timeline lens, and the Timeline lens *was* the phone's
    editing surface: `PhoneTabBar`'s Plan tab pointed at
    `?lens=Schedule&view=Timeline`, and `usePhoneTwoViews` existed only to send
    a bare `/trips/<id>` there, on §10's grounds — *"Day columns and Calendar
    exist to show density, which a phone cannot show honestly."* §10 and §22
    are carried forward unchanged in the same handoff, so the bundle now says
    both that Plan (day columns) is the only surface that edits and that a
    phone cannot render day columns honestly.
    **Built as the design states it, on Mitchell's call** (2026-09-12: *"Lets
    just build the plan as is for now, and when its ready we will figure out
    where editing moved to"*), so **a phone renders day columns at 390px
    today** and that is a known, accepted, temporary state rather than an
    answer. It is not papered over with a phone-only fallback view, and it
    should not be. Whoever picks this up owes either a phone treatment of Plan
    or a design decision that §10 no longer holds.

- **Drop Travelers from the trip header bar (2026-08-30, Mitchell, on PR #89's
  preview — "Drop Travelers from this bar, its not needed, it can live just in
  the trip settings").** It is a delete, not a move, and smaller than it sounds
  — checked before filing:
  - The control is the avatar stack plus "N travellers" in
    `components/trip/TripMetaPill.tsx:39-58`, beside days / stops / cities.
  - **Its `onClick` is already `onOpenSettings`** — it opens the same
    `SettingsSheet` the trip title does. So the routing Mitchell describes is
    not something to build; the control is a link there already.
  - **Settings already lists members.** `SettingsSheet.tsx:327` has a "Who is
    invited" section whose `TravelersPanel` shows the effective members and, for
    an owner, creates, copies and revokes invite links (M11 link 3). Nothing is
    lost by removing the header display.
  So the work is deleting the `<Button>` and its avatar stack from
  `TripMetaPill`, and its assertions from `TripMetaPill.test.tsx`. Watch the
  divider: each meta item is preceded by a `bg-hairline` spacer, so the one
  before it goes too or the pill ends on a stray rule.
  The one judgement left is what it costs on a **shared** trip: after M11 the
  avatar stack is the only at-a-glance sign that a trip has other people on it.
  On a solo trip it reads "1 travellers" and earns nothing, which is the case
  Mitchell was looking at. Removing it unconditionally is the literal ask;
  hiding it below two members is the smaller-blast-radius alternative.
  Deliberately not done in PR #89 — that PR closed M18's gate, and removing a
  control from a different surface would have made the gate evidence harder to
  read.

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

- **Timeline: scrolling should move the day chips, the way the map rail
  already does (2026-08-28, Mitchell, walking PR #71's preview — "Add this to
  the future tasks").** The timeline's focus binding is one-way today. A chip
  click scrolls the timeline (`TimelineLens`'s `scrollIntoView` effect on
  `focusedDay`), but nothing reads scroll position back out, so scrolling never
  moves the chips. `MapRail.tsx:186` is the only scroll listener in the app and
  there are no IntersectionObservers at all.
  It reads as a regression because **the behaviour already exists on another
  lens**: the map rail focuses whichever day its focus line is over, through
  the same `onFocus` callback a click uses, and `m10-map-rail.spec.ts`
  ("scrolling tracks focus through every day") pins it. Having it in one place
  and not the other is what makes its absence feel like breakage rather than
  an unbuilt feature.
  Build it by reusing the rail's approach rather than inventing a second one —
  measure the day headers, cache the offsets, refresh with a `ResizeObserver`,
  and pick whichever header is nearest a focus line on each scroll. The rail's
  own comment argues against an IntersectionObserver for two reasons that
  apply here unchanged: a header sitting at ratio 1.0 never re-reports while
  its real position keeps moving, and IO delivers nothing in a backgrounded
  tab — both leave focus on stale data.
  The one thing to get right is the feedback loop: focus-on-scroll must not
  re-trigger the `scrollIntoView` effect, or the view fights the user. The rail
  avoids it by calling `onFocus` only when the resolved day actually changes;
  the timeline additionally needs that effect to skip scrolling when the change
  came *from* scrolling.
  **Raised a second time on 2026-08-30**, on PR #89's preview — "As i scroll
  through the timeline, it should select the day you are passing, and show the
  selection at the top bar to". Same request as the 2026-08-28 one above, now
  with the top-bar half stated explicitly: the day chips should show the
  selection, not just the timeline. Two asks for the same thing in two days is
  the strongest signal on this list that it is worth scheduling.

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
  up in full. Decided items are struck through with where they went:
  - **`TripSummary.startDate`** — one field, so home's "next trip" is real
    rather than `visibleTrips[0]`. The data already exists on
    `TripDetail.startDate`; only the summaries read model lacks it. Per
    `AGENTS.md` a contract change is its own reviewed step, so it goes **before**
    M10 Phase 8's home-hero task, not inside it. **This subsumes the "Trip list
    row: richer, human-readable metadata" idea below** — that item wants exactly
    this field.
  - ~~**Start-only trip dates**~~ — **DECIDED 2026-08-23, landed 2026-08-24.**
    The end is always start + day count; there is no end-date input anywhere.
    Shipped as **Task 8b.6** of M10 Wave 2 — its plan file was deleted at the
    gate close per `docs/plans/README.md`; the durable record is
    `docs/milestones/M10-visual-craft.md`'s Wave-2 retro. Phase 7's wizard
    already matched (its length chips predate this task). It turned out to be UI-only: `endDate` is stored nowhere — not on
    `TripState`, not on `TripDetail` — and `TripHeader.tsx:228` already
    derives it from the plan's last day, so no contract, command or domain
    change was involved. **This also closed the "trip end-date picker may
    drift from the day count" item that used to sit below** (removed from
    Candidate ideas by this task): not stored-field drift, but a derived
    value presented in an editable field.
  - **Design coverage the build is still owed** — History beyond the popover,
    `MapRail`, trip lifecycle (delete → undo → restore, duplicate), and
    error/empty states for the new landing, auth and first-run screens. Design
    work, not build work. (The three undesigned extra lenses this used to name
    alongside them — Itinerary, Daily overview, Full trip — are gone: **KI-20**
    was closed by retiring them, not by designing a home for them.)

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

- **Trip list row: richer, human-readable metadata (Mitchell, 2026-08-01, from
  M8 dogfooding).** The "Your trips" list currently shows each row's
  `createdAt` as a raw ISO timestamp (`2026-08-01 23:52:35.026+00`) — should be
  human-readable, and more useful than the creation date anyway: start date,
  trip length (day count), and cost are all already on `TripSummary`/derivable
  from `TripDetail` and would tell the user more at a glance than when the row
  was created.

- **Duplicate and the undo-toast's Restore: no optimistic update yet (Mitchell,
  2026-08-01, from M8 dogfooding).** Delete's optimism (page.tsx's
  `deletingIds` filter-set, M8/A15 follow-up) and the rename/date/budget
  optimism fix (TripHeader reading `activeTrip` instead of `trip`) both landed
  as small, well-scoped fixes. Duplicate (network round-trip before the
  redirect fires) and Undo (`page.tsx`'s `undoDelete` does a full `load()`
  refetch rather than re-inserting the row locally) are lower-value/more work
  for now — deferred rather than done reflexively.

- **Expose geocoding as a model tool — now scoped into M9 as "Grounding"
  (`SearchPlaces` + `placeRef`).** Filed 2026-08-01 (Mitchell, M8 dogfooding)
  as the deferred half of the geocoding work: server-side auto-geocode was
  landing as the fix for the model guessing `Location.lat/lng` (observed:
  `lat: 0, lng: 0`), and giving the model a tool to *disambiguate candidates
  itself* was held back as more steps/tokens for cases "auto-geocode's 'take
  the top match' can't — e.g. two same-named places in different cities the
  model needs to pick between using trip context."
  **The 2026-08-02 dogfood run hit that exact case and the deferral proved
  wrong.** "The Red Coach Inn" top-matched to a coaching inn in Shropshire,
  England and overwrote coordinates the model had gotten right; seven more
  lookups were silently dropped by a rate limit (KI-15). Auto-geocode is not
  a weaker version of the tool — it is strictly worse than doing nothing when
  it is confidently wrong, because it launders a guess into a stored fact.
  Kept here only as the record of why it was deferred and what killed the
  deferral; the live scope is M9.

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

- **AI "Preview" before apply — now scoped into M9.** Kept here only for the
  two implementation directions it records, which M9's design spec has to choose
  between (Mitchell, 2026-07-25): (a) lean on the event-sourcing/history
  substrate — a single pending "future" branch the user reviews and approves (or
  discards) to fast-forward into the real log; or (b) an intermediate, validated
  model of the proposed batch surfaced to the frontend for approval before it is
  applied. Becomes more valuable again at M13, where multiple actors make
  "propose then approve" a collaboration primitive rather than just an undo
  affordance.

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
  over-generate; the harness makes that measurable instead of anecdotal. This
  doubles as the fix for KI-11 (no test ever calls a real model).

- **Unscheduled rack: drag support is Board-view-only (2026-08-23, manual QA
  on PR #26's preview deploy).** **The drawer now follows this, not the other
  way round (2026-08-26, Mitchell, PR #55):** it renders only where a stop can
  actually be dropped, so closing any of the four gaps below brings the drawer
  back to that lens. The gate is `board/lensAcceptsDrops.ts` — one function,
  deliberately not a lens list, so "the drawer is here" and "you can drop here"
  cannot drift apart. Phase 3 wired `dropTargetForElements` for the
  rack's own drop zone, `Column.tsx`'s day columns, and each `ActivityCard` —
  all inside the Board (day-columns) lens. Nothing under
  `apps/web/src/components/lenses/` registers a drop target, so dragging a
  stop out of the rack does nothing in Calendar or Timeline view even though
  the rack itself is visible there too (it's mounted once, outside the lens
  switch, on purpose — see `TripBoardScreen.tsx`'s own comment). Four related
  gaps, captured together since they're all this same rack/lens boundary:
  1. Drag-from-rack onto a day in Calendar view — no drop target exists.
  2. Drag-from-rack onto Timeline view — no drop target exists.
  3. Whether the drawer should stay mounted across every lens (current,
     deliberate behavior) or collapse/hide itself on a view change is worth
     revisiting now that dragging into it only actually works from Board —
     showing it everywhere reads as "this works here" in views where it
     doesn't. **Decided (Mitchell, preview review, 2026-08-25):** hide it on
     Map only — Map is the one lens where the rack is a `position: fixed`
     overlay over a full-bleed canvas with nothing under it. Timeline and
     Calendar keep it mounted, because unlike Map they have a working
     non-drag path (the day-assign `NativeSelect` → real `MoveActivity`/
     `UpdateActivity`), so hiding it there would remove a capability, not
     just a misleading affordance.
  4. The drawer is `position: fixed; bottom: 0` (`globals.css`) with no
     clearance reserved in any lens's own content — unlike the assistant
     rail, which gets `.trip-board-content`'s right-padding reservation, no
     lens pads its bottom for the drawer. In Timeline (day list) and Calendar
     (month grid), real content can end up sitting underneath it near the
     bottom of the viewport instead of alongside it.
  5. (2026-08-24, Phase 8b cell rebuild) `CalendarLens.tsx`'s day cards and
     stop chips are now built to the design's drag affordance (dc.html:670-
     672's 6-dot grip, `cursor: grab` on both the grip and each chip) but
     are not draggable — `cursor: grab` was deliberately withheld so the UI
     never promises a drag it can't perform (the same failure mode gap 1-2
     already describe). Wiring them needs a drop target registered in the
     calendar lens itself (nothing under `apps/web/src/components/lenses/`
     does today, per the gap above) and reuses `MoveActivity`, the same
     command Board's `ActivityCard` drag already dispatches.

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
