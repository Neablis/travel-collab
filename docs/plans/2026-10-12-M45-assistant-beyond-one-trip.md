# M45 plan — the assistant answers about all your trips, and can take you places

Milestone: `docs/milestones/M45-the-assistant-beyond-one-trip.md` (decisions D1–D8, answered
2026-10-12). ADR: `docs/architecture/ADR-072-the-assistant-runs-palette-commands.md`.
Part 0 is the prose-only tracking PR on `claude/stoic-dijkstra-01wxup`; it merges last.
Deleted at gate close (`docs/plans/README.md`).

Paths are relative to `apps/web/src/` unless they start with `packages/`, `apps/` or `docs/`.
Line numbers are from `main` at `de46773`, so treat them as a starting point, not as fact.

## Order

| Part | Branch | Depends on | Can run beside |
|---|---|---|---|
| 1 Palette | `claude/m45-part1-palette-notebooks` | — | 3 |
| 3 Account backend | `claude/m45-part3-account-ask` | — | 1 |
| 2 Client actions | `claude/m45-part2-assistant-runs-commands` | 1 merged | 3 |
| 4 Home rail and Ask: | `claude/m45-part4-home-rail` | 2 and 3 merged | — |

Every part targets `main`. A part that depends on another branches from `main` after that part
has merged.

Facts the parts share:
- The next migration would be `0048`, but **none is planned**. `ai_usage.endpoint` is unchecked
  text (`server/db/schema.ts:1150`), so the new surface is the value `"ask.account"`
  (`server/assistant/ledger.ts:91`).
- The trip page reads `?view=<View>` for every view. `?lens=` maps only Map, Board and Schedule
  (`components/trip/context/LensRouter.tsx:66-74`).
- e2e drives the simulated model by phrase (`server/ai/simulatedModel.ts`, `askTurn` ~:955,
  `classifyStep` ~:740). Every new behaviour needs a phrase branch and a
  `simulatedModel.test.ts` case, or e2e cannot reach it.

## Part 1 — the palette learns notebooks, and can run a command by id (~8 files)

**Theme.** D4's "added to the palette first", and ADR-072 §2 and §6. This part adds no assistant
code.

| File | Entry point | Change | Test |
|---|---|---|---|
| `components/palette/paletteRegistry.ts` | `PaletteType` :27, `snapshot` :61 | `"Notebook"` type; non-hook `findPaletteCommand(id)` / `runPaletteCommand(id)` over registered commands | new `components/palette/paletteRegistry.test.ts` |
| `components/palette/commands.ts` | `placeCommands` :79 | `goToNotebookCommands` (`go:notebook:<pageId>`), `notebookEditingCommand` (id `notebook-editing`), and `go:trip:<id>` optionally landing on `?view=` | `components/palette/commands.test.ts` |
| `components/palette/grammar.ts` | `pathOf` :42 | Notebook type in the grammar and aliases | `components/palette/CommandPalette.test.tsx` |
| `components/pages/PageScreen.tsx` | `toggleEditing` ~:1053, `mayToggleEditing` ~:346 | register *Edit › Notebook › Turn editing on/off* via `usePaletteSource`; the run **is** `toggleEditing` (ADR-068 §2) | `components/pages/PageScreen.test.tsx` |
| `components/board/TripBoardScreen.tsx` (or `components/trip/TripHeader.tsx:199`) | `usePaletteSource("trip-board")` ~:281 | fetch the trip's notebooks and register *Go to › Notebook › <name>* | `components/board/TripBoardScreen.test.tsx` |
| `components/palette/CommandPalette.tsx` | places built at ~:116-123 | `go:trip:*` and `go:home` are built in memory, so expose them to `findPaletteCommand` too (survey risk 3) | `CommandPalette.test.tsx` |
| `docs/architecture/ADR-069-the-palettes-grammar.md` | scope table :66-72 | add the Notebook rows | — |
| e2e | `apps/web/e2e/m41-command-palette.spec.ts` | ⌘K › Go to › Notebook opens it; Edit › Notebook toggles editing | itself |

**Preview walk:** in a trip, press ⌘K, type *notebook*, open one. Inside it, press ⌘K and run
*Edit › Notebook › Turn editing on*. Then from Home, run ⌘K › Go to › Trip and land on it.

## Part 2 — the assistant names palette commands (~12 files)

