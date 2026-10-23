# M52 plan — The trip comes with you

Milestone: `docs/milestones/M52-the-trip-comes-with-you.md` (every decision answered 2026-10-23).
ADR-080; ADR-073 and ADR-067 amended. Part 0 is `claude/serene-tesla-quoyte` (prose only, merges
last). Migration `0062` is part 3's. Deleted at gate close.

**Every part targets `main` and branches from `main`.** A part with a *Needs* line waits for those
parts to merge, then branches from the new `main`.

| Wave | Parts |
|---|---|
| 1 | 1, 2, 3 (no dependencies) |
| 2 | 4 (needs 1), 5 (needs 1), 6 (needs 1, 3) |
| 3 | 7 (needs 1, 2, 4), 8 (needs 4) |
| 4 | 9 (needs 7, 8), 10 (no dependencies; added 2026-10-23) |

## Constraints the survey found (read before building)

- **Client code may not import `@tc/domain`** (`apps/web/eslint.config.mjs:161-166`). `packages/pages`
  imports only contracts and is importable everywhere, and holds the only zone helper
  (`packages/pages/src/clock.ts:37`, `clockIn`, `offsetMinutes`, `noonIn`). So **`tripNow` lives in
  `packages/pages`**, not `packages/domain` (ADR-080 decision 2 says so).
- **Page context is not editable through events** (`EditPage`/`PageEdited` carry no `context`,
  `packages/contracts/src/pageEvents.ts:83,133`). M52 needs no control for it, so `dateScope` is set
  when the template is instantiated and restored by a reset. Do not add an edit path.
- **`narrow` turns a day it cannot find into `unbound("day")`** (`packages/pages/src/select.ts:187`),
  which is not an empty state. "Today, off the trip" needs its own *no day* result.
- **`instantiateMissingDefaults` would re-add a deleted seed** under its old id. "Not again after a
  delete" needs a check against the page's history (`genesisOf(history)`,
  `apps/web/src/server/pageCommands.ts:426`). `addMissingDefaultPages` commits as owner (`:455`).
- **Reader role, AI entitlement and chat visibility are not in `WidgetContext`.** They live in the
  app (`lib/useAiEntitled.ts`, `hasChat` at `components/board/TripBoardScreen.tsx:271`,
  `server/chat/access.ts:36`).
- **No e2e spec freezes the clock yet.** Use Playwright's `page.clock`. `apps/web/src/lib/seedDate.ts`
  dates fixtures relative to today.

## Part 1 — `tripNow` and Home's badge · `claude/m52-part1-trip-now`

Theme: one pure answer to *where are we in this trip now* (decisions 12, 19; ADR-080 §1-3).

- `packages/pages/src/now.ts` — new — `tripNow(trip, globals, now) → { phase, dayId, current,
  next }`, phases `planning | soon | underway | ended`, `SOON_DAYS = 3`. Reuse `clock.ts`.
  Test: `packages/pages/src/now.test.ts` plus a `fast-check` property (day zones, device zone,
  clock times; midnight, a day with no zone, a flight landing in another zone). Seen red with the
  zone conversion removed. Neighbour property tests: `packages/domain/test/dates.property.test.ts`.
- `packages/pages/src/index.ts` — edit — export.
- `apps/web/src/components/home/NextTripHero.tsx:230` — edit — the badge reads the phase: "Day 3
  of 7" under way, "Flight in 2 days, 7 h" when *soon* and a flight exists (else the date
  countdown), "Next trip" otherwise. Countdown at `:109-122`, globals fetch via
  `lib/apiClient.ts:1149` `fetchTripGlobals`. Test: `NextTripHero.test.tsx`.
- Reuse: `lib/homeTripOrder.ts:18,52,69`, `packages/pages/src/format.ts:90` `formatCountdown`,
  `lib/today.ts:19`.

Preview: Home with a trip dated today shows "Day 1 of N"; one starting in 2 days shows the
countdown.

## Part 2 — Flight number and Directions · `claude/m52-part2-flight-number-directions`

Theme: a flight leg carries its flight number, and every placed stop links to directions
(decisions 5 as amended, 16).

- Contract: `packages/contracts/src/activity.ts:300` `KIND_DETAIL_FIELDS`, `:629` `ActivitySnapshot`,
  `:398` `AddActivity`, `:451` `UpdateActivity`; `packages/contracts/src/detail.ts:54`
  `ActivityView`. Follow the `pendingReason` trail (ADR-055). Test: new
  `packages/contracts/test/m52-flight-number.test.ts`, modelled on `adr055-pending-reason.test.ts`.
