# M45 — The assistant answers about all your trips, and can take you places

**Status:** **Proposed 2026-10-06; current from 2026-10-12, when M43 and M44 moved last. Scoped
2026-10-12**: every decision below was answered by Mitchell that day. Minted from
`docs/candidates.md` (see `docs/milestones/README.md`, *2026-10-06 — proposed: M37 to M47*). It
was placed late because Mitchell wanted users before more AI cost (2026-10-03).

**Gate close prepared 2026-10-13 on part 0 (PR 420): 9 of 12 boxes ticked.** Every planned part
is merged (`main` at `940df19`); PR 429, the trip-name fix the live eval found, is open. The two
**[walk]** boxes wait for Mitchell's walk on prod, and the ledger box waits for the first
production turns on the new surfaces, which that walk makes.

**It was written before M41 built the ⌘K palette** (ADR-068, ADR-069), and scoping re-based it
on that work at Mitchell's ask: *"it predates our command-k command pallet, so lets make sure this
new milestone knows about that work and uses it"*. The assistant moves you around by running the
palette's own commands, and the palette hands unmatched text to the assistant. ADR-072 records
both.

## Why this exists

The assistant lives inside one trip (ADR-022, ADR-033). Three asks reach past that.

- **Across trips.** 2026-10-04: *"Account wide AI assistant, be able to ask about what kind of
  trips they have taken overall"*. The examples were the most expensive meal, how many countries,
  the city visited most, and a suggestion for the next country.
- **Navigation.** 2026-10-04: *"give the AI agent the ability to move around the website, go to
  notebooks, change to map view, etc"*. The entry notes this is cheap once the account-wide
  assistant exists, because that assistant has no page of its own to start on.
- **Changing app state, with approval.** 2026-09-04: a tool to turn on a notebook's edit mode,
  with *"a approve/deny button in the assistant to take that action"*. The approve and deny half
  exists already. What is new is a proposal that holds a UI action rather than domain commands.

Navigation and UI actions are the same new class: a proposal or reply that changes **client
state**. It cannot be replayed from the log, has no `actor_id`, and cannot be undone. Defining it
once, in one ADR, is the reason these three asks share a milestone.

Candidates absorbed (each deleted by this gate):
- *An account-wide assistant that answers about every trip you have taken* (2026-10-04)
- *The assistant can move around the site* (2026-10-04)
- *The assistant asks to change the app's own state, and you approve it* (2026-09-04)

## Decisions (answered by Mitchell, 2026-10-12)

1. **Aggregates are computed by deterministic tools, not by the model reading trip dumps**:
   `spend_by_category`, `places_visited`, `visit_counts` and `suggest_next_country`. They are
   cheaper, correct, and testable without a model. The M32 free-day tool is the precedent.
   *As recommended.*
2. **Which trips count:** trips where the user is travelling (ADR-065), not every trip they can
   open. Invariant 7 still holds, so nothing is read that the user could not open. *As recommended.*
3. **Country and city come from geocoded places, with the stop's city as the fallback.** A stop
   with neither is counted as unknown and never guessed. *Suggest the next country* subtracts the
   visited set from a static list. That list is the only new data. *As recommended.*
4. **A client action is a ⌘K palette command, not a new union.** *Replaces the recommended
   `ClientAction` union.* A reply names a palette command by id (`view:Map`, `go:day:<id>`,
   `go:stop:<id>`, `people`, `go:trip:<id>`), and the client runs that command's own `run`, the
   function the palette would call (ADR-068 §1). The two that did not exist are added **to the
   palette first**, so a person can use them from ⌘K too: *Go to › Notebook › <name>* and
   *Edit › Notebook › Turn editing on/off*. A reply that names a command the page does not offer
   does nothing, and says so. A URL in a reply never navigates.
5. **Navigation runs; a change asks.** A *Go to* command runs when the reply arrives. A command
   that changes state (notebook edit mode) waits for Approve on the proposal card. Neither leaves a
   page that has unsaved input.
