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

- **Quick-add and search-to-add (cut from M41 at its scoping, 2026-10-10).** What was left of the
  M8 trim's C1 and C2. M41 judged both redundant with the gestures it builds. The river's
  double-click and drag already add a stop on a day, and M41's paste-to-add turns a Maps link or a
  line of text into one (D8). Place search already lives in the editor, and M34 suggests nearby
  stops there. A header input was never in the prototype either (`SPEC.md` §11 calls quick add
  "the in-trip FAB"). Revisit only if people are seen typing stops one after another and the
  editor is the friction.

- **Gesture and keyboard follow-ups left out of M41 (2026-10-10).** Considered while scoping M41
  and left for later, in rough order of value:
  - **Multi-select drag:** shift-click several stops and drag them as one batch.
  - **Resize by keyboard:** M41 gives moving a keyboard path (the editor's Day field) but not
    changing a stop's length.
  - **⌘K hands unmatched text to the assistant:** "Ask: …". ADR-068 §5 keeps the palette off the
    model in v1, so this needs a decision.
  - **Pinch or ⌘-scroll to zoom the river's time scale:** the scale is tuned, and pinch already
    zooms the page on a phone.

- **Accounts by tier, week by week, on the operator console (split out of M36, 2026-10-06).**
  The 2026-10-05 handoff draws one area chart per tier on the Users tab — accounts holding the tier
  at the end of each week for 26 weeks, with *+N added* and *−N lost* over 30 days
  (`.design-sync/handoff/specs/operator-console.md`, *Accounts by tier*).
  - **What exists.** Nothing history-preserving: `users.plan_id` is the current holding, and
    `entitlement_grants` plus `subscriptions` say what is held now, not what was held last week.
  - **Decisions it needs.** A weekly rollup table (a migration and a scheduled job, exact from the
    day it ships, empty before) or a derivation from `entitlement_grants` and `billing_events`
    (back-fills history, but has never been checked against Stripe's own record). The spec's open
    question 2; M36 decision 4 is why it is here rather than there.
  *Placed 2026-10-06 → `docs/milestones/M47-the-business-over-time.md` (proposed, not yet scoped). M47's gate deletes this entry at close.*

- **An account-wide assistant that answers about every trip you have taken (asked 2026-10-04).**
  Mitchell: *"Account wide AI assistant, be able to ask about what kind of trips they have taken
  overall"*, with examples: *what was the most expensive meal I've eaten, how many countries have
  I travelled to, what city have I been to the most, suggest the next country I should visit that
  I haven't been to*.
  - **What exists.** The assistant is scoped to one trip (ADR-022, ADR-033) and reads through
    tools derived from the gateway (ADR-015).
  - **The idea.** An assistant opened from the home page whose tools read across all of the
    user's trips: costs by category, countries and cities from stop coordinates and places, visit
    counts. The first three examples are aggregation over data we hold; the fourth also needs a
    "countries visited" set to subtract from.
  - **Decisions it needs.** Which trips count (own only, or shared ones the user merely
    advises on; see "who is actually travelling" above). Whether aggregates are computed by
    deterministic tools or the model reads trip dumps (cost and accuracy). Country/city
    derivation where a stop has no geocoded place. Invariant 7 still holds: it reads only what
    the user could open. Pairs with "User memory", which is deferred with the eve port.
  *Placed 2026-10-06 → `docs/milestones/M45-the-assistant-beyond-one-trip.md` (proposed, not yet scoped). M45's gate deletes this entry at close.*

- **A chat for a trip, with the people taking it (asked 2026-10-04).** Mitchell: *"a chat for a
  trip with the others taking the trip"*. Nothing like it exists; collaborators coordinate
  outside the app.
  - **The idea.** One thread per trip, visible to members, optionally linking a message to a
    day or stop.
  - **Decisions it needs.** Whether messages are trip events (History, replay, ADR-012) or
    their own store (they are conversation, not plan state, so the second looks likelier).
    Which roles may read and post (a suggester?). Realtime versus refresh. Notifications, which
    nothing generates today. Moderation, report and delete, given the admin reports panel.
    Retention when a trip is soft-deleted (ADR-016).
  *Placed 2026-10-06 → `docs/milestones/M46-a-trip-has-a-conversation.md` (proposed, not yet scoped). M46's gate deletes this entry at close.*

- **The assistant can move around the site (asked 2026-10-04).** Mitchell: *"give the AI agent
  the ability to move around the website, go to notebooks, change to map view, etc"*.
  - **The idea.** Navigation tools the assistant calls: open a notebook, switch the trip lens
    (Plan, Map, Calendar), jump to a day or a stop, open the Travelers panel. The reply carries a
    navigation instruction the client performs.
  - **Decisions it needs.** The assistant is read-only (ADR-022) and takes only paths its user
    could take (invariant 7); navigation changes no trip state, but it should still be a
    client-side action the user sees, never a silent redirect. Whether it asks before leaving a
    page with unsaved input. How it learns the available destinations (a typed route list, not
    free URLs). Cheap to build once the account-wide assistant exists, since that assistant has
    no page of its own to start on.
  *Placed 2026-10-06 → `docs/milestones/M45-the-assistant-beyond-one-trip.md` (proposed, not yet scoped). M45's gate deletes this entry at close.*

- **The assistant on eve: the port, deferred until there are users (asked 2026-10-02,
  deferred 2026-10-03).** ADR-062 records the decision and the Phase 0 spike's evidence.
  Mitchell chose a full port onto Vercel's eve framework, with the ledger first. On
  2026-10-03 he built the ledger (**M31**, which is ADR-062's Phase 1) and parked the rest:
  *"I want to get some users before i increase the cost of my AI usage by moving to eve and
  workflow"*.
  - **Cost.** Phase 0 measured Workflow at roughly 20–70% on top of a turn's model cost.
  - **Benefit.** It protects real traffic, and there is none yet: `ai-live` is still
    Simulated in production.
  - **What is left.** ADR-062 Phases 2–5: the adapter, `apply_proposal`, the client, and the
    parity gate.
  - **What reopens it.** One of the four triggers in ADR-062 § *Deferred: the port*: turns
    lost at the deadline, a feature needing background work, eve 1.0, or paying traffic.
    That section also keeps the steps for reopening it and the proposed, never-approved
    parity thresholds.
  - **Scoped, not placed.** No gate deletes this entry.

- **User memory: the assistant knows who you are and what trips you like
  (asked 2026-10-02).** Deferred out of ADR-062 by agreement. The expected shape is
  a per-user profile derived from the command and event log, recalled through
  eve's memory slot, rather than embeddings. It opens with two decisions ADR-062
  §6 leaves open: whether conversation text is stored at all, and how memory
  behaves on a shared trip. It depends on the eve port (the entry above), which is
  deferred.

- **An SEO pass over the public library (asked 2026-10-02).** ADR-061 made
  `/playbooks`, its days, profiles and board readable without an account.
  Mitchell, 2026-10-02: *"I have no issue being crawled, we should do a seo pass
  at some point soon"*. So crawling stays allowed (there is no `robots` file,
  and none is wanted to block it). The pass would cover:
  - a `sitemap.ts` of published days;
  - canonical URLs without `?from=`;
  - per-page `description`s, which today come from the og `meta` lookup;
  - structured data for a day;
  - whether profile and board pages earn a place in the index.

  **Built 2026-10-03 as five stacked PRs, #295 (crawl plumbing), #296
  (sitemap), #297 (server-rendered days, real 404s, slugs), #298 (structured
  data) and #299 (city and country pages), to merge in that order.** Plan:
  `docs/plans/2026-10-02-seo-pass.md`. What spec §7 left out, still candidates:
  indexing profiles or the board; paginating Discover; public notebook
  templates (a contract change); public pages for the sample trips under
  `content/trips/`. Still Mitchell's, outside the code: the firewall bypass
  for `/`, `/welcome`, `/playbooks/**`, `/robots.txt` and `/sitemap.xml`;
  submitting the sitemap; the production canonical check.

  **Audited and designed 2026-10-02; Mitchell: *"Lets start the SEO work"*.**
  The design, with its nine decisions and five stacked PRs, is
  `docs/specs/2026-10-02-seo-pass-design.md`; it has no plan yet. What the audit
  added to that list, most valuable first:
  - **The Vercel firewall challenges crawlers on every page this pass is
    about.** `/`, `/robots.txt` and `/sitemap.xml` answered `429 Vercel Security
    Checkpoint` to non-browser clients from two networks; `/llms.txt` and
    `/api/og/playbooks` answered 200. It is the dashboard rule
    `docs/guidelines/using-the-api.md` already describes. Whether verified
    Googlebot passes was not testable from here.
  - Every day page has one `<title>`, "A playbook — Caesura"
    (`apps/web/src/lib/linkPreview.ts` keeps the tab title generic on purpose).
  - The public screens are client-rendered, so the HTML a crawler gets is a
    skeleton (KI-2026-09-20-f), and a missing day answers 200.
  - Discover shows 24 days with no pagination, so the sitemap is the only way
    most days are found.
  - City pages as paths (`/playbooks/city/kyoto`) and not `?city=`: the city
    card and copy already exist.
  - `/welcome` renders two `<h1>`s, and `/s/<token>` and `/invite/<token>`
    carry no `noindex`.
  *Placed 2026-10-06 → `docs/milestones/M42-the-front-door-shows-more.md` (proposed, not yet scoped). M42's gate deletes this entry at close.*

- **Structured booking fields on a stop — confirmation number, provider, link
  (asked 2026-09-30).** From an external API consumer's feedback: confirmation
  numbers live in `notes` today. A stop has `cost`, `bookedBy` (a member id) and
  `pendingReason: "book"`, but nothing structured for *what* was booked. Mitchell,
  2026-09-30, chose **not now** over a notes convention (`Confirmation: …` lines
  a card recognises) — parsing free text is fragile and gives API callers nothing
  typed. The shape if it comes: an optional `booking: { confirmation?, provider?,
  url? }` on the activity contract. Additive, but it enters the event payloads
  that are replayed forever (invariants 1 and 2), so it is placed as a small
  milestone, not a PR.

  Open questions: which fields actually render (card, editor, the Money notebook?),
  whether check-in/out times belong here or in the time window, and whether a
  confirmation number is sensitive enough to hide from viewers and share links.
  *Placed 2026-10-06 → `docs/milestones/M44-a-stop-knows-what-was-booked.md` (proposed, not yet scoped). M44's gate deletes this entry at close.*

- **Reset a trip's default notebooks to their seed, and add any seed the trip is
  missing (asked 2026-09-27).** Mitchell, reading the M29/M30 Overview: *"Its hard to
  test this, we might want a way to reset a trips default notebooks back to there seed
  and add any new seeds that didnt exist when the trip was made."* A trip gets its
  default notebooks once, lazily, the first time its notebooks are listed
  (`apps/web/src/server/pages.ts`, `instantiateDefaults` in
  `packages/pages/src/templates.ts`). So a trip made before M30 never gets the new
  itinerary Overview or the seeds added since, and the only fresh copy is a new trip or
  `/demo`. Two actions:
  - **Add missing seeds.** Seed each `DEFAULT_TEMPLATES` entry the trip has no system seed
    row for. `pages_system_seed_unique` already identifies seeded rows, so this is the
    existing insert with `onConflictDoNothing`.
  - **Reset a seeded notebook to its template.** Notebook history is event-sourced per
    page (ADR-036), so a reset is one more edit session: undoable, and visible in
    history, not a delete-and-recreate. It should confirm first, since it replaces the
    notebook's content.
  
  Open questions: where the control lives (the notebook list, or each notebook's menu),
  who may use it (owner only?), and whether the Overview's links to the other seeds
  survive a reset (they name seed ids, which a reset keeps).
  *Placed 2026-10-06 → `docs/milestones/M43-notebooks-keep-up.md` (proposed, not yet scoped). M43's gate deletes this entry at close.*

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

- **More than one demo trip: a picker on the front door and `/demo/<slug>`
  (asked 2026-09-27).** Only Japan is public; `content/trips/` holds four more
  (Dolomites, Iceland, Northern Spain, Thailand) that nothing public shows.
  Mitchell liked a hero trip picker but kept it off the home page for now to
  avoid complicating it. Depends on the landing snapshot generator in
  `docs/specs/2026-09-27-link-previews-and-real-hero-design.md` §3.2 (one
  snapshot per trip) and on `server/demoTrip.ts` folding a bundle, not only the
  Japan fixture.
  *Placed 2026-10-06 → `docs/milestones/M42-the-front-door-shows-more.md` (proposed, not yet scoped). M42's gate deletes this entry at close.*

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
  *Placed 2026-10-06 → `docs/milestones/M47-the-business-over-time.md` (proposed, not yet scoped). M47's gate deletes this entry at close.*

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
  *Placed 2026-10-06 → `docs/milestones/M41-planning-without-friction.md` (scoped 2026-10-10). M41's gate deletes this entry at close.*
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
  *Placed 2026-10-06 → `docs/milestones/M43-notebooks-keep-up.md` (proposed, not yet scoped). M43's gate deletes this entry at close.*

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
  matters (`pages_seed_key_unique`, since 2026-09-27) is keyed off the seed rather than off
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
  *Placed 2026-10-06 → `docs/milestones/M43-notebooks-keep-up.md` (proposed, not yet scoped). M43's gate deletes this entry at close.*

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
  *Placed 2026-10-06 → `docs/milestones/M43-notebooks-keep-up.md` (proposed, not yet scoped). M43's gate deletes this entry at close.*

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
  *Placed 2026-10-06 → `docs/milestones/M43-notebooks-keep-up.md` (proposed, not yet scoped). M43's gate deletes this entry at close.*

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
  *Placed 2026-10-06 → `docs/milestones/M45-the-assistant-beyond-one-trip.md` (proposed, not yet scoped). M45's gate deletes this entry at close.*

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
  *Placed 2026-10-06 → `docs/milestones/M42-the-front-door-shows-more.md` (proposed, not yet scoped). M42's gate deletes this entry at close.*

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
  *Placed 2026-10-06 → `docs/milestones/M41-planning-without-friction.md` (scoped 2026-10-10): C3 is built as the editor's Day field (D3) and the empty states as D4/D5. C1 and C2 were cut and are re-filed as their own entry, *Quick-add and search-to-add*. M41's gate deletes this entry at close.*

- **Duplicate and the undo-toast's Restore: no optimistic update yet (Mitchell,
  2026-08-01, from M8 dogfooding).** Delete's optimism (page.tsx's
  `deletingIds` filter-set, M8/A15 follow-up) and the rename/date/budget
  optimism fix (TripHeader reading `activeTrip` instead of `trip`) both landed
  as small, well-scoped fixes. Duplicate (network round-trip before the
  redirect fires) and Undo (`page.tsx`'s `undoDelete` does a full `load()`
  refetch rather than re-inserting the row locally) are lower-value/more work
  for now — deferred rather than done reflexively.
  *Placed into M41 on 2026-10-06, and cut at its scoping on 2026-10-10: it is a Home trip-list item, off M41's theme. Unplaced again.*

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
  *Placed 2026-10-06 → `docs/milestones/M44-a-stop-knows-what-was-booked.md` (proposed, not yet scoped). M44's gate deletes this entry at close.*

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
  *Placed 2026-10-06 → `docs/milestones/M41-planning-without-friction.md` (scoped 2026-10-10). M41's gate deletes this entry at close.*

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
  *Placed 2026-10-06 → `docs/milestones/M41-planning-without-friction.md` (scoped 2026-10-10). M41's gate deletes this entry at close.*

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