- Domain: `packages/domain/src/trip/decide.ts:296,310`, `evolve.ts:90,109`, `equality.ts:116`,
  `diff.ts:125,153`, `hydrate.ts:49`, `detail.ts:54`. Test: new
  `packages/domain/test/m52-flight-number.test.ts` (**a trip replayed from a log written before
  `flightNumber` equals its stored projection**, a gate box), plus `hydrate.property.test.ts`.
- `packages/factories/src/trip.ts` — factory defaults.
- Editor and card: `apps/web/src/components/board/ActivityEditor.tsx:370,475` (field shown on a
  flight leg, labelled *Flight number*), `activityCommands.ts`, `RiverBlock.tsx:95` `riverLook`.
  Tests: `ActivityEditor.test.tsx`, `activityCommands.test.ts`, `DayRiver.test.tsx`.
- Carriers of `pendingReason` to extend alike: `server/cloneTrip.ts`, `server/savedDays.ts`,
  `server/assistant/tools/planning.ts`, `tools/read.ts`, `server/ai/writeTools.ts`.
- Public API: `app/api/v1/trips/[tripId]/activities/route.ts:28`, `[activityId]/route.ts`,
  `server/public-api/openapi.ts`, `app/api/v1/openapi.json` (bump `info.version`). Tests:
  `openapi.test.ts`, `conformance.test.ts`.
- Export: `packages/fixtures/src/bundle/schema.ts:78`, `fromTrip.ts:87,149`, `toCommands.ts:58`.
  Tests: `fromTrip.test.ts`, `schema.test.ts`.
- Directions: new `apps/web/src/lib/directions.ts` — `directionsUrl(location, mode?)`, Google Maps'
  `https://www.google.com/maps/dir/?api=1&destination=…`, name and address at `city` precision,
  `travelmode` from a leading transit leg. Reuse `lib/place.ts:37,53,116`, `lib/travelMode.ts:9`.
  Test: `directions.test.ts`. Link on the stop sheet:
  `components/trip/editor/ActivityEditorSheet.tsx:38,59` (`ActivityEditorSheet.test.tsx`).
- `docs/contracts/CHANGELOG.md` — top entry for `flightNumber`.

Preview: add a flight leg with a flight number; it shows on the card. Open a placed stop; tap
Directions.

## Part 3 — `@assistant` in the chat, server side · `claude/m52-part3-chat-assistant-server`

Theme: a chat message can start an assistant turn on the asker's plan and quota, and only the
asker can accept what it proposes (decisions 8, 18; ADR-073 and ADR-067 amendments).

- Migration `apps/web/drizzle/0062_*.sql` + `drizzle/meta`: `trip_messages.kind`
  (`member | assistant | system`, default `member`), `trip_messages.requested_by` (nullable);
  `trip_suggestions.requested_by` (nullable). Schema: `server/db/schema.ts:553` `tripMessages`,
  `:709` `tripSuggestions`.
- `packages/contracts/src/chat.ts:36,51,58` — `ChatMessage` gains `kind`, `requestedBy`;
  `PostChatMessage` gains the `@assistant` target. Changelog entry.
- `server/chat/messages.ts:106` `postMessage`; `app/api/trips/[tripId]/chat/route.ts:26` `POST`:
  an `@assistant` message starts a turn. Entitlement by the asker's plan (`ai.ask` answers,
  `ai.command` proposals; `server/assistant/entitlements.ts`, `admission.ts:1519`
  `evaluateAiGrant`); refused while the chat is read-only. Reuse the ask turn from
  `server/ai/handleAskRequest.ts:289` and proposal storage from `suggestProposal.ts:87`; the
  reply is posted whole as a `kind: assistant` message.
- `read_chat`: new `server/assistant/tools/chat.ts` + `chat.test.ts`; `server/assistant/limits.ts:68`
  gains `CHAT_CONTEXT_MESSAGES = 20` and `MAX_CHAT_MESSAGES_READ`. Offered **only** on a
  chat-started turn (`admission.ts:1287-1329` `toolsFor`, `handleAskRequest.ts:788`
  `activeTools`). Test the default and ceiling are read from `limits.ts`.
- Accept rule: `server/suggestions/accept.ts:48,57` and `resolve.ts:38` — a suggestion with
  `requested_by` is accepted or dismissed only by that member (still an editor). The trip owner may
  always dismiss one (Mitchell, 2026-10-23).