6. **⌘K hands unmatched text to the assistant.** When nothing matches, the palette's last row is
   *Ask: <text>*, which opens the assistant with it, on Home and inside a trip. This amends
   ADR-068 §5 (*"the palette does not talk to the model in v1"*); ADR-072 records the amendment.
7. **Home has an always-visible assistant rail**, docked like the trip page's, answering across
   your trips. *Chosen over the recommended panel opened from ⌘K.*
   *Refined 2026-10-12 by Mitchell, on PR 426:* the rail docks from **1100px**, the trip
   board's threshold. Between phone width and 1100px, an **Ask** button in Home's head opens it.
   This bends SPEC §35.2 (*"New trip, and nothing else"*). `.design-sync/handoff/SPEC.md` is a
   build input, so the amendment rides a code PR (part 5), not part 0. ⌘K's *Ask:* row is
   **hidden for users without assistant access**.
   *Reversed 2026-10-12 by Mitchell, on PR 426's preview:* "There should be a way to collapse or
   hide the assistant and it starts closed." Home's rail now works like the trip board's
   (`useAssistantVisibility`). It is **closed by default at every width**. The head's Ask button
   opens it, docked from 1100px and as a sheet below that, and Hide closes it. The phone tab
   bar's Ask pill is tinted only while its sheet is open.
8. **No memory.** *User memory* stays deferred with the eve port (ADR-062). *As recommended.*
9. **The playbook pages get an assistant too** (added by Mitchell 2026-10-12, after parts 1–3
   merged). Every playbook surface gets it: a playbook day, a playbook, Discover, and the city
   and tag pages. Each sees **exactly what is on that page**: no extra logic and no tool the page
   has no use for (no free-day, no stop edits). It answers about the playbook itself, and it can
   **add the playbook to a trip on a day, or start a trip with it**. Those two replace the
   page's own buttons and run the same commands, after Approve. The person names the trip and
   day. The assistant never goes looking for "a trip with room". Only signed-in users on a plan
   with assistant access see it. It is **opened on demand**, like the trip page's rail, not
   always showing like Home's.
   *Answered 2026-10-13 by Mitchell, on PR 427 (part 5):*
   1. no assistant on the country pages, which are SEO pages;
   2. the floating rail on desktop is approved;
   3. **send the plan with the page**: entitlements are resolved on the server in the `(app)`
      layout and passed down, so Ask renders on first paint with no fetch and no flash, from one
      source for the trip board and the playbook pages. It is not a JWT claim (ADR-045 rule 2
      stands). Built in PR 427's fix round 1 (`26af38b`, e2e `47c401b`). **It holds from the `md`
      width up, not on a phone** (KI-2026-10-13-a; see the note under the exit gate).

## Scope

- An always-visible assistant rail on Home with the cross-trip read tools.
- The palette's notebook commands, a way to run a command by id, and *Go to › Trip* landing on a
  chosen view.
- ADR-072, the navigation tools that name palette commands, and the edit-mode proposal.
- *Ask: …* as the palette's last row when nothing matches.
- Usage recorded in the M31 ledger under its own surface, and cases added to the M33 eval suite.

## Out of scope

- The eve port and user memory, which stay deferred (ADR-062 § *Deferred: the port*).
- Writes across trips. This assistant reads across trips and writes within one.

## Exit gate

*Read 2026-10-13 for the close, on part 0 (PR 420) with `main` at `940df19` merged in. CI on each
part is the run on that PR's last head, read with `gh api …/commits/<sha>/check-runs`. Every
job in it passed, both e2e shards included:*

