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

- **The front door tells the story: a homepage redesign from Mitchell's 2026-10-19 walk
  (asked 2026-10-19).** Walking production `/` after M50 part 9 (PR 503, merged as a stopgap),
  Mitchell said the homepage needs a bigger design review, not more fixes:
  - **Whole real pages, not lifted widgets.** Tiny app widgets lifted out of their page lose the
    magic. Show whole real pages; the notebook page (part 9's diary page) is the model.
  - **One seamless flow on desktop, like mobile.** The desktop's alternating dark/light bands (the
    "checker") leave dead space on wide screens and flow awkwardly. Make it one continuous ground,
    each card fading into the next, the way the phone's pinned scroll already does.

  **His six toolbar threads, verbatim** (Vercel preview of PR 503, ultrawide 3440px, code at
  `6d167a0b`):
  - *Hero, "Plan the trip together."* (`LandingScreen.tsx:170-267`):
    > Theres too much deadspace today on the left and right. The plan the trip together section
    > map view doesnt extend to the left so it looks bad now

    Content is capped at `max-w-285` (1140px, `:222`); `.landing-hero-veil` (`globals.css:1915-1924`)
    paints the left 30% solid paper; the map art (`LandingHeroArt`) sits in the right column only.
  - *Playbooks spread, "Relive someone's perfect day."* (`LandingFeatureBlocks.tsx:383-398`):
    > I dont like the dark/light checker pattern background

    > The goal of this section was to give a high level example of how easy it is to find a day and
    > slow it into a trip. I think we lost that somewhere, the left feels unrelated to the right
    > (expecially since its a different trip and theres nothing that connects the right to the left?)

    ("slow" = "slot".) The find-a-day-and-slot-it story survives only in the fallback drawing
    `PlaybooksArt` (`:207-254`); the live page shows two unrelated Discover cards and no trip.
  - *Together + Countdown row* (`LandingFeatureBlocks.tsx:405-480`):
    > These two cards dont relate to each other, but they are next to other like they should, its a
    > confusing experience.
  - *Notebook spread, "How you'll remember it."* (`LandingFeatureBlocks.tsx:486-501`), the positive one:
    > I think i like this one the most, its a real card from notebook, it shows how its used and how
    > its beneficial
  - *Pricing* (`LandingScreen.tsx:281-283`, `LandingPricing.tsx:24-54`):
    > I dont like how pricing is shown today at all, Its very sterile. The goal was it to bring some
    > excitement
    >
    > 1. Free tier! you can still have all the trips you want
    > 2. Want some help? for 9/month a personal ai assistant will help you put together a perfect trip
    > 3. Want to bring all your friends along? Only 1 person needs to be premium, and invite the crew to join
    >
    > Something kinda like that ^ But really work on that design, its very placeholder

  **Desktop vs mobile today.** Desktop (`LandingScreen.tsx:145-354`) is a stack of bands: moss hero,
  moss playbooks spread, paper Together/Countdown row, mirrored moss notebook spread, paper pricing,
  paper closing quote. All held to 1140px (`PAGE`, `LandingFeatureBlocks.tsx:94`) with a 54px gap
  and a hard `border-y` between islands, so at 3440px about two-thirds of every band is empty.
  Mobile (`PhoneFrontDoor.tsx`, SPEC §28) is one pinned scroll (`:454-455`): one moss map behind,
  four claims stacked in one slot and crossfaded by scroll progress with overlapping fades
  (`EDGE = 0.16`, `:73-90`), never blank, releasing onto the closing quote and pricing.

  **Recurring themes:** wide-screen dead space; kill the checker and the zig-zag; things side by side
  must relate (or not sit side by side); show the story or outcome, not a specimen; real widgets in
  their real page; pricing is placeholder and should sell outcomes with energy.

  **Decided so far (Mitchell, 2026-10-19):** it is its own milestone, not more M50 parts, and it
  starts with a design review with sketches before any code. Open for that review: the pricing
  pitch's *"Free tier!"* against the landing's no-"free" copy rule (SPEC §14, cited at
  `LandingScreen.tsx:24-29`). The design review settled it on 2026-10-20: no "Free tier!", and
  no exclamation marks (M51 decision 6).
  *Placed 2026-10-20 → `docs/milestones/M51-the-front-door-tells-the-story.md` (scoped). M51's gate deletes this entry at close.*