- Quota and ledger: `server/quota.ts:156,238` against the asker; `server/assistant/ledger.ts`.
- Tests: `chat.int.test.ts`, `suggestions.int.test.ts` (**another editor refused, the asker
  accepted**), `quota.int.test.ts` (**a free member's `@assistant` spends nothing; a paid asker's
  turn is recorded against the asker**), `admission.test.ts`.
- Eval: a chat case whose problem is stated only in earlier messages, so it must call `read_chat`
  (`server/ai/eval/cases.ts`, `live-set.json`, `grade.test.ts`, `simulatedModel.ts`).

Preview: none on its own (the UI is part 6); the API is exercised by the integration tests.

## Part 4 — The notebook `dateScope` · `claude/m52-part4-date-scope` · Needs 1

Theme: a page setting every widget reads through one resolver (decision 10; ADR-080 §4).

- `packages/contracts/src/pages.ts:257` `PageContext` gains `dateScope: "all" | "today" | { date }`,
  default `"all"`. Test beside its neighbours in `packages/contracts/test/`. Changelog entry.
- `packages/domain/src/trip/pageState.ts:174` `pageStatesEqual` compares it
  (`packages/domain/test/pageState.test.ts`).
- Resolver: new `packages/pages/src/dateScope.ts` — `resolveDateScope(context, trip, globals, now)
  → ItemScope | "no-day" | undefined`, reading `tripNow`. Test `dateScope.test.ts`.
- `packages/pages/src/registry-types.ts:466,499,565` — `WidgetContext` gains `now`; `ItemScope`.
- `packages/pages/src/select.ts:180,335` `narrow`/`scoped` — a *no day* scope yields the widget's
  empty state, not `unbound`. Tests `select.test.ts`, `repeat.test.ts`.
- `packages/pages/src/registry.ts:127` `renderMacro(ctx, …, item)` receives the resolved scope.
- Render sites: `components/pages/MacroView.tsx:57,68`, `editor/RepeatNodeView.tsx:69-74`,
  `editor/MacroEditorContext.tsx:16` (provider `PageEditor.tsx:323`),
  `components/access/previewContext.ts:27`. Tests `MacroView.test.tsx`, `RepeatNodeView.test.tsx`.
- `components/pages/WidgetPicker.tsx:243,284` — *follows today* on a widget the page will scope
  (`WidgetPicker.test.tsx`).
- Gate box: **on a page with `dateScope: "today"`, an unbound `day.detail` shows today and one bound
  to day 1 still shows day 1**, seen red with the scope removed.

Preview: none until part 9 seeds a page with the setting; the tests carry it.

## Part 5 — The assistant knows *now* · `claude/m52-part5-assistant-now` · Needs 1

Theme: decisions 13 and 14.

- `server/assistant/context.ts:142` — a *now* line beside `clockTimesLine`, on under-way turns
  only, from `tripNow` (`context.test.ts`).
- `server/ai/handleAskRequest.ts:339` `clock`, `:774` `instructionsFor`, `:463` `offeredNames`,
  `:788` `activeTools`; `server/assistant/admission.ts:1287-1329` `toolsFor`, `grants.ts:269`.
- `find_places_near_now`: `server/assistant/tools/places.ts:145,196` beside `searchPlacesTool`,
  added to `PLACE_TOOLS`; registry `server/assistant/registry.ts:59`. Anchor order: current
  stop, last passed stop today, next stop, the day's city; it returns the anchor.
- Ask turns check `ai.command` before proposing (Mitchell, 2026-10-23): a plan holding `ai.ask`
  alone (Studio) gets answers only on the Ask tab, as part 3 does for chat turns. Test in
  `admission.test.ts` / the ask route test, seen red first.
- Gate box: **offered only while under way** — a test of the offered tools for a planning trip
  and an under-way trip (`admission.test.ts`). (Part 3 covers `read_chat` on Ask vs chat turns.)
- Evals: a day-of case that must choose `find_places_near_now`, a planning case that must not see
  it, a "45 minutes late" case (one Accept-all of `UpdateActivity` time moves) and a "closed, find
  something similar" case (`server/ai/eval/cases.ts`, `live-set.json`, `grade.test.ts`,
  `simulatedModel.ts`). The live eval is run only with Mitchell's go-ahead.