| PR | Part | Head | CI run | Merged as |
|---|---|---|---|---|
| PR 422 | 1, palette notebooks and run-by-id | `d98fd1e` | 38266060522 | `bc2b587` |
| PR 421 | 3, account ask and cross-trip tools | `8c4b228` | 38267531824 | `d34abe5` |
| PR 424 | 2, the assistant names palette commands | `58d4faf` | 38281860701 | `f2cf10c` |
| PR 425 | fix for KI-2026-10-12-e | `cfa44b8` | 38310183185 | `c0e0bf4` |
| PR 426 | 4, Home's rail and ⌘K *Ask:* | `7544a9a` | 38322422098 | `204c9dd` |
| PR 427 | 5, the playbook assistant | `408f7e0` | 38337996066 | `940df19` |
| PR 429 | 6, the trip-name matcher (from the live eval) | `87c01b0` | 38345410945 (all 14 checks green) | `8143772` |

- [x] **Decisions 1–9 are answered and recorded here**, and ADR-072 is written, amending
      ADR-068 §5. *Ticked 2026-10-13: D1–D8 above (2026-10-12), D9 added `f72043db`, D7's
      refinement and reversal `92ce602d` and `b426862a`, and Mitchell's part 5 answers under D9
      (this close). `docs/architecture/ADR-072-the-assistant-runs-palette-commands.md` is
      Accepted 2026-10-12; `docs/architecture/ADR-068-one-way-to-do-each-thing-the-palette-runs-the-pages-actions.md:47`
      carries the amendment note on §5.*
- [x] **Each aggregate tool is unit-tested over a fixture of several trips, each test seen red**,
      including a trip the user is not travelling on, which must be excluded. *Ticked 2026-10-13:
      PR 421 (`d34abe5`). `packages/domain/test/acrossTrips.test.ts`: the fixture's Paris trip has
      the user as an editor with `travelling: false` (`:7`, `:117`); `travelledTrips` `:140`,
      `spendByCategory` `:146`, `placesVisited` `:184`, `visitCounts` `:203` and `:217`,
      `suggestNextCountry` `:286`. Seen red twice, per PR 421's red-first table: before
      `acrossTrips.ts` existed (`TypeError: travelledTrips is not a function`), and with the
      travelling filter replaced by "any member" (6 failed, e.g. `expected { tripsCounted: 4, …(1) }
      to deeply equal { tripsCounted: 3, …(1) }`). The tool layer is
      `apps/web/src/server/assistant/tools/acrossTrips.test.ts:75` (the trips read once a turn) and
      `:89`. CI run 38267531824.*