**Theme.** D4 and D5, ADR-072 §1, §3, §4 and §5. Trip and notebook surfaces only; Home is part 4.

| File | Entry point | Change | Test |
|---|---|---|---|
| `packages/contracts/src/assistant.ts` | `AskStreamShape` :253, `OUTCOME_KEYS` :319, one-outcome rule :341 | `paletteCommands?: { id, needsApproval }[]` as a **sibling key outside `OUTCOME_KEYS`**, so it can ride with a reply or a proposal | `packages/contracts/test/ask-stream-envelope.test.ts` |
| new `server/assistant/tools/navigate.ts` | `defineTool` | `go_to` (view, day, stop, notebook, people, trip with view) and `propose_notebook_editing`; a server **allowlist** of exact ids and prefixes (ids aren't namespaced: `people`, `settings`, survey risk 4) | new `server/assistant/tools/navigate.test.ts` |
| `server/assistant/deps.ts` | `AssistantDeps` :540 | a per-turn command buffer | via tool tests |
| `server/assistant/registry.ts` / `grants.ts` | `ASSISTANT_TOOLS` :56, `SURFACES` :59 | register and grant on trip/day/page | `registry.test.ts`, `grants.test.ts` |
| `server/ai/handleAskRequest.ts` | messageMetadata ~:991-1001 | emit the buffered ids | `app/api/trips/[tripId]/ask/route.int.test.ts` |
| `server/ai/simulatedModel.ts` | `askTurn` ~:955 | phrase branch, e.g. *"show this on the map"*, *"open the packing notebook"*, *"turn on editing"* | `server/ai/simulatedModel.test.ts` |
| `lib/apiClient.ts` | `AskEvent` :1494, `askEventFromFrame` :1585 | `{ type: "palette", commands }`; parsing **drops any value that is not an allowlisted id**, URLs included | `lib/apiClient.test.ts` (seen red with free URLs allowed) |
| `components/assistant/useAskThread.ts` | `onEvent` :107/:357 | hand commands to the page's runner | `useAskThread.persistence.test.tsx` |
| runner (new `components/assistant/runPaletteCommands.ts`) | — | navigation calls `runPaletteCommand(id)`; an id the page does not offer is a visible "I couldn't …" note; a command that leaves the page waits while a proposal card is undecided, and says so (`useAskThread` reads the thread) | new unit test asserting the run **is** the registered command's `run` |
| `components/assistant/ProposalCard.tsx`, `Transcript.tsx` | `proposalWords` :79, :33 | a card variant for a command needing Approve (it's typed on `AssistantProposal` today) | `ProposalCard.test.tsx`, `Transcript.test.tsx` |
| e2e | extend `apps/web/e2e/m16-assistant.spec.ts` | ask *"show this on the map"*, see Map; ask to turn on editing, Approve, see edit mode | itself |

**Preview walk:** in a trip, ask *"show me day 2 on the map"*. In a notebook, ask *"turn on
editing"*, see the Approve card, approve it.

## Part 3 — an account-scoped ask, with deterministic cross-trip tools (~16 files)

**Theme.** D1–D3 and D8, the ledger and the eval. It has no UI beyond what the route returns.

| File | Entry point | Change | Test |
|---|---|---|---|
| new `packages/domain/src/trip/acrossTrips.ts` | — | `spendByCategory` (category = activity tag, ADR-070), `placesVisited`, `visitCounts`, `suggestNextCountry`; reuse `countriesOfStops`/`citiesOfStops` (`cities.ts:83,:112`) and `rollupCosts` (`costs.ts:16`); unknown is counted, never guessed | new `packages/domain/test/acrossTrips.test.ts` (fixture of several trips, **one the user is not travelling on**, each test seen red) |
| new static country list in `packages/domain` | — | ISO alpha-2 list, the only new data (D3) | in the same test |
| `packages/domain/src/index.ts` | — | export | — |
| new `server/assistant/tools/acrossTrips.ts` | model on `findFreeTimeTool` (`read.ts:1345`) | four read tools | new `acrossTrips.test.ts` |
| `server/assistant/deps.ts` | `trip: TripDetail` required :548, `AMBIENT_DEP_KEYS` :596 | a `trips` port for account turns, built from `listTripSummariesVisibleTo` (`server/projections.ts:508`) filtered by `travellingByTrip` (`server/access/members.ts:166`) | tool tests |
| `server/assistant/context.ts` | `AskScope` :43, `parseAskScope` :72, `AiSurface` :27 | `{ kind: "account" }` | `context.test.ts` |
| `server/assistant/grants.ts` / `intents.ts` | `SurfaceKind` :32, `SURFACE_INTENTS` :52 | an `account` row: read-only tools plus `go_to`'s `go:trip:` (once part 2 lands, else a follow-up) | `grants.test.ts`, `intents.test.ts` |
| `server/ai/askIntent.ts` | `ClassifierSurface` :102/:500 | `account` | `askIntent.test.ts` |
| new `app/api/ask/route.ts` | mirrors `app/api/trips/[tripId]/ask/route.ts` | an account route. `handleAskRequest` (:265) is trip-shaped (`refuseDemoTrip` :660, `resolveSurface` :788); take a `tripId: null` path or a sibling handler, at the builder's judgement, but **one admission path** (`evaluateAiGrant`, `admission.ts:1374`; audit records carry `tripId` :1400/:1424) | new `app/api/ask/route.int.test.ts`, `admission.test.ts` |
| `server/assistant/ledger.ts` | `endpoint` union :91 | `"ask.account"` | `ledger.test.ts` |
| `server/ai/simulatedModel.ts` | `askQuestions` :260 | account turns call the new tools, never `read_trip` (`NoSuchToolError`) | `simulatedModel.test.ts` |
| `server/ai/eval/trips.ts`, `cases.ts`, `live-set.json`, `live.eval.ts` | `EVAL_TRIPS` :11, `expectationFor` :50, :120-124, :153 | a multi-trip fixture, the four example questions as new cases (added, never edited), and an account branch in the runner | `eval/replay.int.test.ts` |

**The live eval is not run by the builder.** It costs money and needs Mitchell's go-ahead.

**Preview walk:** none visible yet. `curl` the route with a session cookie and see *"which city
have I been to most"* answered.

## Part 4 — Home's assistant rail, and ⌘K's *Ask:* row (~10 files)

**Theme.** D6 and D7, the walk's surface.

| File | Entry point | Change | Test |
|---|---|---|---|
| `app/(app)/page.tsx` | `Home` :55, `PageContainer` :533, palette :470 | an **always-visible** rail (new behaviour: the trip page's rail is opt-in, `useAssistantVisibility` false by default, `TripBoardScreen.tsx:116-119`) and `usePhoneAskEntry` | `app/(app)/page.test.tsx` |
| `components/assistant/AssistantRail.tsx` | :166, copy `TRIP_EMPTY_HINT` | account scope and its own empty hint | `AssistantRail.test.tsx` |
| `components/assistant/useAskThread.ts`, `askThreadStore.ts`, `lib/apiClient.ts` | `tripId: string` :104/:112, `askAssistant` :1692-1700 | an account variant posting to `/api/ask`, with its own thread key | `lib/apiClient.test.ts`, `useAskThread.persistence.test.tsx` |
| `components/palette/CommandPalette.tsx` | *No match* :275, comment :38, `usePhoneAsk()` :76 | the *Ask: <text>* last row | `CommandPalette.test.tsx` |
| `components/nav/phoneAsk.ts` | `PhoneAskEntry.onOpen` :21 | `onAsk(text)`, so ⌘K can send the text, not only open | its test |
| `components/nav/PhoneTabBar.tsx` | :408 | the Ask tab on Home once Home registers | `PhoneTabBar.test.tsx` |
| e2e | new `apps/web/e2e/m45-home-assistant.spec.ts`, modelled on `m16-assistant.spec.ts` and `m16-mobile-assistant.spec.ts`; waits on `/\/api\/ask$/` | ask *"which city have I been to most"*; ask *"open my Kyoto trip on the map"* and land on Map; ⌘K → *Ask: …* | itself |

**Preview walk (the gate's [walk] box):** on Home, the rail is there. Ask *"which city have I
been to most"*, then *"open my Kyoto trip on the map"*. In ⌘K, type a question and choose
*Ask: …*.

## Gate close (part 0)

Tick the boxes from CI on the merged parts. Paste the M33 eval run's numbers into the milestone
(only after Mitchell approves the spend), and the `ai-usage` skill's cost per turn for
`ask.account`. Write the retro, run `pnpm milestone close M45`, and delete this plan.