- **The book motif across the app: the trip notebook as a bound book, with a page flip
  (asked 2026-10-20).** Direction B2 of M51's design review: the landing as a real bound book
  (cloth spine with head-band and stitching, board edges, a stacked fore-edge, a hardback cover),
  whose pages turn to tell the borrowed-day story (*"Her day 3 becomes your day 1"*). Motion
  prototype: https://claude.ai/artifact/1nbkRFcYQN4jM2UgVi5J5T. Mitchell, round 1: *"the notebook
  design is maybe the most ambitious and the one that is currently resonating with me the
  most"*. **Why it waits**, verbatim: *"i love the book motif but i am not commited to rewriting
  rest of app right now"*. It only works if the app's notebooks become books too, which is a
  rewrite of the notebook surfaces, so M51 took C2 instead. His open comments on the prototype go
  with it:
  - *"Its not obvious these are books. I dont mind them being single pages, and the page turn will
    probably still look fine, but they need to be clearly a book for this to work"* (phone).
  - *"Can we try a different color than the dark blue that can accent the dark green of the rest
    of the colors? Also any ideas for some more texture to the cover? right now it feels too
    flat"*.
  - *"the cost page should be the second to last page, the last page should be the CTA to
    signup/find a day to start with. Also try out making them top to bottom rather than left to
    right"*.
  - *"use the camera, bike, boat emoji on the chips on the cards, and drop them from the top"*.

  Open: whether the notebook screen itself adopts the book (spine, page turn) before the landing
  does, and how a book reads on a phone. Unplaced; no gate deletes this entry yet.