- [x] **The four example questions are answered correctly** in the eval suite (M33). The run's
      numbers are pasted here. *Ticked 2026-10-13 on the live eval at `main` `940df19`, run with
      Mitchell's go-ahead: `EVAL_CONFIRM=1 EVAL_MAX_USD=3 pnpm --filter web eval`, 2026-10-13
      03:20–03:23 UTC, the whole live set.*
      - **29 of 29 cases run, 28 PASS, 1 FAIL; 183 checks, 1 failed.** $0.3795 priced of the
        $3.00 cap, plus one unpriced Opus turn (`c-remove`, about $0.09 scaled from the other Opus
        turn, so about $0.47 in all).
      - **The four account cases all PASS**, one tool call each, on Haiku 5.5:
        `a-most-expensive-meal` (`spend_by_category`, 3.4 s, $0.0004), `a-countries-count`
        (`places_visited`, 5.0 s, $0.0002), `a-city-most` (`visit_counts`, 3.4 s, $0.0002),
        `a-next-country` (`suggest_next_country`, 3.6 s, $0.0004). $0.0012 for the four, about
        $0.0003 a turn, the same as the run at `d34abe5`.
      - The playbook surface: `p-day-covers` PASS (Sonnet, $0.0084). **`p-add-to-trip` FAIL**
        (`✗ proposes a change: 0 commands`): the model passed the trip as "Kyoto trip", the
        account's trip is "Kyoto", and `tripsCalled` (`apps/web/src/server/assistant/tools/navigate.ts:177-181`
        at `940df19`) matched only a name containing the typed text. PR 429 fixes the matcher and
        adds two live cases, `a-open-trip` and `p-start-trip`. **Neither has been run live**, and
        `p-add-to-trip` has not been re-run since the fix.
      - **Re-run at `87c01b0` (PR 429's final head):** `p-add-to-trip`, `a-open-trip` and
        `p-start-trip`, 3/3 PASS, 26/26 checks, about $0.01.
      - Trip surface: 23 turns, all PASS, about $0.0168 a priced turn.
      - The earlier runs at `d34abe5` (2026-10-12): run 1 stopped at the $0.10 cap after 4 of 27
        trip turns, all PASS, $0.1874, and surfaced KI-2026-10-12-e (fixed in PR 425); run 2, the
        four account cases alone, 4/4 PASS, 36/36 checks, $0.0012.
- [x] **A navigation reply runs the palette command it names and changes the view the user
      sees; a command the page does not offer, or a URL, does nothing.** A test asserts the run is
      the palette command's own function (ADR-068 §2), and one is seen red with free URLs allowed.
      *Ticked 2026-10-13: PR 424 (`f2cf10c`). `apps/web/src/components/assistant/runPaletteCommands.test.ts:21`
      (runs the registered command's own `run`, once) and `:31` (an id the page does not offer:
      says so and runs nothing). `apps/web/src/lib/apiClient.test.ts:1096` and `:1118` drop any id
      the assistant may not name, URLs included; seen red with `isAssistantCommandId` returning
      `id !== ""`, printing a diff that adds `"https://example.com/phish"`.
      `apps/web/src/server/assistant/tools/navigate.test.ts:41` refuses nine ids, `https://…`
      among them (9 red with the buffer's allowlist check removed). The view changes in
      `apps/web/e2e/m16-assistant.spec.ts:142` (lands on `?view=Map` with the Map tab selected),
      and from Home in `apps/web/e2e/m45-home-assistant.spec.ts:39`. CI runs 38281860701 and
      38322422098.*
- [x] **⌘K's *Go to › Notebook* and *Edit › Notebook* work by hand**, and text that matches no
      command offers *Ask: …*, which opens the assistant with it. *Ticked 2026-10-13 on e2e that
      drives the keyboard in a real browser; no person has walked these two commands on a
      preview. `apps/web/e2e/m41-command-palette.spec.ts:145` (Go to › Notebook opens one, Edit ›
      Notebook turns editing on and off; seen red with the notebooks emptied, PR 422) and
      `apps/web/e2e/m45-home-assistant.spec.ts:61` (⌘K offers *Ask:* and opens the closed rail
      with the text; seen red with the row removed, PR 426). Units:
      `apps/web/src/components/palette/CommandPalette.test.tsx:157`, `:171` (no *Ask:* row
      without assistant access), `:187`, `:198`. CI runs 38266060522 and 38322422098.*
- [x] **Edit mode turns on only after Approve.** *Ticked 2026-10-13: PR 424 (`f2cf10c`).
      `apps/web/e2e/m16-assistant.spec.ts:142`: the card reads "Turn editing on", the page stays
      in Reading until Approve, then is in Editing. `apps/web/src/components/assistant/runPaletteCommands.test.ts:58`
      (a command that needs Approve is handed back unrun), `:69` (runs once on Approve), `:83`
      (nothing on Not now); `ProposalCard.test.tsx:246` and `:258`, seen red with `decideOffer`'s
      condition inverted. CI run 38281860701.*
- [ ] **The ledger shows the new surface's cost per turn** (`ai-usage` skill output pasted here).
      *Not ticked 2026-10-13. The ledger is reachable from this container (Neon MCP, project
      `sweet-firefly-79114130`, branch `production`), and the surface is recorded: `ask.account`
      and `ask.playbook` are values of `endpoint` (`apps/web/src/server/assistant/ledger.ts:96`).
      But production has **no turn on either yet**. `.claude/skills/ai-usage/ledger.sql` query 11
      over 7 days returns only `ask` (3 turns), and over all time the table holds 10 real `ask`
      turns (2026-09-19 to 2026-10-10) and nothing else. The eval's numbers above come from its
      own private database, which is dropped at teardown. Mitchell's two walks below are the
      first production turns on the new surfaces; re-run query 11 after them and paste its rows
      here.*
- [x] **The e2e spec passes on `pnpm --filter web test:e2e:ci-like`** against the simulated
      provider. *Ticked 2026-10-13 on CI, every part's head green on both e2e shards (the table
      above). The milestone's specs: `apps/web/e2e/m41-command-palette.spec.ts` (part 1),
      `apps/web/e2e/m16-assistant.spec.ts` (part 2), `apps/web/e2e/m45-home-assistant.spec.ts`
      (part 4) and `apps/web/e2e/m45-playbook-assistant.spec.ts` (part 5), last run together on
      PR 427's head `408f7e0`, run 38337996066. ci-like locally per the PR bodies: m41 5 passed
      (PR 422); m45-playbook-assistant, m45-home-assistant and m16-assistant 12 passed (PR 427).*
- [ ] **[walk]** On the PR preview, open the home assistant (Ask) and ask it *"which city have I been to most"* and
      *"open my Kyoto trip on the map"*. *Not ticked: awaiting Mitchell's walk on prod. He
      walked part 4's preview (2026-10-12), and his two comments changed D7, but he has not yet
      asked these two questions. "Open my Kyoto trip" depends on PR 429's matcher when the
      model passes the words as typed, so walk it after PR 429 merges.*
- [x] **Each playbook surface grants only its own tools.** A grants test lists every playbook
      surface's tools and is seen red with a trip tool (`find_free_time`) added. A signed-out or
      non-assistant user gets no rail and a refused request. *Ticked 2026-10-13: PR 427
      (`940df19`). `apps/web/src/server/assistant/grants.test.ts:491` lists each playbook
      surface's tools, whatever the classifier or class; seen red with the `playbook-day` row also
      granted itinerary at read, printing `+ "find_free_time"`. `:505`: no playbook tool on a trip,
      day, page or account turn. Refused request: `apps/web/src/app/api/ask/route.int.test.ts:292`
      (401 signed out, 402 without the assistant; each seen red). No rail:
      `apps/web/src/components/assistant/BeyondTripAssistant.test.tsx:78` and
      `apps/web/e2e/m45-playbook-assistant.spec.ts:100` (the Ask is in the server HTML on a plan
      with the assistant, not on a free one). CI run 38337996066.*
- [ ] **[walk]** On a playbook day in the preview, open the assistant, ask what the day covers,
      then *"add this to my Kyoto trip on day 3"*. Approve, and the stop lands there. *"Start a
      trip with this day"* creates the trip. *Not ticked: awaiting Mitchell's walk on prod. The
      steps are in PR 427's body, *Walk steps for the preview*. "My Kyoto trip" is the phrase the
      live eval failed on, so walk it after PR 429 merges.*
- [x] A retro is appended at gate close. *Ticked 2026-10-13: below.*

**A known gap, accepted at close: decision 3 of Mitchell's part 5 answers** (the plan is sent
with the page, so Ask is in the first paint with no flash; this is not D3 above) **holds from the
`md` width up, and not on a phone.** From `md` up, the page head's Ask is drawn from the served
plan and is in the server HTML (`apps/web/e2e/m45-playbook-assistant.spec.ts:100`). On a phone
that Ask is hidden, and the tab bar's Ask is registered in an effect, so it appears at hydration
on every surface that offers one, not only the playbook pages. The fix is a contract between the
layout and every page, so it is open as KI-2026-10-13-a and not built in M45.

