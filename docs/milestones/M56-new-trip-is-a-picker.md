# M56 — New trip is a picker, and the assistant never strands you

**Status:** **Scoped 2026-10-30, current.** Minted and placed **ahead of M43** the same day by
Mitchell: *"I want it to be the next work we do, so go ahead and get the plan ready to be the next
milestone then start work"* (see `docs/milestones/README.md`, *2026-10-30 — minted and placed:
M56*). The design is `docs/specs/2026-10-29-new-trip-picker-and-trip-builder-design.md`; **D1
changed it**: there is no pre-trip builder and no `new-trip` assistant surface. The mechanisms are
**ADR-084**, and the plan is `docs/plans/2026-10-30-M56-new-trip-picker.md` (deleted at gate
close). Six parts plus part 0.

## Why this exists

Mitchell typed *"I am not sure, can you help me plan a real foodie adventure? Somewhere i havent
been before, 2 weeks long"* into New trip, and Cass answered *"I am not sure, can you help me plan
… 2 weeks long, good"*. The sheet looks like a chat and is a fixed form (SPEC §30.2): typed text
on Where becomes the trip's name, typed text on every other turn is stored and never read, and
pace and *about* reach nothing. Asked the same thing, Home's assistant refuses in prose and offers
nothing to press.

His asks: pick from a boxed control the whole way through, get the trip, and on a paid plan keep
planning with AI; and *"the worst thing we can do is make the user feel stuck talking to a ai
agent that doesnt have the tools to do the task, but doesnt understand that."*

### What exists (survey of `f328de7`, 2026-10-30)

Paths are under `apps/web/src/` unless they start with `packages/`, `docs/` or `apps/web/`.

| Already here | Where | What M56 does with it |
|---|---|---|
| The scripted New-trip sheet: questions `where, pb, date, start, len, pace, feel`, typed Where committed and echoed | `components/home/newTripScript.ts:34`, `commitAnswer` :344, `acknowledge` :448; `components/home/NewTripWizard.tsx:467` (name), :480 (`dated`), :708 (*"not built in yet"*) | Replaced by five picker pages and Review (part 2) |
| Create path: `createTrip`, then `SetTripDates` / `SetTripBudget` / `SetTripCurrency` | `components/home/newTripSubmit.ts:103` `createTripWithSetup` | Also writes pace and tags (part 4); every entry into a new trip goes through it |
| Activity tags and their tints; the About set already has a type | `lib/activityTags.ts:38` `TAG_CHIP_CLASS`; `ActivityTagDescribed`, `packages/contracts/src/activity.ts:269` | One lucide icon per tag, everywhere a tag shows (part 1, D8) |
| Library place search, public and charged per IP | `app/api/places/route.ts`, `server/places.ts:128` `searchPlaces` | Signed-in callers also get LocationIQ world results (part 3, D3) |
| LocationIQ forward search, session-only, quota-charged | `server/geocoding/locationiq.ts:109`, `app/api/geocode/route.ts:17` | Gains an autocomplete call behind a cache (part 3) |
| Surfaces grant tool domains; `account` may only read | `server/assistant/grants.ts:91-171` (`account` :162) | Each surface gains the `ui` widgets; its instruction gains a generated capability block (part 5) |
| Home's refusal line | `server/ai/handleAskRequest.ts:2268`, in `accountInstructionBlocks` :2264 | Replaced by `hand_off` (part 5) |
| A turn's outcomes: proposal, suggested note, palette offers, one outcome per turn | `AskStreamShape`, `packages/contracts/src/assistant.ts:389`, `OUTCOME_KEYS` :467; `components/assistant/Transcript.tsx:463-480` | Three new outcomes: `ask`, `options`, `handOff` (part 5) |
| Entitlement to AI | `lib/useAiEntitled.ts:87`, `server/assistant/entitlements.ts:32` | Review's buttons split on it, never on a plan name (`planVersions.fourthPlan.test.ts`) |
| Rate limits and an external cache | `QuotaPolicy` / `consumeQuota`, `server/quota.ts:534`; `readThrough`, `server/external/cache.ts:157` | Part 3's per-account limit and cache |
| Carrying intent across a navigation | `lib/pendingPlaybookAdd.ts` (localStorage with a max age) | The pattern for carried asks (part 6) |

