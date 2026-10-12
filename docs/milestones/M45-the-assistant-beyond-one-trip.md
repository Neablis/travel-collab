# M45 — The assistant answers about all your trips, and can take you places

**Status:** **Proposed 2026-10-06; current from 2026-10-12, when M43 and M44 moved last. Scoped
2026-10-12**: every decision below was answered by Mitchell that day. Minted from
`docs/candidates.md` (see `docs/milestones/README.md`, *2026-10-06 — proposed: M37 to M47*). It
was placed late because Mitchell wanted users before more AI cost (2026-10-03).

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

- [ ] **Decisions 1–9 are answered and recorded here**, and ADR-072 is written, amending
      ADR-068 §5.
- [ ] **Each aggregate tool is unit-tested over a fixture of several trips, each test seen red**,
      including a trip the user is not travelling on, which must be excluded.
- [ ] **The four example questions are answered correctly** in the eval suite (M33). The run's
      numbers are pasted here.
      *Evidence so far (2026-10-12, not ticked; the box is ticked at close):* live eval at `main`
      `d34abe5`, run with Mitchell's go-ahead.
      - Run 1, `EVAL_CONFIRM=1 pnpm --filter web eval` (default $0.10 cap): stopped at the cap
        after 4 of 27 trip turns, all PASS; $0.1874 total, ~$0.047 per trip turn (Sonnet/Opus).
        It surfaced KI-20261012-e (the assistant's planning text leaks into the reply).
      - Run 2, `EVAL_CONFIRM=1 EVAL_MAX_USD=100 EVAL_ONLY=a-most-expensive-meal,a-countries-count,a-city-most,a-next-country`:
        **4/4 PASS, 36/36 checks**; $0.0012 total, ~$0.0003 per account turn (Haiku 5.5), one
        tool call each, 2.9–4.3 s per turn.
      - Note: `a-next-country` suggested Spain while the fixture's not-travelling trip is
        Barcelona. The tool sees only travelled trips, so this is most likely a popular pick, not
        a leak of the excluded trip.
- [ ] **A navigation reply runs the palette command it names and changes the view the user
      sees; a command the page does not offer, or a URL, does nothing.** A test asserts the run is
      the palette command's own function (ADR-068 §2), and one is seen red with free URLs allowed.
- [ ] **⌘K's *Go to › Notebook* and *Edit › Notebook* work by hand**, and text that matches no
      command offers *Ask: …*, which opens the assistant with it.
- [ ] **Edit mode turns on only after Approve.**
- [ ] **The ledger shows the new surface's cost per turn** (`ai-usage` skill output pasted here).
- [ ] **The e2e spec passes on `pnpm --filter web test:e2e:ci-like`** against the simulated
      provider.
- [ ] **[walk]** On the PR preview, ask the home assistant *"which city have I been to most"* and
      *"open my Kyoto trip on the map"*.
- [ ] **Each playbook surface grants only its own tools.** A grants test lists every playbook
      surface's tools and is seen red with a trip tool (`find_free_time`) added. A signed-out or
      non-assistant user gets no rail and a refused request.
- [ ] **[walk]** On a playbook day in the preview, open the assistant, ask what the day covers,
      then *"add this to my Kyoto trip on day 3"*. Approve, and the stop lands there. *"Start a
      trip with this day"* creates the trip.
- [ ] A retro is appended at gate close.