## Retro — written 2026-10-13, before the walks (9 of 12 boxes ticked; open: the two [walk] boxes and the ledger box)

**What shipped.** Part 0 (PR 420) and seven PRs on `main`: part 1, the palette learns notebooks
and runs a command by id (PR 422, `bc2b587`); part 3, the account-scoped ask with four
deterministic cross-trip tools (PR 421, `d34abe5`); part 2, the assistant names palette commands
(PR 424, `f2cf10c`); a fix the first live eval found, KI-2026-10-12-e (PR 425, `c0e0bf4`); part 4,
Home's rail and ⌘K's *Ask:* row (PR 426, `204c9dd`); part 5, the assistant on the playbook pages
(PR 427, `940df19`); and part 6, the trip-name matcher the second live eval found (PR 429,
`8143772`). No migrations, as the plan expected:
`ai_usage.endpoint` is unchecked text, so the new surfaces are the values `ask.account` and
`ask.playbook`. 10,180 lines added across the seven PRs by GitHub's count (10,065 without
`docs/`, the guideline's count).

### What went well

- **Deterministic aggregate tools (D1) made the account surface cheap and right.** The four
  example questions passed on both live runs, at `d34abe5` and `940df19`, each with one tool
  call on Haiku 5.5, at about $0.0003 a turn. A trip-surface turn at `940df19` averaged about
  $0.0168.
