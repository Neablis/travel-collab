# M45 — The assistant answers about all your trips, and can take you places

**Status:** **Proposed 2026-10-06, placed after M44. Not scoped yet**: the decisions below are
recommendations and none has been answered. Minted from `docs/candidates.md` (see
`docs/milestones/README.md`, *2026-10-06 — proposed: M37 to M47*). It is placed late on purpose.
On 2026-10-03 Mitchell wanted users before increasing AI cost, and an account-wide assistant is
new AI traffic. If that changes, this milestone can move up without changing its scope.

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

## Decisions it needs (recommendations; none answered)

1. **Aggregates are computed by deterministic tools, not by the model reading trip dumps.**
   *Recommended:* `spend_by_category`, `places_visited`, `visit_counts`. They are cheaper,
   correct, and testable without a model. The M32 free-day tool is the precedent.
2. **Which trips count:** trips where the user is travelling (ADR-065), not every trip they can
   open. Invariant 7 still holds, so nothing is read that the user could not open.
3. **Country and city come from geocoded places, with the stop's city as the fallback.** A stop
   with neither is counted as unknown and never guessed. *Suggest the next country* subtracts the
   visited set from a static list. That list is the only new data.
4. **A client action is a typed destination, never a URL.** One ADR defines `ClientAction`, a
   closed union (`openNotebook`, `setLens`, `focusDay`, `focusStop`, `openPeople`,
   `setNotebookEditing`). Navigation runs visibly when the reply arrives. A state change such as
   edit mode goes through Approve. Neither silently leaves a page that has unsaved input.
5. **No memory.** *User memory* stays deferred with the eve port (ADR-062).

## Scope

- An assistant on the home page with the cross-trip read tools.
- `ClientAction` and its ADR, the navigation tools, and the edit-mode proposal.
- Usage recorded in the M31 ledger under its own surface, and cases added to the M33 eval suite.

## Out of scope

- The eve port and user memory, which stay deferred (ADR-062 § *Deferred: the port*).
- Writes across trips. This assistant reads across trips and writes within one.

## Exit gate

- [ ] **Decisions 1–5 are answered and recorded here**, and the `ClientAction` ADR is written.
- [ ] **Each aggregate tool is unit-tested over a fixture of several trips, each test seen red**,
      including a trip the user is not travelling on, which must be excluded.
- [ ] **The four example questions are answered correctly** in the eval suite (M33). The run's
      numbers are pasted here.
- [ ] **A navigation reply changes the view the user sees, and a URL in a reply does not
      navigate.** A test is seen red with free URLs allowed.
- [ ] **Edit mode turns on only after Approve.**
- [ ] **The ledger shows the new surface's cost per turn** (`ai-usage` skill output pasted here).
- [ ] **The e2e spec passes on `pnpm --filter web test:e2e:ci-like`** against the simulated
      provider.
- [ ] **[walk]** On the PR preview, ask the home assistant *"which city have I been to most"* and
      *"open my Kyoto trip on the map"*.
- [ ] A retro is appended at gate close.
