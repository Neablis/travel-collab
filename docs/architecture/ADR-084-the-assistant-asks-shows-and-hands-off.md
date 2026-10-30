# ADR-084: The assistant asks with pickers, shows only what tools returned, and hands off with a button

**Status:** **Accepted — 2026-10-30.** Mitchell answered M56's decisions D1–D9 (D1, D2 and D7
changed from the spec's recommendations).
**Deciders:** Mitchell (product); Claude — drafted
Related: M56 (`docs/milestones/M56-new-trip-is-a-picker.md`), the design
(`docs/specs/2026-10-29-new-trip-picker-and-trip-builder-design.md`, whose §2, §4 and the builder
half of §5 are superseded by D1), ADR-022 (proposals), ADR-067 (stored suggestions), ADR-072
(the assistant names palette commands, never URLs).

## Context

The assistant has three ways to end a turn besides prose: a proposal (ADR-022), a stored
suggestion (ADR-067) and palette offers (ADR-072), one per turn (`OUTCOME_KEYS`,
`packages/contracts/src/assistant.ts:467`). It has no way to ask a closed question, no way to
show a set of real places or days to choose from, and no way to decline a task it understood
except in prose. Home's instruction tells it to *"say plainly that changes are made inside a
trip"* (`server/ai/handleAskRequest.ts:2268`), so asked to plan a new trip it refuses and offers
nothing to press. The person is left stuck with an agent that knows it cannot help and says so
without a way forward.

New trip, meanwhile, is a fixed script dressed as a chat, whose typed answers are mostly dropped
(M56, *Why this exists*).

## Decision

1. **New trip is a deterministic picker, with no model and no free text.** Five pages and Review.
   Where commits only a place search result. **Create is a person pressing a button**, through
   `createTripWithSetup` (`components/home/newTripSubmit.ts`), the one creation path. There is no
   pre-trip assistant surface (D1): a paid person's *Plan with AI* creates the trip and opens the
   plan page's assistant.

2. **Three new turn outcomes, general to every surface.** They join `AskStreamShape`'s union and
   its one-outcome rule:
   - **`ask`** (from the `ask_user` tool): a question, 2–6 options, single or multi, and an
     optional constrained *other* (`place`, `number` with min / max / unit, `date`, `tags`). It
     ends the step. **The answer returns as data**: a `data-ask-answer` part
     (`{ answeredAsk, optionIds, other }`) on the user message, declared in the ask route's
     data-part validation and turned into model text by the server. Nothing is parsed and no
     classifier runs. The person may type in the composer instead.
   - **`options`** (from `show_options`): cards for places, published days or palette targets.
     **The model chooses and orders ids from earlier tool results in the same turn; the server
     fills every name, photo and detail**, and drops an id no tool returned. Cards cannot show an
     invented place or number.
   - **`handOff`** (from `hand_off({ task, to })`): the only way to decline a task the assistant
     understood. `to` is a palette command from ADR-072's allowlist, `new_trip` (the picker,
     optionally prefilled), `plan_page` (an existing trip), `upgrade` (only where a free person
     can reach the surface), or `nowhere` with one sentence. It renders as a sentence and a
     button, and logs **`ai.capability_gap`** (`{ surface, task, to }`, the task through
     `sanitizeForLog`) the way `ai.grant` is logged. That log is the backlog of tools not yet
     built; the `ai-usage` skill reads it.

3. **The widgets are a `ui` tool domain**, granted on every surface that has an assistant. Its
   effect is `steer` (it changes nothing). Adding a domain is a `ToolDomain` change in
   `server/assistant/defineTool.ts`.

4. **Each surface's instruction carries a capability block generated from `SURFACES` and the tool
   registry**: what this surface can change, and for each domain it lacks, the `hand_off` target
   that serves it. A grant or a tool added updates the prompt with no prose edit. A test asserts
   the block reaches every surface and that every missing domain has a target, beside
   `surfaceVoice.test.ts`.

5. **What a surface could not do before a trip existed is carried, not dropped.** A `hand_off` to
   `new_trip` may carry the asks the person made that need a trip (`{ said, kind }`). They ride
   the navigation in client storage with a max age (the `lib/pendingPlaybookAdd.ts` pattern) and
   appear in the new trip's assistant as **chips the person presses** (D5); each runs as an
   ordinary plan-page turn.

6. **Pace and tags live on the trip** (D4), set by the picker, read by the
   assistant. They are **not** a `BatchableCommand`, which would generate a planning tool on
   every planning step (`server/assistant/tools/planning.ts`).

7. **World place search is a signed-in branch of `/api/places`** (D3): anonymous callers keep the
   library-only, per-IP route; signed-in callers also get LocationIQ autocomplete through
   `readThrough` (`server/external/cache.ts`), charged per account by a `QuotaPolicy` only on a
   cache miss, library cities first and labelled *has Playbooks*. A world result carries an id
   the client can commit; a typed string cannot become a place.

## Consequences

- A turn that wanted a change never ends in prose alone: it ends in a proposal, a suggestion, an
  `ask`, `options` or a `handOff`. The eval grades that (`server/ai/eval/grade.ts` gains *ended in
  a widget* and *handed off to*).
- Every tool definition costs context on every step; three small tools are the price, and one
  generated block replaces hand-written refusal lines.
- The `new-trip` palette command takes no parameters, so a prefilled picker is `hand_off`'s own
  target, not a palette command.
- `ai.capability_gap` is a log, not a table. If the backlog needs querying beyond the log
  retention, a table is a later migration.
- e2e that created trips by typing into the wizard (`createEmptyTripViaWizard`, 16 specs) moves
  to picking a place.

## Alternatives rejected

- **A pre-trip builder editing a `TripDraft`** (the spec's §4): rejected by Mitchell at D1. It
  needed a second surface, a draft contract and persistence; trip-level rethinks become edits to
  the real trip instead.
- **A tool per draft field / per widget kind:** each costs context every step (the reason ADR-057
  moved the notebook widget catalogue out of the prompt).
- **Parsing typed answers with a classifier:** the failure M56 exists to remove.