- **Parts 1 and 3 ran in parallel against `main`**, and every part merged on its own once green.
  All six planned PRs merged between 2026-10-12 and 2026-10-13 02:59Z, with no stack to rebase.
  Each part's last head was green on every CI job, both e2e shards included (the gate's table).
- **The live eval found two real defects that the simulated model could not.** The run at
  `d34abe5` surfaced the planning-text leak (KI-2026-10-12-e, fixed in PR 425). The run at
  `940df19` failed `p-add-to-trip`: a real model passed the trip as "Kyoto trip", and
  `tripsCalled` (`navigate.ts:177-181` at `940df19`) matched only names containing the typed text,
  although its docstring said "my Kyoto trip" would work. The same matcher backs `open_trip`, so
  the gate walk's "open my Kyoto trip on the map" could have failed on prod. PR 429 fixes it.
- **Every part's PR body carries a red-first table**: the source edit and the failure text for
  each new test (PRs 421, 422, 424, 426 and 427). The gate's evidence is read from them.
- **Mitchell's walk of part 4's preview changed D7 before it merged**: Home's rail starts closed
  at every width and Ask opens it (`b426862a`). The walk did its job at the right time.
- **The palette-first rule (D4) held.** *Go to › Notebook* and *Edit › Notebook* are palette
  commands a person can run from ⌘K (`apps/web/e2e/m41-command-palette.spec.ts:145`), and the
  assistant runs those same commands' `run` (`runPaletteCommands.test.ts:21`). No second action
  union was written.

### What could be better

- **The simulated model pre-extracts tool inputs, so the deterministic tests could not see the
  trip-name miss.** It passes `trip: "Kyoto"` (`simulatedModel.test.ts:1183`,
  `route.int.test.ts:320` at `940df19`), where a real model passes what the person typed. Only
  the paid live run found it. The change that would have prevented it: a tool that matches a
  person's words is unit-tested on those words, as typed ("my Kyoto trip", "the Kyoto trip."),
  and not on the name already extracted. PR 429's tests now do that.
- **Navigation had no live case until the close.** No case in the 29-case live set asked to open
  or go anywhere, so `open_trip` and `go_to` were never run against a real model before the gate.
  PR 429 adds `a-open-trip` and `p-start-trip`; neither has run live. A part that adds a model
  tool should add its live case in the same PR.
- **PR 427 took four review rounds, and its first fix round was the costliest agent of the final
  session** (3.03M units, 133 calls, peak context 245k, close to the 250k ceiling). Mitchell's
  part 5 answers, the third of which ("send the plan with the page") is a cross-cutting change to
  the `(app)` layout, arrived after the PR was opened and went into the fix round with the
  review's blocker. D9 itself was added after parts 1–3 had merged. Questions a part depends on
  should be settled at planning, before the builder starts.
