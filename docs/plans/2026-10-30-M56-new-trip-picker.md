# M56 plan — New trip is a picker, and the assistant never strands you

Write-once scaffolding for `docs/milestones/M56-new-trip-is-a-picker.md`; deleted at gate close.
Decisions are in the milestone file, mechanisms in ADR-084. Survey read `main` at `f328de7`
(2026-10-30). Paths are under `apps/web/src/` unless they start with `packages/`, `docs/` or
`apps/web/`. Line numbers are at `f328de7` and drift; the entry point's name is the anchor.

**Every part targets `main` and merges on its own**, branch `claude/m56-part<K>-<slug>`. A part
that needs another waits for it to merge, then branches from `main`.

**Order:** part 1 first. Parts 3, 4 and 5 can then run in parallel. Part 2 needs 1 (and uses 3's
world results if merged, else library `searchPlaces`; it does not wait for 3). Part 2 writes pace
and tags only once part 4 is on `main` (if 4 lands second, 4's brief adds the write). Part 6 needs
2, 4 and 5.

| Part | Branch | Theme | Needs | Files (≈) | Migration |
|---|---|---|---|---|---|
| 1 | `claude/m56-part1-picker-and-tag-icons` | The picker widget, one icon per tag | — | 8 | no |
| 2 | `claude/m56-part2-new-trip-pages` | New trip as five pages and Review | 1 | 10 + e2e | no |
| 3 | `claude/m56-part3-world-place-search` | World results in `/api/places` for signed-in callers | — | 6 | no |
| 4 | `claude/m56-part4-pace-and-tags-on-trip` | Pace and tags on the trip contract | — | 20 | no (JSONB projection); `0070` if one proves needed |
| 5 | `claude/m56-part5-ask-show-hand-off` | `ask_user`, `show_options`, `hand_off`, capability block | 1 | 15 | no |
| 6 | `claude/m56-part6-into-a-new-trip` | Plan with AI, Home's hand-off, carried-ask chips | 2, 4, 5 | 8 + e2e | no |

**Added after the first preview walk (2026-10-30).** Each was its own PR on `main`; none has a
migration.

| Part | Branch | Theme | PR |
|---|---|---|---|
| 7 | `claude/m56-part7-tag-grid` | Tag picker tiles are equal squares in a grid | PR 650 |
| 8 | `claude/m56-part8-choose-button` | Choose keeps its size beside a long place name | PR 648 |
| 9 | `claude/m56-part9-choice-count` | At most four option cards; one card asks yes or no | PR 652 |
| 10 | `claude/m56-part10-land-on-plan` | A trip made from New trip lands on its Plan | PR 651 |
| 11 | `claude/m56-part11-place-name-title`, `…-place-name-address` | Title a place choice by its name; keep its address for the model | PR 649, PR 653 |
| 12 | `claude/m56-part12-wizard-layout` | Wizard choices split or stack, *other* opens attached, tags fit a small phone | PR 654 |
| 13 | `claude/m56-part13-playbooks-instant` | Discover's shell the moment Playbooks is tapped | PR 656 |
| 14 | `claude/m56-part14-shell-cache` | The phone bar's Ask on first paint, from the route | PR 655 |
| 15 | `claude/m56-part15-ask-user-cap` | `ask_user` options capped at 4 | PR 657 |
| 16 | `claude/m56-part16-ask-after-merge` | Ask tests after PR 655 and PR 656 both merged | PR 658 |

PR 655 merged before PR 656, so PR 656's loading-frame test ("no Ask on a plan without the
assistant") was red on `main` at `b376da7`. Part 16 fixed it.

---

## Part 1 — the picker widget and the tag icons

**Theme.** One boxed control (`Picker`): a question, 2–6 options with optional detail, single or
multi (`allowNone` for multi), and an optional constrained *other*: `place` (a slot the caller
fills with a search), `number` (− / + with min, max and unit), `date` (a date input inside the
box), `tags` (the activity tags as tiles). Keyboard: arrow keys move, Space / Enter pick, Tab
leaves the group (the roving-radio pattern). And one lucide icon per activity tag, used by every
tag chip. The twelve icons are proposed in the PR body as a table for Mitchell to approve on the
preview (D8).

**Files.**
- New `components/ui/picker.tsx` — `Picker`. Base on `components/ui/icon-radio-group.tsx` and
  `components/ui/use-roving-radio.ts`. Test: new `components/ui/picker.test.tsx` (beside
  `roving-radio.test.tsx`).
- New `lib/activityTagIcons.ts` — `ACTIVITY_TAG_ICON: Record<ActivityTag, LucideIcon>`, exhaustive
  by type (pattern: `MODE_DISPLAY`, `components/board/TravelModePicker.tsx:13`). Test: extend
  `lib/activityTags.test.ts`.
- `lib/activityTags.ts:38` `TAG_CHIP_CLASS` — unchanged colours; icons sit beside them.
- Chips: `components/board/StopTagChips.tsx:21,43` (covers RiverBlock, SharedDayScreen,
  DiscoverCard), `components/trip/TagFocusLine.tsx:48`,
  `components/pages/blocks/TripDescriptionBlock.tsx:17`, the editor
  `components/board/ActivityEditor.tsx:706`. Tests: their existing `*.test.tsx` where present.
- `lib/preview-registry.ts` — register the picker so it can be seen before part 2.

**Preview.** Any trip's Plan view and Discover cards: tag chips carry their icon. The picker in
the preview registry.

## Part 2 — New trip as five pages and Review

**Theme.** Replace the script with pages: Where (place search; only a picked result commits),
Start date (*Yes, pick a day* opens a date input in the box, or *Not yet*), How long (today's
five chips from `LENGTH_DAYS` plus − / +), Pace (three options, no *other*), About (the
`ActivityTagDescribed` tiles with part 1's icons, any or none). Progress bar, *Step N of 5*, a
subtitle of what is decided. Review lists every answer with *Change*; *Change* opens that page and
returns to Review; changing Where re-walks later pages prefilled under *Destination changed*.
Review's optional card shows popular published days for the place, with *Start from this* (D9,
today's `pickPopularDays` / `offerDays`). Review's buttons split on `useAiEntitled`: free —
**Create trip** and one quiet locked line; paid — **Just create it** and **Plan with AI** (Plan
with AI creates and navigates to the trip; the rail opening and kickoff are part 6). Cass's voice
stays, no AI badge (D7). No free text input anywhere.

**Files.**
- `components/home/newTripScript.ts` (`commitAnswer` :344, `acknowledge` :448, `pickPopularDays`
  :197, `offerDays` :383, `LENGTH_DAYS` :90) — replaced by a page-state module (pure reducer).
  Test: `components/home/newTripScript.test.ts` (rewrite for the reducer).
- `components/home/NewTripWizard.tsx` (`NewTripWizard` :133, `NewTripConversation` :369, `run` →
  `createTripWithSetup` :492, `aiEntitled` :719/:831). Test: `NewTripWizard.test.tsx` (:589
  asserts *"not built in yet"*; that goes).
- `components/home/newTripSubmit.ts` (`TripSetup` :34) — test `newTripSubmit.test.ts`.
- Callers: `components/home/FirstTripStart.tsx:110`, `components/home/HomeScreen.tsx:655`.
- e2e: `apps/web/e2e/helpers.ts:513` `createEmptyTripViaWizard` (16 specs call it) picks a place
  from a seeded library city or the MSW handler; specs that drive the wizard directly:
  `m15-front-door.spec.ts:113-116`, `responsive.spec.ts:1315-1424`, `m54-welcome.spec.ts:94-102`,
  `m26-phone-surfaces.spec.ts:154`, `m39-installable.spec.ts:215,332`,
  `m25-trip-as-a-file.spec.ts:201`, `m41-command-palette.spec.ts:110`. New
  `apps/web/e2e/m56-new-trip.spec.ts`. Close KI-2026-10-28-e if the rewrite removes its click.
- Guard: `planVersions.fourthPlan.test.ts` must still pass (split on entitlement, not plan name).

**Preview.** Home → New trip on a free and a paid account, 390px and desktop: walk all five pages,
change Where on Review and see the re-walk, create.

## Part 3 — world results in `/api/places` for signed-in callers

**Theme.** D3: anonymous callers unchanged (library, per IP). Signed-in callers that ask with
`world=1` (only New trip's Where page; Discover never does, Mitchell 2026-10-30) also get
LocationIQ autocomplete results, merged after library cities, library ones labelled *has
Playbooks*. Each world result has a stable id the client commits. Cached through `readThrough`;
quota charged per account only on a miss.

**Files.**
- `server/geocoding/locationiq.ts` (`createLocationIQGeocoder` :109; today `/v1/search`,
  `/search/structured`, `/reverse` only) and `server/geocoding/geocoder.ts` — add `autocomplete`.
  Test: `server/geocoding/locationiq.test.ts`.
- `server/places.ts:128` `searchPlaces` — the world branch. `lib/cities.ts` `PlaceMatch` gains a
  world arm and `hasPlaybooks` (not in `packages/contracts`, so no CHANGELOG entry; if the builder
  moves it into contracts, it writes one).
- `app/api/places/route.ts` — signed-in detection. Test: `app/api/places/route.int.test.ts`.
- `server/quota.ts` — a new `QuotaPolicy` (pattern `geocodeQuota` :278, `oauthRegisterQuota`
  :327), counted via `consumeQuota` :534; check the `rate_limit_counters` sweep indexes (schema
  ≈:1670, KI-2026-10-27-h) — a partial index per policy may need a migration; if so it is `0070`.
- `server/external/cache.ts:157` `readThrough` (sole writer, `external.soleWriter.test.ts`).
- `mocks/handlers.ts:1067` — MSW handler for autocomplete.

**Preview.** Not walkable on its own: world results come only with `world=1`, which New trip's
Where page sends (part 2); Discover stays library-only (Mitchell, 2026-10-30). Walk it on part
2's preview: signed in, New trip → Where, type a city with no playbooks; it appears below library
cities.

## Part 4 — pace and tags on the trip

**Theme.** D4. A `SetTripStyle` command (pace, tags) and its event, `TripDetail` fields with
defaults so old documents read, the domain's decide / evolve / history / diff, the exhaustive
consumers, `createTripWithSetup` dispatching it, and the assistant reading it. **Not** added to
`BatchableCommand` (ADR-084 §6).

**Files.**
- `packages/contracts/src/trip.ts` (`SetTripBudget` :225, `TripBudgetSetV1` :232, unions :252,
  :300; `BatchableCommand` :320 untouched), `packages/contracts/src/detail.ts:91` `TripDetail`.
  Test: the contracts package's existing tests.
- `packages/domain/src/trip/{decide.ts:265, evolve.ts:87, history.ts:257, diff.ts:51, state.ts,
  detail.ts:27}` with their `*.test.ts`.
- Exhaustive consumers: `server/accessPolicy.ts`, `server/cloneTrip.ts`,
  `server/assistant/idFields.ts`, `server/suggestions/dependencies.ts`, `server/ai/planSummary.ts`,
  `lib/suggestionOverlay.ts`, `mocks/handlers.ts`, `packages/factories/src/commands.ts`,
  `packages/fixtures/src/bundle/toCommands.ts`.
- Write: `components/home/newTripSubmit.ts` (`TripSetup` :34) — test `newTripSubmit.test.ts`; an
  int test that a created trip's detail holds start, length, pace and tags.
- Read: `server/assistant/tools/read.ts` `readTrip` :167 (schema :135); `instructionBlocks` /
  `standingOf` in `server/ai/handleAskRequest.ts:2051,2073`.
- Exposure: check `server/public-api/openapi.ts` and `server/mcp/schemas.ts` for `TripDetail`.
- `docs/contracts/CHANGELOG.md` entry.

**Preview.** Create a trip with a pace and tags (after part 2, or via the API), ask the trip's
assistant *"what pace is this trip?"*.

## Part 5 — `ask_user`, `show_options`, `hand_off` and the capability block

**Theme.** ADR-084 §2–§4 on the existing surfaces (account / Home, trip, day, playbook). Three
outcomes, a `ui` domain, the answer as a `data-ask-answer` part, server-filled cards, `hand_off`
with `ai.capability_gap`, the generated capability block replacing Home's refusal line, eval cases
and grader fields. The `new_trip` hand-off target renders a button that opens New trip (prefill
and carried asks are part 6).

**Files.**
- Contracts: `packages/contracts/src/assistant.ts` (`AskStreamShape` :389, `OUTCOME_KEYS` :467,
  `AskStreamMetadata` :489, `isAssistantCommandId` :311-318). CHANGELOG entry.
- Tools: new `server/assistant/tools/ui.ts`; `server/assistant/registry.ts:60` `ASSISTANT_TOOLS`;
  `server/assistant/defineTool.ts:54` `ToolDomain`; `server/assistant/grants.ts:91-171`
  `SURFACES`. Tests: `grants.test.ts`, `registry.test.ts`.
- Instructions: `server/ai/handleAskRequest.ts` `instructionsFor` :1979, `accountInstructionBlocks`
  :2264 (remove :2268); data-part validation at `safeValidateUIMessages` :950 and
  `convertToModelMessages` :1006/:1496; `server/assistant/admission.ts` ≈:117. Test:
  `server/ai/surfaceVoice.test.ts` (+ a capability-block test beside it).
- Log: `ai.capability_gap` like `logAiGrant`, `server/ai/admissionPorts.ts:54`; `sanitizeForLog`,
  `server/assistant/askAnalytics.ts:417`. Update `.claude/skills/ai-usage/` to read it.
- Client: `lib/apiClient.ts` (`AskWireMessage` :1748, `outcomeEvent` :1973, `askAssistant` :2017),
  `components/assistant/useAskThread.ts:398-450`, `components/assistant/Transcript.tsx:21,463-480`
  (render with part 1's `Picker`). Test: `Transcript.test.tsx`.
- Simulated model: `server/ai/simulatedModel.ts` scripted calls for e2e.
- Eval: `server/ai/eval/cases.ts` (`expectationFor` :60, `accountExpectationFor` :217),
  `eval/live-set.json`, `server/ai/eval/grade.ts:147` `EvalExpectation`. Offline only.
- Int: `app/api/ask/route.int.test.ts`, `app/api/trips/[tripId]/ask/route.int.test.ts`. e2e:
  `apps/web/e2e/m45-home-assistant.spec.ts`.

**Preview.** Home's rail, paid account: *"help me plan a foodie trip somewhere new"* → a hand-off
button, not a refusal. A trip's rail: ask something it cannot do (*"book me a flight"*) → one
sentence, `nowhere`. Ask something ambiguous → an `ask` picker; answer it.

## Part 6 — into a new trip

**Theme.** **Plan with AI** creates, navigates to the trip, opens the rail and sends a kickoff turn
(summary written by the client from the answers, not by the model). Home's `hand_off` to
`new_trip` opens the picker prefilled with what mapped onto fields (place, length, tags) and
carries the rest as asks; they arrive in the new trip's rail as chips that run only when pressed
(D5).

**Files.**
- `components/home/HomeScreen.tsx` (`startNewTrip` :231, `router.push` :350/:691, `new-trip`
  command :531).
- `components/trip/TripBoardScreen.tsx` (`useAssistantVisibility` :240, search params :719+,
  rail props :1865).
- `components/assistant/AssistantRail.tsx` (`suggestions` :223, rendered :1088-1108).
- New `lib/pendingCarriedAsks.ts` (pattern `lib/pendingPlaybookAdd.ts`). Test beside it.
- `components/home/NewTripWizard.tsx` — accept a prefill.
- e2e: new `apps/web/e2e/m56-into-a-new-trip.spec.ts`.

**Preview.** Paid account: New trip → Review → Plan with AI lands on the plan page with the rail
open and a kickoff. Home rail: *"plan me two weeks of food somewhere I haven't been, and add a
mezcal tasting"* → hand-off → picker prefilled → create → the mezcal ask is a chip.