- **Travellers who are not on the app count toward per-person cost (asked 2026-10-10).**
  Mitchell: *"set people going on trip (we kinda have that now with those invited) but also add
  people who arent in the app who are going on trip so you can get the per person trip price
  correct"*. His example: a family of three, husband, wife and a baby. The husband and wife both
  edit the trip; the baby has no account but is still coming, and per-person cost has to know
  there are three people.
  - **What exists.** ADR-065 made travelling a per-person Access attribute:
    `trip_travellers(trip_id, user_id, travelling, …)`, counted at read time by `overlayMembers`
    through `travellerIds(members)`. Every traveller is a member with an account, so a trip can
    count only the people who have been invited and accepted. The People panel (M35) is where
    travelling is set.
  - **The idea.** The owner (and maybe editors) can add a named traveller with no account, for
    example "Baby" or "Grandma", from the People panel. That person counts in "nobody picked"
    totals and can be picked in *Who is in* on a stop, exactly as a member traveller is. They
    never sign in, never receive an invite, and appear as a person without an avatar. If they
    later join the app, they can be linked to the invited account so their picks carry over.
  - **Decisions it needs.** Where a non-account traveller lives: a row in `trip_travellers` with
    no `user_id` (an id of its own plus a display name), or a separate `trip_guests` table. Either
    way it stays Access data, not planning events, per ADR-065 D1. *Who is in* picks are stored as
    user ids today, so picking a guest needs an id space that is not a user id, and the planning
    events would then name someone Access owns. That is the half-evented boundary question again.
    Whether a guest can be *Booked by* (probably not; they have no balance to settle) and how
    balances split when guests travel, since a baby costs but does not pay; a parent pays for
    them. Whether some guests are priced differently from adults (infant or child fares, a
    per-traveller multiplier) or whether that stays out of scope and the stop's price is edited
    instead. Who may add or remove a guest (the owner only, like `maySetTravelling` for others,
    or any editor). How the public API's `GET /v1/trips/:id/members` and `cost × headcount`
    totals show guests (a contract change, `docs/contracts/CHANGELOG.md`). How the assistant
    and notebook widgets that count heads see them.
  **Not placed.**