- **Decision 3 of those answers holds from the `md` width up, and not on a phone**
  (KI-2026-10-13-a, found in PR 427's review round 2). The tab bar is mounted by the layout and
  learns of a page's Ask in an effect, so the phone's Ask appears at hydration on every surface.
  It was accepted at close as a known gap, because the fix is a contract between the layout and
  every page.
- **One `test / unit` red is unexplained.** PR 427's `5dff1cb` failed `test / unit` (run
  38336845167). Its log could not be read from the build container, and the job was green before
  that commit and after it (`408f7e0`, run 38337996066). The cause is unknown; it is recorded as
  unexplained, not as a flake. Fetching the failed job's log while it is fresh (`ci-triage`)
  would have settled it.
- **The orchestrator's share of the final session was 19.8%, against a target under 15%.** Most of
  it was the 43 turns started by subagent reports and finishes (76% of the orchestrator's units),
  across PR 427's four review rounds, PR 429 and the eval.
- **The spend block covers only the final build session.** That session ran part 5's review and
  fix rounds, PR 429 and the live eval at `940df19`. The sessions that built parts 1 to 4 and
  PR 425 ran in other containers, whose transcripts went with them, and none ran
  `session-metrics` before it ended. Running it at every session handoff, not only at the last,
  would have kept them.

### Leftovers

- **PR 429** (the trip-name matcher, two new live cases): open and under re-review at the close.
  Mitchell's to merge; its sha goes in the gate's table.
- **The two [walk] boxes**: Mitchell's walk on prod, after PR 429 is deployed.
- **The ledger box**: production has no `ask.account` or `ask.playbook` turn yet. Mitchell's walk
  makes the first ones; then `.claude/skills/ai-usage/ledger.sql` query 11 is pasted in.
- **KI-2026-10-13-a**, the phone tab bar's Ask at hydration (decision 3 on a phone): open.
- **KI-2026-10-12-h**, the planning text that streams and is then taken back: open on purpose.
- **KI-2026-10-12-g**: the composer half is fixed (PR 426); the date-pill and trip-name losses, and
  drafts left behind by a session expiry, stay open there.
- **KI-2026-10-12-c**, the eval's country-name check misgrades both ways: open.
- **KI-2026-10-12-a, -b, -d and -f** (the costs and weather properties, the CI postgres image
  pull, a preview's `git_info_fail`): open, none caused by M45.
- **KI-2026-10-13-c**, an unpriced eval turn counts as $0 against the run's cap: `c-remove` on
  Opus at `940df19` and `a-open-trip` on Sonnet at PR 429's `87c01b0` came back `unpriced`, because
  `turnMicroUsd` returns null when any step reports no token usage. Open; filed on Mitchell's call
  (2026-10-13).
- **KI-2026-10-13-d**, the playbook classifier calls a change request a `question` (cheap tier):
  `p-add-to-trip` at `940df19`, and both playbook change prompts at `87c01b0`. It caused no
  failure; the playbook variant has no change class to choose. Open; filed on Mitchell's call
  (2026-10-13).
- **Candidate filed 2026-10-13 from Mitchell's walk**: the assistant knows which surface started the
  conversation, and can start a trip from scratch outside a trip (`docs/candidates.md`). Not M45 work.
- **The unexplained unit red on `5dff1cb`**: recorded above; nothing to file without a cause.
- **From the deleted plan, kept here:** every behaviour e2e reaches needs a phrase branch in
  `apps/web/src/server/ai/simulatedModel.ts` and a case in `simulatedModel.test.ts`, and that is
  also why the simulated lane cannot see what a real model passes as a tool's input (above).

## Spend
<!-- session-metrics:milestone v1 -->

13 agents, 633 API calls, 9.19M units. One call is one assistant `message.id`; units = input + 1.25 × cache write + 0.1 × cache read (output excluded, transcripts understate it).

**By agent type**

| Who | Agents | Calls | Avg context | Peak context | Units | Share |
|---|---|---|---|---|---|---|
| `phase-implementer` | 5 | 269 | 107k | 245k | 4.30M | 46.8% |
| `part-reviewer` | 6 | 208 | 77k | 160k | 2.36M | 25.7% |
| `orchestrator` | 1 | 93 | 172k | 243k | 1.82M | 19.8% |
| `general-purpose` | 1 | 63 | 89k | 119k | 699k | 7.6% |

**Costliest agents**

| Agent (description) | Type | Calls | Avg context | Peak context | Units |
|---|---|---|---|---|---|
| Fix round 1 for PR 427 | `phase-implementer` | 133 | 148k | 245k | 3.03M |
| Re-review PR 427 round 2 | `part-reviewer` | 55 | 90k | 134k | 771k |
| Run M45 live eval on main | `general-purpose` | 63 | 89k | 119k | 699k |
| Review M45 part 5 PR 427 | `part-reviewer` | 49 | 103k | 160k | 690k |
| Fix trip-name matching (M45) | `phase-implementer` | 52 | 82k | 123k | 566k |
| Re-review PR 427 round 3 | `part-reviewer` | 64 | 65k | 98k | 529k |
| Fix round 2 for PR 427 | `phase-implementer` | 45 | 67k | 91k | 397k |
| Review PR 429 trip-name fix | `part-reviewer` | 18 | 61k | 85k | 208k |
| Fix round 1 for PR 429 | `phase-implementer` | 20 | 47k | 58k | 154k |
| Fix round 3 for PR 427 | `phase-implementer` | 19 | 46k | 57k | 153k |

**Orchestrator turns, by what started them**

| What started the turn | Turns | Units | Share of orchestrator | Idle |
|---|---|---|---|---|
| GitHub / trigger notification | 0 | 0 | 0.0% | 0 of 0 (0 units) |
| Subagent report | 11 | 590k | 32.4% | – |
| Subagent finished | 32 | 794k | 43.6% | – |
| Harness | 0 | 0 | 0.0% | – |
| Human | 6 | 438k | 24.0% | – |
| Other (unrecognised frame) | 0 | 0 | 0.0% | – |

**Follow-ups and cache re-writes**

| Measure | Count | Tokens |
|---|---|---|
| `SendMessage` calls by the orchestrator | 0 | – |
| Coordinator messages received mid-life, by 0 subagent(s) | 0 | – |
| Full cache re-writes in subagents | 4 | 793k |
| — directly after a coordinator message | 0 | 0 |

**Guard hooks**

| Hook | deny | note |
|---|---|---|
| `implementer-brief-check` | 1 | 0 |
| `notification-unsubscribe-nudge` | 0 | 2 |

**Targets**

| Target | Result | Measured |
|---|---|---|
| Orchestrator share of units < 15% | missed | 19.8% |
| No phase-implementer averaging > 250k context | met | worst 148k |
| GitHub wakes per merged part < 5 | met | 0 / 7 = 0.0 |
| Dollars per 1k lines added < 20 | not measurable | needs --cost-usd and --lines-added |
| Coordinator-message re-writes <= 2 | met | 0 |

### Spend against the last milestone

The block is the final build session only, so it compares with M42's whole-milestone numbers
loosely. That session's recorded cost was $38.81 at 04:01Z on 2026-10-13 (`get_session`,
`external_metadata.usage.cost_usd`), while the close was still running.

- **Dollars per 1,000 lines added (under 20):** not measurable for M45. The cost of the sessions
  that built parts 1 to 4 is gone with their containers, and $38.81 against the whole
  milestone's 10,180 lines would understate it. M42: 34.
- **Orchestrator's share (under 15%):** missed, 19.8% (M42: 30%). Subagent reports and finishes
  started 43 of its 49 turns, across PR 427's four rounds, PR 429 and the eval.
- **A builder's average context (none over 250k):** met, worst 148k (M42: 315k). PR 427's first
  fix round peaked at 245k.
- **GitHub wakes per merged part (under 5):** met in this session, 0 of 7 (M42: 21).
- **Cache re-writes after a coordinator message (2 or fewer):** met, 0 (M42: 24). The orchestrator
  sent no `SendMessage`; each fix round was a new agent.