**The spec's §1 was wrong in one place**: it said place search knows only the library and the
world is reachable only through the importer and a tool. `/api/places` (public, library) and
`/api/geocode` (session-only, LocationIQ) both exist. ADR-057 is the *notebook* widget search,
not chat widgets; there is no chat-widget catalogue yet.

## Decisions

### Answered (2026-10-30, by Mitchell)

- **D1. Builder before the trip, or create first? → Create first.** *Changed from the
  recommendation.* There is no trip draft the assistant edits, no `new-trip` surface, no
  `update_draft` or `propose_create`. A paid person's **Plan with AI** on Review creates the trip
  and opens the plan page's assistant, which has the full toolset. A trip-level rethink
  (*"actually, two cities"*) is an edit to the real trip.
- **D2. Does the draft persist? → No server draft.** *Changed (follows D1).* The picker's answers
  live in the sheet's own state. Nothing is stored before Create.
- **D3. World place search → yes, as written,** with one detail answered: `/api/places` stays
  public and library-only for anonymous callers; **signed-in callers also get LocationIQ
  autocomplete results**, library cities ranked first and labelled *has Playbooks*, behind a
  per-account rate limit and the external cache.
- **D4. Pace and tags on the trip → yes.** A contract change (`docs/contracts/CHANGELOG.md`). The
  plan page's assistant reads them.
- **D5. Carried asks → chips the person presses.** Nothing runs unasked.
- **D6. Day themes in the builder → withdrawn.** There is no builder (D1).
- **D7. Cass → Cass in both.** *Changed from the recommendation.* The picker keeps Cass's voice
  with no AI badge; the assistant keeps its badge.
- **D8. Tag icons → lucide, one per tag, everywhere a tag shows.** Part 1 proposes the twelve and
  Mitchell approves them on its preview.
- **D9. The *start from a published day* question** (today's `pb` turn, which the spec's five
  pages dropped) **→ an optional card on Review**: popular days for the chosen place, each with
  *Start from this*; skipping it changes nothing.

### Settled in the plan (not Mitchell's to answer; say so if wrong)

- **Pace and tags are set by the picker and by the trip's settings, not by a new assistant
  tool.** Adding the command to `BatchableCommand` (`packages/contracts/src/trip.ts:320`)
  generates a planning tool automatically (`server/assistant/tools/planning.ts:4-15`), which costs
  context on every planning step. Part 4 keeps it out; the assistant reads them.
- **How long keeps today's five chips** (`LENGTH_DAYS`, `newTripScript.ts:90`) plus the − / +
  counter.
- **`ai.capability_gap` is a log line, not a table**, written like `ai.grant`
  (`server/ai/admissionPorts.ts:54`), with the model-written `task` through `sanitizeForLog`.
  `ai_usage_tool_calls` does not hold tool inputs, so a table would need a migration for no
  reader the log does not already serve. The `ai-usage` skill learns to read it.

## Scope

1. **The picker widget and the tag icons** (part 1). One boxed control with options, single or
   multi, and a constrained *other* (place, number, date, tags). One lucide icon per activity tag,
   in every tag chip.
2. **New trip rebuilt on it** (part 2). Five pages (Where, Start date, How long, Pace, About), a
   progress bar and *Step N of 5*, Review with *Change* on every answer, and changing Where
   re-walks the later pages prefilled under *Destination changed*. No free text anywhere. Review:
   free plans get **Create trip** and one quiet locked line about AI planning; paid plans get
   **Just create it** and **Plan with AI**. The optional published-day card (D9).