Preview: on a trip dated today, ask "find coffee near here"; the answer names its anchor.

## Part 6 — `@assistant` in the chat, the UI, and change lines · `claude/m52-part6-chat-assistant-ui` · Needs 1, 3

Theme: decisions 17 and 18, as seen in the thread.

- `components/chat/TargetPicker.tsx:32,65` — `@assistant` entry; for a reader without the plan,
  the offer *"Asking the assistant in chat comes with Plus"* and an upgrade link (copy pattern
  `AssistantRail.tsx:71` `UPGRADE_LEAD`). Test `TargetPicker.test.tsx`.
- `components/chat/ChatMessage.tsx:38` — assistant and system messages; the proposal card via
  `components/assistant/ProposalCard.tsx:105,206`, accept/dismiss for the asker only, *"Waiting on
  <name>"* for others. Test `ChatMessage.test.tsx`.
- `components/chat/ChatPanel.tsx:34` — *"Assistant is thinking…"*; `useTripChat.ts:84`. Tests
  `ChatPanel.test.tsx`, `useTripChat.test.tsx`.
- Change lines (decision 17): after `executeTripCommandBatch` in `server/suggestions/accept.ts:131`
  and `resolve.ts:114`, and Ask's apply at `handleAskRequest.ts:1671`
  `handleApplyProposalRequest`, post a `kind: system` line through `postMessage` when the trip is
  under way and the change touches today's or tomorrow's stops. Tests `suggestions.int.test.ts`,
  `chat.int.test.ts`.

Preview: with two accounts on a trip dated today, `@assistant push dinner back an hour`; the asker
accepts, the other sees *Waiting on* and then the change line.

## Part 7 — Widgets: Now and next, Directions, Flights · `claude/m52-part7-day-widgets` · Needs 1, 2, 4

Theme: decision 15's first three widgets. Each has a written empty-today state.

- `packages/pages/src/presets.ts:105` `PRESETS` (patterns `:173` `trip.countdown`, `:572` `weather`);
  `presets.test.ts`.
- New defs in `packages/pages/src/macros/primitives/` with `.test.ts` beside, registered in
  `registry.ts:41` `DEFS`; payloads in `registry-types.ts:130` `BlockPayload`; rendered in
  `apps/web/src/components/pages/BlockView.tsx:98` with new `blocks/*Block.tsx` + tests. The
  weather widget is the end-to-end model (`macros/primitives/weather.ts:271` → `BlockView` →
  `blocks/WeatherBlock.tsx`).
  - `trip.now` *Now and next*: current and next stop, time until it, Directions; re-renders each
    minute while visible; reads `ctx.now`.
  - `stop.directions` *Directions*: the bound stop, or *next* under `dateScope: "today"`; uses part
    2's `directionsUrl`.
  - `trip.flights` *Your flights*: today's flights or the next one, flight number, times in each
    end's zone, the countdown; *Add your flight* opens the stop editor prefilled as a flight.
- Tapping a stop focuses it (`components/chat/boardFocus.ts:56` `useBoardFocus`).

Preview: add each widget to a notebook on a trip dated today, and on one dated next month.

## Part 8 — Widgets: Group chat and Ask · `claude/m52-part8-chat-ask-widgets` · Needs 4

Theme: decision 15's last two widgets and decision 20's share-link rule.

