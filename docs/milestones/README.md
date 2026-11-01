# Milestones and gate discipline

Work proceeds through gates in order. A milestone is done when its **gate**
passes: a demo script runs clean, the test suite (including all prior
milestones' e2e scripts) is green, and a short retro note ("what we learned,
what changed") is committed. No building ahead of the current milestone.

Each milestone gets its own file here with an exit checklist before work on it
begins. Scope inside a milestone can flex; a gate definition changes only by
explicit decision from Mitchell, recorded in the file.

## Gate-close checklist (run in one commit when a milestone's gate passes)

A milestone's gate passing is the single trigger for flipping **every** status
flag, in **one commit** — never a trailing manual step (that is how M2 stayed
unticked). When the deployed gate demo passes:

> **`pnpm milestone close <id>` performs steps 1, 4 and 6, lists 3, 5 and 7,
> and refuses to do them wrong.** It will not close a milestone with open
> exit-gate boxes, will not proceed on a parse that found nothing, will not
> write anything without `--confirm` — it prints a diff first — and **reads which milestone
> becomes current from `TODO.md`'s row order**: the next unticked milestone row,
> skipping rows marked PAUSED. `--next <id>` is optional and only asserts that
> answer; if it disagrees with the rows it refuses and tells you to move the
> row. Steps 3, 5 and 7 are judgement and stay yours; it lists them rather than
> inventing them.
>
> **A reorder therefore moves `TODO.md`'s rows** (and is recorded below, under
> its date, as every reorder is). That is the choice that closed
> `KI-2026-09-21-a` on 2026-09-24: before it, `TODO.md` said "read the marker,
> not the position", so row order carried nothing, the script had to require
> `--next`, and closing M26 its row-order guess was M12 when the order was
> `M26 → M13 → M12`.

1. Tick the milestone in `TODO.md`.
2. Check every exit-gate box in the milestone's own file (`docs/milestones/`).
3. Append the retro note to that milestone file.
4. Bump **Current milestone** at the bottom of this file — the single source of
   truth (`AGENTS.md` points here, so this is the *only* place the number
   changes).
5. **Update `docs/STATUS.md`'s "Where the work is right now" and "Next
   action".** *(Added 2026-09-01.)* It was missing from this list, and the cost
   was measured: neither M11a's nor M11b's gate-close commit touched it, so the
   file `CLAUDE.md` tells every session to read **first** spent two gates
   claiming both were still open PRs in review. STATUS.md's own header promises
   it is "updated at every milestone boundary" — this step is what makes that
   true. Keep it to the pointer; the narrative belongs in the milestone file.

6. **Delete the `docs/candidates.md` entries this gate absorbed.** Entries
   annotated *"<M>'s gate deletes this entry at close"* are deleted by
   `pnpm milestone close` (M23's survived its own gate by two days when this
   was manual). An entry that says it is *"kept here only for the reasoning"*
   is **scoped**, not placed, and is never auto-deleted.

7. **A retirement pass on any first-read file past 85% of its surface budget**,
   when `pnpm milestone close` lists one — `docs/guidelines/retiring-a-rule.md`.

The *next* milestone's plan opens with a preflight that re-checks this list
(`TODO.md` standing tasks), so a missed flag is caught at the next kickoff.

## Phase 1 — Full single-player product

**Phase gate: Mitchell plans a real upcoming trip end-to-end with the product
and needs no other tool.** Deliberate trade-off (decided 2026-07-07): Phase 1
has zero network effects — validation is personal utility only — in exchange
for collaboration later landing on a product people already want to join.