3. **World place search** (part 3, D3).
4. **Pace and tags on the trip** (part 4, D4), written at Create, read by the plan page's
   assistant.
5. **`ask_user`, `show_options`, `hand_off` and a generated capability block** on the existing
   surfaces (part 5). Every *I can't* carries a button; Home's refusal line goes.
6. **Hand-offs into a new trip** (part 6): **Plan with AI** lands on the plan page with the
   assistant open and a kickoff; Home's *"help me plan a trip"* hands off to the picker prefilled;
   what Home was asked that only a trip can do arrives as chips in the new trip's thread (D5).

## Out of scope

- A pre-trip builder, a `TripDraft` the assistant edits, the `new-trip` surface, `update_draft`,
  `propose_create`, the draft strip and day themes (D1, D6).
- A server-side draft (D2).
- Multi-city routes at creation. The picker sets one place; more places are plan-page edits.
- Booking, live prices, visas, payments: `hand_off` says *nowhere* with one sentence.
- Running the live eval. The new cases are written and graded offline; the live run is
  Mitchell's call.

## Exit gate

- [ ] **Decisions D1–D9 are answered and recorded here**, and ADR-084 is written.
- [ ] **New trip has no free-text input.** A unit test on the flow finds no text input outside the
      place search's own field, and an int or unit test shows Where cannot commit a string that
      did not come from a search result. Seen red.
- [ ] **Every answer reaches the trip.** Creating with a start date, a length, a pace and tags
      produces a trip whose detail holds all four, in an int test through `createTripWithSetup`'s
      commands. Seen red.
- [ ] **Changing Where on Review re-walks the later pages with their answers prefilled**, in a
      component test. Seen red.
- [ ] **Review's buttons split on entitlement, not on a plan name**: free sees *Create trip* and
      the locked line, paid sees *Just create it* and *Plan with AI*. `planVersions.fourthPlan.test.ts`
      still passes.
- [ ] **One icon per tag**: an exhaustive map typed over the tag union, so a new tag without an
      icon fails typecheck, and the chips render it.
- [ ] **World search is signed-in only, limited and cached**: an int test sees an anonymous
      `/api/places` call return library results only, a signed-in one return world results with
      library cities first and labelled, a cache hit spend no quota, and the per-account limit
      refuse. Seen red.
- [ ] **Pace and tags are on the trip contract** with defaults so old trips still read, and the
      CHANGELOG entry is written. The plan page's assistant reads them (`read_trip` and the
      standing block).
- [ ] **No turn that understood a task ends in prose alone when it cannot do it**: `hand_off` is
      the only decline, it renders a sentence and a button, and it logs `ai.capability_gap`.
      Home's *"changes are made inside a trip"* line is gone.
- [ ] **The capability block is generated from `SURFACES` and the tool registry**, and a test
      asserts it reaches every surface and that every domain a surface lacks has a hand-off
      target. Seen red.
- [ ] **An `ask_user` answer comes back as data** (a structured part, not text the model
      re-reads), in an int test on the ask route.
- [ ] **Eval cases exist for each boundary** (can do, plan-page job, nobody can, off-topic), with
      a grader field for *ended in a widget* and *handed off to*. Graded offline; the live run is
      not run without Mitchell.
- [ ] **Plan with AI lands on the plan page with the assistant open**, and asks carried from Home
      show as chips that run only when pressed.
- [ ] **`createEmptyTripViaWizard` drives the new flow** and every spec that called it is green
      in CI. KI-2026-10-28-e is resolved or re-filed with why.
- [ ] **The new e2e specs pass on `pnpm --filter web test:e2e:ci-like`** and in CI.
- [ ] **[walk]** On the previews: New trip end to end on a free and a paid account at 390px and on
      desktop, the tag icons approved by Mitchell, a city with no playbooks found by name, Home's
      *"help me plan a foodie trip somewhere new"* handed off with a button, and Plan with AI
      landing on the plan page.
- [ ] A retro is appended at gate close.