- `WidgetContext` gains reader capabilities (`canChat`, `canAsk`), filled where the context is
  built (part 4's render sites) from `lib/useAiEntitled.ts` and `hasChat`
  (`TripBoardScreen.tsx:271`); absent for a share-link reader.
- `chat.recent` *Group chat*: the last three messages and *Open chat*; absent when `canChat` is
  false.
- `assistant.prompts` *Ask*: *Running late*, *Move dinner later*, *Something closed*; each calls
  `usePhoneAsk().onAsk(text)` (`components/nav/phoneAsk.ts:68` → `TripBoardScreen.tsx:321-327` →
  `AssistantRail.tsx:809-823`); absent when `canAsk` is false (SPEC §27).
- Same files as part 7 for presets, defs, payloads and blocks, with tests.

Preview: the widgets on a notebook as a paid member, a free member, and via a share link.

## Part 9 — *During the trip*, the swap, and the e2e · `claude/m52-part9-during-the-trip` · Needs 7, 8

Theme: decisions 9, 11, 20 and the walk.

- Template: `packages/pages/src/templates.ts:252` (pattern `beforeYouGo`), `:492`
  `TEMPLATE_LIBRARY`, `:515` `DEFAULT_TEMPLATES`; seed key `during-the-trip`,
  `seedIntoNewTrips: true`, `dateScope: "today"`, the sketch's seven blocks.
  `content/notebooks/built-in-notebooks.json`. `templates.test.ts` (:29, :85, :159 move; the
  harness at :213-297 renders the page with a clock before and after the trip — **every widget
  renders its empty-today state**, seen red with one removed).
- Existing trips: `app/api/trips/[tripId]/pages/route.ts:9` → `server/tripViews.ts:116`
  `tripPagesView` → `server/pageCommands.ts:455` `addMissingDefaultPages(…, only:
  "during-the-trip")`, skipped if the page's history shows it was deleted (`:426`). Demo fold
  `server/pages.ts:136`; MSW `mocks/handlers.ts:738`. Test `server/defaultNotebooks.int.test.ts`
  (**seeded on a new trip; gained once by an existing one; not again after a delete**).
- **Undeletable (Mitchell, 2026-10-23, decision 9 amendment):** like Overview — extend the
  `page-undeletable` rule (`packages/domain/src/trip/pageState.ts:357`, `pageCommands.ts:316`)
  to this seed key; the index's delete control is absent for it; the existing-trip backfill drops
  the "not again after a delete" skip. Title/seed key per the amendment (proposed *Today* /
  `today`). Tests: delete refused (domain + route), backfill on an existing trip.
- Swap: `apps/web/src/lib/overviewPage.ts:16` `pickOverviewPage` swaps for `soon` and `underway`;
  *Whole trip →* link to the usual Overview. Callers `components/lenses/OverviewLens.tsx:160,226`,
  `server/tripFirstData.ts:46`. Tests: new `lib/overviewPage.test.ts` (planning, soon, under way,
  ended), `OverviewLens.test.tsx`, `tripFirstData.int.test.ts`.
- E2E: new `apps/web/e2e/m52-during-the-trip.spec.ts` (copy from `m39-phone-overview.spec.ts`,
  `m46-trip-chat.spec.ts`, `m10-simulated-ai.spec.ts`), clock frozen mid-day with `page.clock`:
  Overview shows *During the trip* with Now and Next; Directions has the right link;
  `@assistant push dinner back an hour` posts a reply and a card the asker accepts. Proven on
  `pnpm --filter web test:e2e:ci-like e2e/m52-during-the-trip.spec.ts`.

Preview: the gate's walk — open a trip dated today from Home on a phone, tap Directions, ask
`@assistant` to find lunch nearby, accept as the asker, see the change line from a second account.

## Part 10 — The trip under way over the API · `claude/m52-part10-api-today` · No dependencies

Theme: decision 21 (added by Mitchell 2026-10-23). Follow `docs/guidelines/using-the-api.md`,
*For somebody adding an endpoint*: a route declaration, nothing hand-written for auth, errors,
pagination or the reference.

- `GET /v1/trips?active=true`: a filter on the existing list route
  (`apps/web/src/app/api/v1/trips/route.ts`); active means part 1's `tripNow` phase is
  `underway` (`packages/pages/src/now.ts`), with ADR-080's zone fallback. Pagination and the
  cursor are unchanged; `active=false` or absent means today's behaviour.
- `GET /v1/trips/{tripId}/today`: new route beside the trip routes; `trips:read`, `viewer`.
  Answers `{ date, timeZone, phase, dayId | null, stops: [...], now: stopId | null, next: stopId | null }`;
  stops reuse the API's existing stop schema; `now`/`next` come from `tripNow`, never a second
  computation. Optional `?timeZone=` (IANA, validated, never stored) is the asker zone. Off a trip
  day: 200, `dayId: null`, `stops: []`.
- OpenAPI: minor bump of `API_VERSION` with the new fingerprint (`openapi.test.ts`), a line in
  `docs/contracts/CHANGELOG.md`, and a section in `docs/guidelines/using-the-api.md`.
- Tests: an integration test beside the existing v1 trip route tests: under way listed; planning,
  *soon*, ended and undated not; a trip in UTC+13 active when UTC is still the day before;
  `/today` now/next equal `tripNow` at a frozen clock; a viewer answered; a non-member refused
  as the API refuses one elsewhere. Seen red with the filter removed and with `now` hard-coded.

Preview: with a token, `curl …/api/v1/trips?active=true` on a trip dated today, then its `/today`.