| # | Name | Scope |
|---|---|---|
| M0 | Walking skeleton | Monorepo, CI, Google auth, event store, one command→event→projection→UI thread, deployed to Vercel |
| M1 | Planning core | Trips, days, activities; drag-to-reschedule; soft-conflict engine (overlaps, impossible geography) |
| M2 | History & time travel | History UI, undo, revert-to-state — proves the event-sourcing bet before stakes rise |
| M3 | Place & time | Map view (MapLibre), timeline view, calendar views; date-anchored events whose anchors produce soft conflicts when dates shift. *(The anchor UI is retired in M8; the domain rules stay — see that file.)* |
| M4 | Money & lenses | Cost items on activities/days/flights with rollup to trip; output lenses: itinerary, daily, full-trip |
| M5 | Design foundations | Tailwind design system: tokens, documented palette, styled primitives and composites, then a re-skin of every existing surface. Answered "is it consistent" — not "is it obvious" (M8) or "is it beautiful" (M10) |
| M6 | Atomic changes | Client/generator-declared command groups committed as one atomic batch, so undo/redo/revert treat them as a single change. Optimistic updates added mid-milestone |
| M7 | Solo delight | Dynamic pages with typed macros, lazily-instantiated templates, a Notebook route outside time-travel, schema-derived constrained AI via Vercel AI Gateway |
| M8 | Make it real | **Done, gate closed 2026-08-08.** Trip lifecycle (name, dates, archive/delete, duplicate — `SetTripName` did not exist before this, PR #21); anchors retired from the UI but kept dormant; Notebook pulled back to plain notes; KI-5 sync indicator. **Interaction design lives here.** *(Core-loop ergonomics — search-to-add, quick add, moving activities — and first-run/empty states trimmed from scope 2026-08-07; see that milestone's file and `TODO.md`'s Candidate ideas.)* |

## Phase 2 — A product worth using

| # | Name | Scope |
|---|---|---|
| M10 | Visual craft pass | **Done, Wave-2 gate closed 2026-08-27.** The "make it beautiful" pass: Home and Trip-plan restyled against the design handoff over two waves (Wave 1 reopened 2026-08-14). Retro and gate evidence: `M10-visual-craft.md` |
| M16 | The assistant answers questions | **Done, gate closed 2026-08-29.** ADR-022. The docked assistant sidebar and a read-only, tool-using agent on its own endpoint, with analytics on which tools an answer calls: `M16-assistant-read-agent.md` |
| M17 | Account preferences | **Done, gate closed 2026-09-11**, 3 of 3 live boxes (box 3 amended out), nine days after it reached production. Preference columns on `users`: name, home airport, distance units at account scope: `M17-account-customization.md` |
| M18 | A stop knows what kind of thing it is | **Done, gate closed 2026-08-29.** A stop gets a `kind` and `tags` (KI-47), one contract change and one migration; tag focus carved out as M18b: `M18-stop-kind.md` |
| M18b | Tag focus | **Done, gate closed 2026-08-30.** SPEC §11's tag focus: off-tag stops dim across Timeline, Day columns, Calendar and Map: `M18b-tag-focus.md` |
| M9 | The assistant cites what it plans | **Gate closed 2026-10-06, 10 of 10, on Mitchell's production attestation** (two artefact boxes ticked by decision; see the retro). Retitled 2026-09-01 (was "AI as a planning partner"): grounding, conversation durability and a replay harness, after Phase 0's assistant kernel (ADR-043). `M9-ai-planning-partner.md`; the audit that retitled it: `docs/reviews/2026-09-01-milestone-audit.md` |

## Phase 3 — Outward

| # | Name | Scope |
|---|---|---|
| M11 | Fork & remix / Sharing and invites | **Done, gate closed 2026-08-28** — 8 of 8. Clone-with-lineage, invites, roles and revocation (absorbed from M13), and pinned share links; playbooks carved out as M11b: `M11-sharing-and-invites.md` |
| M11a | An invite gate on the front door | **Done, gate closed 2026-08-31.** Signup gated by a trip invite, a reusable super code or single-use codes (`invite_codes`); signup opened again 2026-10-03 by ADR-063: `M11a-invite-gate.md` |
| M11b | Playbooks becomes a public library | **Done, gate closed 2026-08-31.** Playbooks becomes a discovery surface: Discover, day, board and profile routes, publishing, and an adds ledger; reviews stayed in M12: `M11b-playbooks-public-library.md` |
| M12 | Reviews and moderation | **Done, gate closed 2026-09-23.** Reviews, ratings everywhere they surface, moderation, and country search beside city search in Discover: `M12-reviews-and-moderation.md` |
| M13 | Collaboration | **Done, gate closed 2026-09-22 — 10 of 10**, merged as `#201` (`99f32d3`), the two-actor walk on Mitchell's attestation. Near-real-time sync, concurrent-edit conflicts as data, per-stop attribution, and notebooks joining the event log: `M13-collaboration.md` |
| M14 | Rich layer | **Gate closed 2026-10-01, 22 of 22** (#222, #223, #226, #221). The Notebook redesign on SPEC §18's widget model, plus saved notebook templates; external calendar sync dropped 2026-09-24: `M14-rich-layer.md` |
| M19 | A cost knows who and what it is for | **Done, gate closed 2026-10-02** (ADR-060). A cost's kind, settled-vs-estimate state, who an activity is for, splits, and the shared-day presentation: `M19-cost-model.md` |
| M20 | An account knows what it may do | **Done, gate closed 2026-09-14** — 32 of 32 live boxes, #174 and #175, migrations 0019/0020. The first commercial milestone: plans as sets of entitlements resolved per request, versioned plan data, time-bounded grants, and the `ai_usage` ledger (ADR-045): `M20-account-tiers-and-entitlements.md` |
| M21 | An account can pay for itself | **Done, gate closed 2026-09-19** — 17 of 17, the last six on Mitchell's attestation. Stripe checkout, a webhook as the sole writer of subscription state, the portal, failed payments and revenue metrics; `free` $0, `plus` $9, `premium` $19 a month: `M21-subscriptions-and-billing.md` |
| M15 | Front door | **Gate closed 2026-08-26, PR #56.** Approved 2026-08-23 (ADR-021); ADR-022 (2026-08-25) placed it after M16, but it in fact **ran ahead of both M10's Phase 9 gate and M16** — decided by Mitchell 2026-08-26, superseding ADR-021/ADR-022's stated ordering (see the reorder note below). The unauthenticated surface the product had never had: landing page, custom Google sign-in and sign-up screens replacing NextAuth's default, and the header account menu (already shipped in M10 Phase 8b). The designed first-run screen was dropped — `NewTripWizard`'s "Create empty" already creates a trip from a name alone. Scope, exit gate and retro: `M15-front-door.md` |
| M22 | An account can build on the API | **Done, gate closed 2026-09-19** — 19 of 19, the preview walk on Mitchell's attestation. A public REST API and account tokens scoped to the account or named trips; `api.tokens` on `premium@v2`; no admin or AI surface: `M22-public-api-and-tokens.md` |
| M25 | A trip is a file you can take with you | **Done, gate closed 2026-09-19.** Trip export and import as `travel-collab/content-bundle/v1`: days and activities only, fresh ids on import, a snapshot rather than the event log; export is free: `M25-a-trip-is-a-file.md` |
| M23 | A playbook can be more than one day | **SHIPPED 2026-09-19** — gate 11/11, #192 merged as `7763913`, migration `0024_saved_day_day_count`. A saved day generalises into a saved sequence: a flat `stops[]` with a per-stop day index, where a gap is an empty day (ADR-048): `M23-multi-day-playbooks.md` |
| M24 | A leg knows where it goes and by what | **Gate closed 2026-09-25, 11 of 11** (#229, #230, #232, #233; carried: `KI-2026-09-25-q`). A travel stop gets a transport `mode` and an optional `endLocation`, and the map draws the real leg: `M24-travel-legs.md` |
| M26 | The build looks like the design again | **Done, gate closed 2026-09-21 — 22 of 22 over two waves.** Design parity with the handoff: Wave 1 the desktop and shared surfaces, Wave 2 the phone: `M26-design-parity.md` |
| M27 | The simplify pass — the invite landing, Cass, actions that look like actions | **Gate closed 2026-09-23, 8 of 8.** SPEC §35's simplify pass: a quieter Home, a trip header that never reflows, the invite landing, Cass the new-trip assistant, proposal cards with Undo: `M27-simplify-pass.md` |
| M28 | Three kinds | **Gate closed 2026-09-26, 9 of 9** (#238, #239); placed by Mitchell 2026-09-25. A stop's kind is `planned`, `pending` or `transit`; `idea` and `hold` fold into `pending`, `booked` into `planned`. Retired kinds are never written and read back as their replacement (ADR-054): `M28-three-kinds.md` |
| M29 | The time river | **Gate closed 2026-10-04, 20 of 20.** SPEC §36.9b, four PRs merged 2026-09-26; ADR-055: `M29-time-river.md` |
| M30 | Notebooks with one job each, and links between them | **Gate closed 2026-10-04, 9 of 9 (one box cut).** Built 2026-09-26. Four seeded notebooks and two id-based link widgets (ADR-056): `M30-notebooks-and-links.md` |
| M31 | We can see what the assistant costs, step by step and tool by tool | **Minted 2026-10-03 and placed after M19; built 2026-10-03 beside M19, not current** (Mitchell: build the ledger now, and defer the eve port until there are users). It is ADR-062's Phase 1: per-step and per-tool rows next to `ai_usage`, cached tokens, per-step pricing, and the `ai-usage` skill's SQL. It closed KI-2026-09-14-b and KI-2026-09-17-c. **Gate closed 2026-10-05, 7 of 7**: a $20/month Gateway budget, and a baseline of two production turns Mitchell accepted in place of a preview live-set run. The port (Phases 2–5) is a candidate: `M31-assistant-ledger.md` |
| M32 | The assistant can say which day is free, in one call | **Gate closed 2026-10-05, 7 of 7** (current for the same day, from M31's close); minted 2026-10-04 from Mitchell's production turn and built beside M31. `find_free_time` ranks every day inside 08:00-22:00 in one call, and each ledger step carries its duration (migration `0037`): `M32-free-day.md` |
| M33 | We can see whether an assistant change works before it ships | **Gate closed 2026-10-05, 6 of 6** (current for the same day, from M32's close); minted and built the same day beside M31 and M32, merged as #327. `pnpm --filter web eval` runs the live set through the unmocked `/ask` handler on production's per-tier models, grades it in code, states its cost and stops at a cap: `M33-evals.md` |
| M34 | Adding a stop suggests what other travellers did nearby | **Gate closed 2026-10-06, 7 of 7**, the walk on Mitchell's production attestation. Current from 2026-10-05 to 2026-10-06. **Minted, scoped and placed 2026-10-05 by Mitchell, after M33.** The add-stop sheet's *"Example match"* placeholder was filed under M9's grounding, but nothing in it needs the model or a place vendor: it lists stops from other people's published days in the day's city, closest first, filtered as you type, and a pick fills name, place, length, kind and tags (not time or cost). Named `nearbyStops` in code, because *suggestion* is ADR-064's word: `M34-nearby-stops.md` |
| M35 | You can say who on a trip is actually going | **Gate closed 2026-10-06, 12 of 12**: the migration confirmed from the run log, the eval re-run on Mitchell's word. Current for part of 2026-10-06, by M36's gate closing. **Minted 2026-10-05 by Mitchell, built before minting.** Built off-milestone on PR #335 while M34 is current, from an approved spec and plan; see the 2026-10-05 note below. Travelling is a per-person Access attribute counted at read time (ADR-065), so per-person costs, balances and "N travellers" count travellers, not members, and a suggester who joins to advise no longer doubles a total. Trip settings → People replaces the Travelers panel, with an owner state, role change in place and realtime access. Migration `0039`: `M35-travellers-and-people.md` |
| M36 | The operator console is four tabs, and an account has a page | **Gate closed 2026-10-06, 13 of 13**, the walks on Mitchell's attestation. The console redrawn as Financial · Users · Library · AI models, and an account gets a page: `M36-operator-console.md` |
| M37 | A trip looks like somewhere before it has a plan | **Gate closed 2026-10-07, 11 of 11**, as #350 → #354. Current from 2026-10-06, by M35's gate closing. **Proposed and scoped 2026-10-06**; all six decisions answered as recommended. From `docs/candidates.md`; see *2026-10-06 — proposed: M37 to M47*. Home trip cards with a designed empty state, Unsplash covers, trip length: `M37-trips-look-like-somewhere.md` |
| M38 | You can tell people apart, and see a trip before you join it | **Gate closed 2026-10-08, 8 of 8**, as #356 → #360. Current from 2026-10-07, by M37's gate closing. **Proposed 2026-10-06, scoped 2026-10-07**: all six decisions answered as recommended. From `docs/candidates.md`; see *2026-10-06 — proposed: M37 to M47*. Avatars, colours and display names on every person surface; the invite page built from notebook widgets: `M38-people-you-can-tell-apart.md` |
| M39 | The phone layout is decided once, and Caesura installs like an app | **Gate closed 2026-10-09, 8 of 8.** The phone/tablet design critique and its KIs, the phone conflict state, PWA install tiers 1–2: `M39-the-phone-is-decided.md` |
| M40 | A big change is reviewed whole, taken whole, and undone whole | **Gate closed 2026-10-10, 8 of 8.** Accept all as one batch, named snapshots, assistant planning turns write suggestions (ADR-067): `M40-a-big-change-is-one-change.md` |
| M41 | Moving and adding stops takes one gesture wherever you are | **Closed 2026-10-11, gate 13 of 13.** **Proposed 2026-10-06, scoped 2026-10-10** by Mitchell in session, and re-framed: the 2026-10-06 recommendations predated the time river and the Calendar redesign. Fewer controls and more direct gestures: Calendar city-block drag that can grow the trip, the editor's Day field moves any stop, a drawer of just cards, Plan day drag, Option-drag copy, top-edge resize, paste-to-add, parked-stop origin, and a ⌘K palette that runs the page's own actions (ADR-068). Quick-add, search-to-add and optimistic Duplicate/Restore were cut back to candidates. `M41-planning-without-friction.md` |
| M42 | The front door shows more than one trip, and what it costs | **Closed 2026-10-12, gate 14 of 14.** **Scoped 2026-10-11 with Mitchell: decisions 1–11 answered**, and widened with richer activity tags (ADR-070). Plan `docs/plans/2026-10-11-M42-front-door-and-tags.md` (deleted at close; in git history). `/demo/<slug>` picker, landing pricing, the SEO pass's leftovers, thirteen tags, trip descriptions, tag pages, tag widgets: `M42-the-front-door-shows-more.md` |
| M43 | A trip's notebooks keep up with their templates | **Closed 2026-11-01, gate 6 of 6.** The Overview's identity in the database, the derived Overview title, and the `open` widget's design and filters: `M43-notebooks-keep-up.md` |
| M44 | A stop knows what was booked, and what it sits inside | **Proposed 2026-10-06, not scoped. Moved last 2026-10-12**, after M43, by Mitchell: nothing it fixes is hurting today. (This row said *"scoped 2026-10-07: all six decisions answered as recommended"* until 2026-10-10. That was a bulk edit; the milestone file never recorded an answer.) From `docs/candidates.md`; see *2026-10-06 — proposed: M37 to M47*. `booking` on the activity contract, the containment rule in `conflicts.ts`: `M44-a-stop-knows-what-was-booked.md` |
| M45 | The assistant answers about all your trips, and can take you places | **Closed 2026-10-13, gate 12 of 12**, on part 0, PR 420; both [walk] boxes ticked on Mitchell's word, and the ledger box without a production `ask.playbook` row, which he accepted. **Scoped 2026-10-12 with Mitchell: D1–D9 answered**, re-based on M41's ⌘K palette (ADR-072). Proposed 2026-10-06 from `docs/candidates.md`; see *2026-10-06 — proposed: M37 to M47*. Four deterministic cross-trip tools on an account-scoped ask, navigation by running palette commands, edit mode only after Approve, Home's rail and ⌘K's *Ask:*, the playbook assistant (PRs 421, 422, 424–427, 429). No migrations: `M45-the-assistant-beyond-one-trip.md` |
| M46 | A trip has a conversation, with the people taking it | **Closed 2026-10-17, gate 10 of 10**, on part 0, PR 472; the [walk] box ticked on Mitchell's word. **Scoped 2026-10-13**: all six decisions and the layout answered by Mitchell (ADR-073; six parts, PRs 433-447; the plan is deleted). (This row said *"scoped 2026-10-07"* until 2026-10-10 from a bulk edit; the 2026-10-13 answers are the real ones.) From `docs/candidates.md`; see *2026-10-06 — proposed: M37 to M47*. Trip chat, its own store, unread counts, moderation: `M46-a-trip-has-a-conversation.md` |
| M47 | The operator console shows tiers over time, and paid flows can be tested in production | **Proposed 2026-10-06, scoped 2026-10-17**: all four decisions answered by Mitchell (ADR-076, amending ADR-047; plan `docs/plans/2026-10-17-M47-the-business-over-time.md`, four parts). (This row said *"scoped 2026-10-07: all six decisions answered as recommended"* until 2026-10-10 from a bulk edit; the 2026-10-17 answers are the real ones.) From `docs/candidates.md`; see *2026-10-06 — proposed: M37 to M47*. Weekly tier rollup and chart; Stripe `livemode` beside live: `M47-the-business-over-time.md` |
| M48 | A planned trip starts from trips that already exist | **Proposed 2026-10-11; serving code merged 2026-10-16** off the row order, with Mitchell's approval (`docs/STATUS.md`), behind a flag, **on in production from 2026-10-17** to gather flag-on numbers: PRs 459-467, migration `0054`, pgvector in Neon (ADR-075). **Current since 2026-10-18**, when M47's gate closed; what is left is the gate's evidence and the ledger box. From a PM brief (Sunny), on Mitchell's ask; see *2026-10-11 — proposed: M48*. A `plan` turn adapts example days Caesura already holds instead of inventing them, measured in dollars per plan turn. Decisions and the remaining gate boxes: `M48-plans-start-from-examples.md` |
| M49 | A cover can come from anywhere, and be framed where you want it | **Closed 2026-10-25, gate 9 of 9** (part 0 PR 581). A trip's cover set from any image URL on the public API, and its crop repositioned by API and by drag (ADR-081): `M49-covers-from-anywhere.md` |
| M50 | A stranger can find a day, make it their trip, and bring people in | **Closed 2026-10-19, gate 11 of 11**, on part 0, PR 493. **Proposed and scoped 2026-10-19 with Mitchell**, ahead of M48 (parked) and M49. From his go-to-market plan; see *2026-10-19 — minted: M50, M48 parked*. Copy fixes, first-touch `?ref=` attribution (ADR-079, migration `0060`), place-page JSON-LD, one step from a playbook day to a new trip, an editorial landing and empty states, publishing a lived trip, the referral nudge; eight parts (the plan is deleted): `M50-strangers-find-a-day.md` |
| M51 | The front door tells the story | **Closed 2026-10-22, gate 11 of 11**, on Mitchell's ruling, with KI-2026-10-22-a and KI-2026-10-20-c left open. The landing as a sea of the library's public days, a pricing ladder, names on stops, a day picker: `M51-the-front-door-tells-the-story.md` |
| M52 | The trip comes with you: a notebook for today, and an assistant the group can ask | **Closed 2026-10-24, gate 13 of 13**, the [walk] on Mitchell's word. From 3 days before a trip its Overview swaps to a *During the trip* notebook with a Today scope, and the group chat can `@assistant`: `M52-the-trip-comes-with-you.md` |
| M53 | A search engine reads every public page the way a person does | **Proposed 2026-10-25 by Mitchell, not scoped; placed last, after M44, until he places it.** From an SEO audit of production (282 sitemap URLs fetched); see *2026-10-25 — minted: M53, the SEO audit's findings*. Four duplicate day pairs, demo trips with no server-rendered content, titles and descriptions over length, missing canonicals on `/developers`, raw tag labels, `BreadcrumbList` and `ItemList` JSON-LD, `lastmod` on place and tag entries, and the landing's 923 KB of HTML. Seven open decisions, each with a recommendation: `M53-search-reads-every-public-page.md` |
| M54 | The motion pass: press, pending, enter and exit, everywhere | **Closed 2026-10-27, gate 13 of 13** (part 0 PR 593). Scoped 2026-10-26 with Mitchell, placed ahead of M43. From the motion pass design (`docs/specs/2026-10-25-motion-pass-design.md`, approved 2026-10-25); see *2026-10-26 — minted and placed: M54, the motion pass*. Motion tokens, button press and a width-keeping `pending` with the dots, overlay enter and exit, sliding tab indicators, skeleton routes and view-transition cross-fades, the welcome moment after sign-in and on PWA launch, one avatar stack, chat and Ask motion, and the small moments. ADR-082; eight parts, run as an unattended stack: `M54-the-motion-pass.md` |
| M55 | Claude connects to Caesura as you, and can publish what it plans | **Closed 2026-10-28, gate 17 of 17** (part 0 PR 613). A remote MCP server at `/api/mcp` behind our own OAuth 2.1 server, every API secret on HMAC-SHA256, Connected apps (ADR-083): `M55-claude-connects-as-you.md` |
| M56 | New trip is a picker, and the assistant never strands you | **Closed 2026-10-30, gate 17 of 17.** New trip as five picker pages and Review, world place search, and the assistant's `ask_user`, `show_options` and `hand_off` (ADR-084): `M56-new-trip-is-a-picker.md` |
| M57 | The assistant is a graph of personas, and you can watch it work | **Minted, scoped and placed ahead of M44 2026-11-01 by Mitchell; current.** From the candidate and its design (`docs/specs/2026-10-30-assistant-personas-design.md`); see *2026-11-01 — minted and placed: M57*. Six personas in a typed graph with a reachability baseline, persona and outcome columns in the ledger, `switch_persona` once a turn, the trip planner split, and an operator Debug mode in the Ask panel plus a Personas tab in the console (ADR-085): `M57-assistant-personas.md` |

*A closed milestone's row is its gate, one line and its file. The longer rows
they carried until 2026-11-01 are verbatim in `decisions-archive.md`, under
"Moved out of README.md on 2026-11-01".*

- **Restructure (2026-07-28), from the Phase 1 gate review.** The gate had not
  been met and the reason was structural, not cosmetic: a trip cannot be renamed
  or deleted. **M8 "Make it real"** was inserted to close that floor, **M9 "AI as
  a planning partner"** and **M10 "Visual craft pass"** were added, and
  **Fork & remix moved ahead of Collaboration** — the wanted "social" feature is
  cloning and sharing, which needs no realtime transport, while Collaboration is
  the biggest remaining architectural lift. Renumbering:

  | was | is now |
  |---|---|
  | M8 Collaboration | **M13** |
  | M9 Fork & lineage | **M11** (Fork & remix) |
  | M10 Community | **M12** |
  | M11 Rich layer | **M14** |

  Forward pointers were updated in the ADRs, the foundation spec, the
  guidelines, and `known-issues.md` in the same change. **Closed milestone files
  and closed per-milestone design specs were deliberately NOT rewritten** — they
  were true when written, and this table is how to read them.

Placement notes (decided 2026-07-07):
- The notes page appears twice on purpose: basic solo notes in M7; embeds and
  community objects in M11.
- Internal calendar UX (drag, holiday anchors) is M3; *external* calendar sync
  is M11 — the original vision bundled these, they are different features.
  *(External calendar sync later moved to M14 and was **dropped** 2026-09-24.)*
- M2 precedes M3–M7 deliberately: prove history/revert works before investing
  in breadth on top of it.
- **Renumbering (2026-07-10):** M5 "Atomic changes" was inserted before Solo
  delight; milestones formerly M5–M9 shifted +1. Forward milestone-pointers in
  the ADRs, foundation spec, and guidelines were updated to match in the same
  change.
- **Renumbering (2026-07-11):** M5 "Design foundations" was inserted after
  Money & lenses (decided by Mitchell mid-M4: base functionality first, then a
  design-system pass before further UI breadth, so the polished single-player
  baseline can guide collaboration UX). Milestones formerly M5–M10 shifted +1
  (Atomic changes is now M6, …, Rich layer M11). Phase 1 is now M0–M7. Forward
  milestone-pointers updated to match in the same change.

- **Design sync (2026-08-23).** The design bundle is now committed in-repo at
  `.design-sync/handoff/` — `design/Trip Planner Redesign.dc.html` (3,524 lines),
  `SPEC.md`, `DRIFT.md`, a Japan seed export. It is the **only readable source of
  truth**: generations 1–3 (1,412 / 2,048 / 2,623) lived at a `~/Downloads` path
  no session can reach, so generation-diffing is over — reconcile design against
  *code*, using `apps/web/src/lib/preview-registry.ts` as the spine for "not
  built yet", the way `DRIFT.md` does.

  The sync brings net-new surfaces (landing page, sign-in/sign-up, first-run,
  account menu, a full Notebook redesign) and renames the product to **Caesura**.
  Full reconciliation, the drift questions, and the per-item routing:
  `docs/design-feedback/2026-08-23-design-sync-review.md`. Headline routing —
  **M15** takes landing/auth/first-run/account menu; **M14** takes the Notebook
  redesign and the repeaters ADR; **M11** takes the landing page's "Look around a
  real trip" CTA; `TripSummary.startDate` is its own reviewed contract step.

  **Decided 2026-08-23.** M15 is approved and executes after M10's gate, before
  M9 (**ADR-021**). Two additions to M10's gate are approved and recorded in
  `M10-visual-craft.md`: **Phase 8b** (five presentational items — the Caesura
  rename, a working sign out, a three-state save indicator, the sync-failure
  banner, calendar month blocks) and **Phase 1b** (the header adopts `SPEC.md`
  §1's focus-scope model, as an explicit revisit of the merged Phase 1). Three
  questions stay open — start-only trip dates, first-run vs. the four-step
  wizard, and whether the landing copy may sell M11/M12 — see the review's §8.

Current milestone: M44 — A stop knows what was booked, and what it sits inside

### Archived decision notes

Moved to `docs/milestones/decisions-archive.md` on 2026-09-21, verbatim and
in order — every note whose milestones have all closed their gates. The
2026-09-30 retirement pass (`docs/guidelines/retiring-a-rule.md`) moved two more
notes, the Current-milestone placement paragraphs from M26 to M28, and four
superseded reorder notes from under the Phase 3 table. The 2026-10-11 pass,
listed by M41's close at 88% of this file's budget, moved eight more notes and
the placement paragraphs from M14 to M34. The 2026-11-01 pass, listed by M43's
close at 89%, moved six more notes and the long table rows of closed
milestones. They are the argument, not the live instruction, and they were 56%
of this file.

- **2026-08-30** — M17 is jumped; M11a and M11b run first
- **2026-09-01** — milestone audit
- **2026-09-01** — reorder: M9 moves from last to second, by Mitchell's decision
- **2026-09-01** — minted and placed: M20 and M21, the first commercial milestones
- **2026-09-10** — M9 opens with Phase 0, the assistant kernel
- **2026-09-11** — M17's gate closed nine days late, and the queue drifted while it was open
- **2026-09-13** — reorder: M20 and M21 run next, ahead of M9's remaining work
- **2026-09-16** — reordered: M22 runs AHEAD of M21, which pauses at 11/17
- **2026-09-16** — placed: M22, a public API and scoped account tokens
- **2026-09-18** — three milestones minted, M13 moved ahead of M12, two prerequisites placed
- **2026-09-18** — Current milestone moves to M25; M22 pauses at 18/19
- **2026-09-19** — M21's and M22's gates closed, on Mitchell's attestation
- **2026-09-19** — M23's gate closed, shipped, and the migration applied
- **2026-09-19** — M25's gate closed, and what it leaves the milestones behind it
- **2026-09-19 (later)** — minted, scoped and placed: M26, design parity
- **2026-10-05** — minted: M35, built before it was minted
- **2026-10-06** — minted and placed: M36, the operator console, started ahead of M34's close
- **2026-10-06** — M34, M9 and M36 closed on Mitchell's production word; M29 and M30 get their rows; TODO.md trimmed
- **2026-10-06** — M35 closed; M37 is current
- **2026-10-20** — minted: M51, ahead of M49
- **2026-10-22** — minted: M52, the trip comes with you
- **2026-10-26** — minted and placed: M54, the motion pass
- **2026-10-27** — minted: M55, a connector Claude signs in to
- **2026-10-27** — placed: M55 ahead of M43
- **2026-10-30** — minted and placed: M56, New trip as a picker
- **2026-08-08, 2026-08-14, 2026-08-25, 2026-08-26** — the superseded reorders and M10's reopened gate, and the placement paragraphs for M26 to M28: *Moved out of README.md on 2026-09-30*, at the end
- **Current-milestone placements, M14 to M34**: *Moved out of README.md on 2026-10-11*, at the end
- **Table rows for closed milestones**, as they stood before the 2026-11-01 pass: *Moved out of README.md on 2026-11-01*, at the end

### 2026-11-01 — minted and placed: M57, assistant personas

**Asked 2026-11-01.** Shown the open milestones and the candidates, Mitchell: *"Let's take on #3,
'Strategic for the assistant: personas'. Remember that as part of this I want to be able to
visualize how the agent performed through its personas in like a debug mode so I can see how well
it's working. It should be possible to see the state tree from a page and the tools available,
then break down after agent run how it did."* **M57 is minted, scoped the same session (D1–D8,
ADR-085) and placed ahead of M44, so it is current.** Order: M57 → M44 → M53, with M48 parked.

### 2026-10-25 — minted: M53, the SEO audit's findings

**Asked 2026-10-25.** An SEO audit of `caesura.today` (every sitemap URL fetched, plus the
metadata, sitemap and robots code) scored the site at about 82/100. Mitchell: *"Create a new
milestone listing all these issues to fix as one big milestone."* **M53 is minted, not scoped**,
and placed **last**, after M44, since he named no place for it. M43 stays current (M49 closed the same day). The
findings and seven recommended decisions are in `M53-search-reads-every-public-page.md`. Order:
M43 → M44 → M53, with M48 parked.

### 2026-10-19 — minted: M50, M48 parked

**Asked 2026-10-19.** Mitchell brought a go-to-market plan and asked for its buildable parts as
*"the next milestone"*. **M50 is minted and current**; it is scoped the same day (ten decisions
answered, four settled on the recommendation; `M50-strangers-find-a-day.md`). **M48 is parked,
not closed**: its open boxes wait on plan-turn traffic, which M50's launch is meant to bring; it
resumes after M50, with its no-traffic items first. Order: M50 → M48 → M49 → M43 → M44.

### 2026-10-12 — reordered and minted: M43 and M44 go last; M49, covers from anywhere

**Asked 2026-10-12**, after M42's close made M43 current. Shown what M43 and M44 would build,
Mitchell: *"Neither are impacting anything today. so lets not do that work right now. Lets
re-order them to the end"*. Their rows moved below M48 in `TODO.md`, so **M45 is current**. It is
not scoped either, and its decisions need answering before any part is built.

**M49 is minted** from the same conversation: *"Allowing the api to set a header image so i can
use the api to find and add images to trips in the future."* Covers already existed (M37), but
only from Unsplash and only from the app. The public API marks the cover routes `PLANNED`.
Answered the same day:
- **Any image URL**, not only Unsplash, and **referenced, not uploaded and stored**.
- **Placed after M48, ahead of M43 and M44.**
- **It absorbs *Reposition a cover***, in the API and as a drag on the band for Unsplash covers.

Order now: `… M42 ✓ → M45 → M46 → M47 → M48 → M49 → M43 → M44`.

### 2026-10-11 — proposed: M48, retrieval for plan turns

**Asked 2026-10-11:** *"Add as a upcoming milestone this new feature … its a starting point to
validate the proposal, not the final product"*, with a product brief by Sunny (PM). M48 is
proposed and placed after M47 in `TODO.md`. **It is not scoped.** The milestone commits to
the feature, not to the brief's technical design: the brief's author could not read the code, and
Mitchell said the same day *"focus on the feature, we can change the technical decisions"*.

**Why last.** It saves money per plan turn, so it pays in proportion to plan-turn volume, and
that follows users (2026-10-03). **Why that may not hold:** its baseline and its first two gates
are offline scripts. They can run beside any milestone, and they decide whether the rest is built
at all. Moving it up is moving its row.

**What happened instead (2026-10-16).** The serving code was built and merged ahead of the
row, behind a flag that is off, on Mitchell's approval (recorded in `docs/STATUS.md`). The row did
not move. Which gates have run and what is still open is in M48's own file, not here.

### 2026-10-06 — proposed: M37 to M47, from the candidates file

**Asked 2026-10-06:** *"Go through the suggested new features, categorize them into similar
features, and lets build out our next new milestones since we are getting close to done with
current"*. M35 is at 8 of 12 and is the last unticked row. These eleven milestones are proposed
and placed after it in `TODO.md`, in the order below.
**Confirmed the same day:** *"Order is good"*, and M37's six decisions were answered as
recommended, so **M37 is scoped**. **The rest are not scoped**: each file lists the decisions it needs, with a recommendation for
each, and none of those decisions has been answered. A milestone is scoped when its decisions
are. Until then its gate can change freely, and the order can too, by moving rows.

The 42 unplaced candidates were grouped by what they would change for a user:

| Group | Milestone | Candidates |
|---|---|---|
| First impression of a trip | M37 | home cards, Unsplash photos, trip length |
| People and joining | M38 | avatars and personas, invite page from widgets |
| The phone | M39 | design critique (5 KIs), PWA tiers 1–2, phone conflict state |
| Reviewing big changes | M40 | Accept all as one batch, named snapshots, assistant proposes via suggestions |
| Board ergonomics | M41 | Calendar drag, M8 C/D trim, unscheduled add, parked origin, optimistic duplicate |
| Signed-out visitors | M42 | demo picker, landing pricing, SEO leftovers, tag pages, trip descriptions |
| Seeded notebooks | M43 | Overview identity, Overview title, `open` shape, `open` filters (reset/back-fill already built) |
| The activity contract | M44 | booking fields, contained activities |
| Assistant reach | M45 | account-wide assistant, navigation, UI-action approval |
| Talking on a trip | M46 | trip chat |
| Billing truth | M47 | tier history, Stripe test mode |

**Why this order.** Mitchell wants users before increasing AI cost (2026-10-03), so the work a
new user sees comes first: the home page (M37), the people on a trip (M38), the phone (M39). M40
is next because it reuses the suggestions machinery while it is fresh, and it makes the
assistant's large changes safe. The polish milestones (M41–M44) follow. New AI traffic (M45), the
largest new surface (M46), and billing work that pays off only with paying users (M47) come last.

**Left unplaced (nine), and why.** The eve port and user memory stay deferred behind ADR-062's
triggers. The architecture map and the cloud e2e browser match are repo automation, not product
work. `/ask` surviving a throw is a KI-sized fix for M9's carried cluster. The fourth-plan proof
is a note, not work. The model-comparison harness should follow evidence from M33's evals rather
than lead. The save-light popover and the design-sync items (History beyond the popover,
`MapRail`, auth error states) need design first.

**Housekeeping in the same commit.** The PLACED→M24 entry and *Transport mode per leg* were
deleted from `docs/candidates.md`. M24's gate closed on 2026-09-25 and should have deleted them,
but the first entry's deletion sentence was missed, and the second never said a gate deletes it.