- **Real reviews replace the landing's sample ratings (asked 2026-10-20).** M51 gives the
  landing's sea of day cards sample ratings in `ratingLine`'s format (*★ 4.8 · 37 reviews*, about
  one in nine *"No reviews yet"*). That reverses M50 part 9's no-invented-rating call for the
  landing only. Mitchell, verbatim: *"just add the sample ratings, and we will re-address as
  reviews come in and use the real trips then"*. **What reopens it:** library days with real
  reviews in production. Then the build-time snapshot (`apps/web/scripts/landing-demo.ts`, the
  sea's generator from M51 part 1) takes each day's real rating and count at generation time, and
  the sample values go. Open: the threshold for showing a real count, and whether the sea prefers
  well-reviewed days. Unplaced; no gate deletes this entry yet.

- **Gesture and keyboard follow-ups left out of M41 (2026-10-10).** Considered while scoping M41
  and left for later, in rough order of value:
  - **Multi-select drag:** shift-click several stops and drag them as one batch.
  - **Resize by keyboard:** M41 gives moving a keyboard path (the editor's Day field) but not
    changing a stop's length.
  - **Pinch or ⌘-scroll to zoom the river's time scale:** the scale is tuned, and pinch already
    zooms the page on a phone.
  - **Follow Google Maps short links on paste:** a `maps.app.goo.gl` link is what the Maps app's
    Share button gives on a phone. M41's paste-to-add (`lib/pasteToStop.ts`) puts it in the notes
    and leaves the title empty, because reading the place out of it needs a server request to
    Google per paste, against a redirect that is not a documented API. Worth it if people are seen
    pasting short links and retyping the place.

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
  **Status (2026-10-17): the annotation layer exists by hand.**
  `docs/architecture/SYSTEM-DESIGN.md` (as of 2026-10-05) is the as-built design, and `CLAUDE.md`
  points to it; it is written by a person, not at gate close, and its own header says nothing
  checks it. Still not built: the generated map (that file says so), the gate-close step, and
  the KI binding.

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
  **Status (2026-10-17): M33 built the harness.** `pnpm --filter web eval` runs the live set
  through the real `/ask` handler on production's per-tier models and scores each turn by code,
  and `EVAL_MODEL_<TIER>` swaps one tier's model to measure a candidate against the same prompts
  (`docs/milestones/M33-evals.md`); the 2026-10-05 cheap-tier switch was chosen that way. What
  is left is only a sweep of several models in one run, and a table of the results.

- **Reposition a cover: drag the photo to choose what the band shows (asked 2026-10-10).**
  Mitchell, on the trip page's cover: *"i want to do the adjusted photo crop like notion option
  later"*. The desktop trip page now shows the cover as a 384px band that fades into the page
  under the header (`TripCoverBanner`, the playbook day's treatment). It is still a center crop,
  and the fade hides the bottom third, so a photo whose subject sits low (a beach, a street,
  people) can lose it. Unsplash gives no focal point to aim at.
  - **What exists.** `TripCover` (`packages/contracts/src/cover.ts`) holds the photo's URLs and
    credit, stored in the CRUD side table `trip_covers`, not in the event log. `CoverImage`
    renders it with `object-cover` and no `object-position`.
  - **The idea.** Notion's *Reposition*: from the band, an editor drags the photo up or down and
    saves. Store one vertical position (0–100%) with the cover and render it as
    `object-position: center <y>%`. A playbook day's cover could use the same thing.
  - **Decisions it needs.** The field and its default (50%, today's crop) in `TripCover`, a
    `trip_covers` migration, and a contract change logged in `docs/contracts/CHANGELOG.md`.
    Whether a horizontal position is worth storing too (the home card's crop is the other
    shape). Where the control lives: on the band itself, or in Trip settings' Cover photo
    preview. Whether choosing a new photo resets the position. Keyboard and phone handling for
    the drag. Whether the stored position also applies to the card on Home.
  *Placed 2026-10-12 → `docs/milestones/M49-covers-from-anywhere.md` (proposed, not yet scoped). M49's gate deletes this entry at close.*

- **The assistant knows which surface started the conversation, and can start a trip from scratch
  (asked 2026-10-13).** Mitchell, walking M45 on production: *"it should be conscious of what tab
  started the conversation and outside a specific trip should be a place to have the tool to start
  a new trip"*, and *"we want to do [that] from the assistant … file that as a future improvement
  to build"*.
  - **What exists.** M45 (`docs/milestones/M45-the-assistant-beyond-one-trip.md`, the assistant
    beyond one trip) put an assistant on Home and on the playbook pages. A playbook day's assistant
    can **start a trip with this day**, as a proposal that runs after Approve (M45 decision 9).
    Nothing starts a brand-new trip from scratch: asked to do that on Home, the assistant refused.
  - **The idea.** The assistant is aware of the surface or tab that opened it (Home, a playbook
    day, a trip, and so on) and acts accordingly. Outside a specific trip, for example Home's
    account assistant, it has a tool to start a new trip from scratch. M45's
    start-a-trip-from-a-day proposal and Approve flow is the natural shape.
  **Not placed.**

- **Trip chat follow-ups from M46's preview walk (asked 2026-10-13).** Mitchell, testing PR 439:
  - **Link a notebook from a chat message.** *Shipped in PR 446 (2026-10-14), with people as
    well: `@` mentions a person or a notebook, checked server-side against the trip.*
  - **Notify the person a message mentions** (PR 446's body, 2026-10-14). Mentioning someone
    today only draws their name; nothing tells them.
  - **Group a run of messages.** When one person sends several messages in a row within 30 minutes,
    show the author once and draw the run as one visual block.

- **The tier charts show gross added and lost, not only net (Mitchell, 2026-10-17, at M47's
  part 4).** `tier_weekly` holds one count per plan per week, so the Users tab can draw net change
  only. *+N added / −N lost* needs a per-account weekly snapshot (or a holdings diff in the rollup
  job), so the job can tell an account that moved between tiers from one that joined or left.

- **The trip page renders its first data on the server (found by PR 481's audit, 2026-10-18).**
  The biggest load-time item that pass left out: it was larger than a cleanup.
  - **The trip page itself: done in PR 486 (part 1).** `(board)/page.tsx` reads the board's first
    answers in-process (`server/tripFirstData.ts`) after one `requireTripAccess`, with the GET
    routes' own view builders (`server/tripViews.ts`), and `TripProvider`'s `initial` seeds the
    query cache in the browser. The header and cover band draw on the server, the band hidden on
    a phone by CSS and a `<picture>` whose phone source is blank. Measured in PR 486.
  - **Same pattern, smaller (what is left of this entry):** `/s/[token]` (`SharedTripScreen`
    fetches in an effect), the `/playbooks/profile/[userId]` and `/playbooks/board` pages
    (`useLibraryRead` without `initial`), and `/demo/[slug]` (static shell, then six API reads;
    build the demo's `TripDetail` at build time).
  - **Measure first and after:** the Vercel Real Experience Score and Sentry, which PR 481 had no
    access to. Its numbers came from a local production build.

- **The Overview document is in the first HTML (found by PR 486, 2026-10-18).** On a phone the
  trip page's LCP element is a `<p>` of the Overview notebook. Since PR 486 the first HTML holds
  the trip's header and the lens's skeleton, but no lens: the board is `inert` and every lens is
  its placeholder until hydration (so no tap lands on a dead control, and a phone sees no lens in
  its desktop form — only, at `?view=Plan`, the placeholder's day chips in the body, which move
  into the pinned header once the phone hook corrects), and the lens's chunk loads after it. The paragraph then waits on the
  editor too: `PageEditor` creates TipTap with `immediatelyRender: false`. It needs a static
  server render of the document — TipTap's static renderer or `generateHTML`, a new dependency,
  or a second renderer — swapped for the editor once the editor exists. Mitchell deferred it on
  2026-10-18, out of the trip page's first-data stack. Measured in PR 486.
  - **What PR 486 measured** (Lighthouse 12, mobile, local production build, median of 5,
    devtools throttling): LCP 10.70s on main, 8.11s with the PR. Under Lighthouse's default
    simulated throttling LCP is about 7.7s for every variant, because Lantern charges all
    JavaScript evaluation before the paint. A throwaway prototype that put the Overview's
    paragraphs in the server HTML, in the editor's own classes, moved the observed (unthrottled)
    LCP to the first paint but not the simulated one — so a static render's lab value has to be
    judged under devtools throttling. LCP's remaining ~8s is main-thread render delay, not
    network: React hydrating the board in the framework chunk, about 2.7s of scripting at 4x.
  - **A phone's first HTML is the desktop form until hydration.** `useIsPhone` is `false` on
    the server and on the first client render, so `TripHeader` (its one-row phone header) is
    drawn in its desktop form in the server HTML and shifts when the hook corrects after
    hydration. Before PR 486 it did not render until the provider had loaded, by which time the
    hook had. The lenses no longer do this, being placeholders until hydration, except that
    Plan's placeholder draws its day chips in the body, where a phone pins them in the header
    after hydration. Accepted for
    part 1; the fix is the same breakpoint in CSS (`max-md:`) wherever the form is only a
    restyle.

- **Trip requests stop re-reading the whole trip (found by PR 481's audit, 2026-10-18).** Every
  `/api/trips/[tripId]/**` request runs `requireTripAccess`, which reads and Zod-parses the whole
  trip document plus 3–7 member, entitlement and guest queries. The events poll does this every 2s
  per open tab, about 9–13 queries a poll. Opening a trip fires 5–9 such requests. PR 481 only made
  `readTrip`'s guests read run in parallel.
  - A light `tripRoleFor(userId, tripId)` for routes that need only the role (`events`, `chat`,
    `globals`, `pages`, `weather`, `suggestions`): `trip_summaries.members` plus the
    `trip_memberships` primary key, with the entitlement check only for a membership-row role. It
    must give the same answer as `effectiveMembers`, lapse cap included. That is access control:
    an ADR, and tests on every denial path.
  - Collapse the poll's head-seq, access-rev and chat-rev reads into one statement. Keep a
    `suggestions_rev` counter like `trip_chat_revs` instead of hashing every open change row.
  - Have `readTrip` return `guests` and `collaboratorsEntitled`, so the access, members, chat and
    history routes stop re-running them (chat runs the entitlement check twice per request).
  - Optionally a bootstrap endpoint: detail, history, access and pages after one access check.
  - Consider a 4–5s poll with idle back-off.

- **Smaller query and fetch follow-ups left by PR 481 (2026-10-18).** Each is small. Grouped so
  none is lost.
  - **The embedding sweep** (`server/ai/sweep.ts`) re-reads the whole trip document for each
    claimed day row, so editing one trip makes N document reads. Group by source, batch-load with
    `inArray`, build chunks once per source, and batch the status updates.
  - **Geocode quota** is charged one stop at a time (`geocodeEnrichment.ts` `affordable`,
    `assistantPorts.ts` place search). Batching needs a capped bump on `QuotaCounters` to keep
    today's stop-at-first-refusal charging, which touches the interface, the Postgres store and
    every fake.
  - **Discover, signed in** (`server/playbooks.ts`): it runs the same filter twice per request,
    and the keyset clause recomputes `matchedCount` per row, so it can't use an index.
    `ownerNames` uses two correlated subqueries per row where one join would do.
  - **`listPageRows`** selects whole page rows, `content` JSONB included, to build summaries.
  - **`day_embeddings`**: check with EXPLAIN that the dense leg's `ORDER BY embedding <=> $q, id`
    still uses HNSW. Ordering by distance alone inside the leg may be needed.
  - **⌘K's trip read** now pays for `GET /api/trips`' spend reads it ignores: every listed trip's
    document read and parsed, at idle on every `(app)` page and on each opening. A list variant
    without `spend` is the fix if it shows up in the ledger or Sentry.
  - **Client reads the server already has:** `PageScreen` calls `fetchTripDetail` outside
    `cachedRead`, `PreferencesProvider` fetches preferences the layout could pass, Settings'
    `PlanSection` and `TokensSection` re-fetch what the layout resolved, and the admin layout's
    `PreferencesProvider` fetches without `noSessionCookie`.

- **The major upgrades Dependabot is told to skip (2026-10-18, PR 481).** `dependabot.yml`
  ignores majors because each is a migration. PR 481 took every in-range bump and left these. Do
  each on its own branch, with its upgrade notes read:
  - `@tiptap/*` 2 → 3: also the only fix for GHSA-cp6q-959q-f8rh (KI-2026-10-18-b). The notebook
    editor, 23 files.
  - `eslint-config-next` 15 → 16 (matching `next` 16): it should drop the `braces` advisory
    pulled in through `fast-glob` → `micromatch`, which has no patched release.
  - `zod` 3 → 4 (contracts and every consumer), `typescript` 5 → 7, `eslint` 9 → 10, `vitest` /
    `@vitest/coverage-v8` 4 → 5, `msw` 2 → 3, `jsdom` 29 → 30, `@vitejs/plugin-react` 4 → 6,
    `@types/node` 24 → 26.
  - `@sentry/nextjs` / `@sentry/profiling-node` 10 → 11.
  - `@atlaskit/pragmatic-drag-and-drop` 3 → 4, together with auto-scroll ≥3.2.1, which
    `dependabot.yml` pins until this migration (`check-singletons`).

- **Facts from PR 485's Lighthouse pass, kept so they are not measured again (2026-10-18).**
  - **"Legacy JavaScript" is Next's own `polyfill-module`** (`Array.prototype.at`, `flat`,
    `Object.hasOwn`, `URL.canParse`…, ~15KB raw). Next ships it unconditionally and `browserslist`
    cannot remove it. Aliasing it away would also drop `URL.canParse` for Safari 16. Left alone.
  - **The Replay split can regress silently.** PR 485 moved Sentry Replay into a chunk loaded at
    idle (`lib/lazySentryReplay.ts`). Any static client reference to `Sentry.replayIntegration`
    pulls rrweb back into every page with every test green. A build-output check beside
    `check:build-sentry` (no `rrweb` in `rootMainFiles`) would hold it.
  - **Prefetch volume on `/playbooks`:** 20+ RSC prefetches on load, each card link twice. Left
    alone on purpose, because they are what makes opening a day feel instant. Revisit only if
    field data shows contention.
