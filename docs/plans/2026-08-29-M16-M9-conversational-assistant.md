# M16 + M9 — the assistant you can hold a conversation with

**Plan date:** 2026-08-29
**Milestones:** `docs/milestones/M16-assistant-read-agent.md`,
`docs/milestones/M9-ai-planning-partner.md`
**Binding ADRs:** ADR-022 (read-only agent, tool rule, command path untouched),
ADR-019 + its 2026-08-25 amendment (kill-switch chokepoint), ADR-015 (derived
tools), ADR-013 (atomic batches).

**Asked for by Mitchell, 2026-08-29, overnight and unattended:**

> I want to come back in the morning and be able to plan a trip with the AI
> assistant from start to finish. I should be able to have a discussion, see the
> discussion in the sidebar, and have a multiturn conversation. Build out the
> framework to expose api endpoints to the api agent, correctly pass the
> relevant context from a page, and generate the correct support questions in
> the sidebar to initiate a conversation.

That request spans both milestones. M16 owns the read agent, the rail and the
kill-switch chokepoint; M9 owns the thread, streaming, write tools and
approval. This plan executes them as one branch because the user-visible
deliverable — *a conversation that plans a trip* — is not testable until both
halves exist. Milestone bookkeeping stays separate: **neither gate closes in
this plan** (see "What this plan does not do").

---

## Global Constraints

Binding on every task. A reviewer reads this section as its attention lens.

1. **The command path is not modified.** `handleAiRequest.ts`,
   `batchResolver.ts`, `planSummary.ts`, `geocodeEnrichment.ts` and
   `pageTools.ts` keep their current behaviour. ADR-022 §4. The one permitted
   edit to `handleAiRequest.ts` is its call site for `selectAiModel`, which
   Task 1 changes signature-compatibly.
2. **Every model call goes through `selectAiModel()`.** No second gateway
   construction, no second flag read. Enforced by lint in Task 1.
3. **No read or write tool takes a `tripId` parameter.** Trip and actor
   identity arrive through `toolsContext` / `contextSchema`. ADR-022 §3 — the
   constraint is structural, not prompted.
4. **A tool is earned by a computation or a capability boundary, never by a new
   phrasing of a question.** ADR-022 §1. New questions land on existing tools as
   typed parameters.
5. **Computations live in `packages/domain`, tools are thin wrappers.**
   ADR-022 §2.
6. **No database migration in this plan.** A migration needs an explicit
   production dispatch that nobody is awake to run
   (`docs/guidelines/environments-and-deploys.md`), and an undispatched
   migration is schema drift waiting to happen. This is why conversation state
   is client-held — see Ruling R1.
7. **The architecture walls hold.** `packages/domain` imports nothing from
   `apps/web`; UI never imports `@/server/*`. `AGENTS.md` is binding and
   outranks this plan.
8. **Money is integer minor units.** Never decimals, anywhere.
9. **Definition of Done applies per task** (`AGENTS.md`): new domain logic gets
   unit tests, new endpoints get contract + integration tests. An e2e verdict
   counts only from `pnpm --filter web test:e2e:ci-like`.
10. **`pnpm check` is a false green for integration — KI-76.** Run
    `pnpm --filter web test:int` directly and report its real output.

---

## Rulings made without Mitchell

Recorded here because they were decided while he was asleep. Each says what it
costs if wrong.

**R1 — Conversation state is client-held, not a database table.**
The thread is posted with each turn as a `messages` array and validated
server-side against a cap. M9's file says "conversation persisted so a refine
turn has something to refine"; a `messages` array satisfies the refine turn,
which is the functional requirement, without a migration (Constraint 6).
*Cost if wrong:* the conversation does not survive a page reload, and adding
durability later is a table plus a migration — additive, no rework of the
agent or the UI.

**R2 — One conversational endpoint, `/ask`, carrying read tools and — behind
approval — write tools.**
ADR-022 put `/ask` beside `/ai` and left `/ai` untouched; M9's write tools
"wrap that pipeline from inside the agent". A second write endpoint would be a
third AI entry point and a third place the kill switch has to cover.
*Cost if wrong:* `/ask` is doing two jobs; splitting it later is a route file
and a tool-set parameter, not a redesign.

**R3 — Approval uses AI SDK v7 `toolApproval: 'user-approval'`, as ADR-022
directs.** If that API cannot express server-side batch commit within this
plan, the pre-authorised fallback is: the write tools stay collect-only (as
`planningTools` already is), the turn returns a **proposal** (resolved commands
+ `summarizeBatch` text) and the client posts approval to commit. That is
option (b) from `TODO.md`'s captured directions.
*Cost if wrong:* the fallback is the shape M9's file already contemplates, so
the loss is the ADR's stated preference, not correctness.

**R4 — Streaming is in scope.** `simulatedModel.doStream()` currently throws,
and every Vercel environment runs flag-off, so a non-streaming simulated path
would make the deployed sidebar look broken — the same failure M16's file
already anticipates for the read branch.
*Cost if wrong:* more surface than M16's Wave 2 strictly needed; it is M9 scope
being pulled forward, which this plan does deliberately.

**R5 — Suggested questions are derived from real trip state by a pure
function, never canned and never model-generated.** Mitchell asked for "the
correct support questions… to initiate a conversation"; the current
`PREVIEW_QUICK_ASKS` fixture is the inert thing M16 Wave 1 deletes.
*Cost if wrong:* the derivation rules are a single unit-tested function; tuning
them is editing one file.

---

## Task 1 — The kill switch becomes a chokepoint

Implements ADR-019's 2026-08-25 amendment, which M16 is obligated to carry.
Foundation: Task 3 cannot select a model until this lands.

**Files:** `apps/web/src/server/ai/modelSelection.ts`,
`apps/web/src/server/ai/handleAiRequest.ts` (call site only),
`eslint.config.mjs`, `apps/web/src/server/ai/modelSelection.test.ts`.

**Spec:**

- `selectAiModel()` takes an actor: `selectAiModel({ surface, userId })`.
- It returns a **three-way discriminated union**, not a boolean pair:
  - `{ outcome: "live", model }`
  - `{ outcome: "simulated", model }`
  - `{ outcome: "denied", reason: string }`
- `denied` is typed and **unreachable in production today** — no entitlement
  source exists. It must be exercised by a test anyway (M16's gate requires
  this), via an injected entitlement predicate defaulting to "everyone is
  entitled".
- `denied`'s HTTP contract, defined here and used by Task 3:
  **status `403`**, body `{ error: string, code: "ai-not-entitled" }`.
  403 not 402: 402 asserts a payment relationship that does not exist yet.
- `aiModel()` is still called **only** on the live branch. The existing test
  asserting this must keep passing.
- **Lint wall:** add a `no-restricted-imports` rule to `eslint.config.mjs` so
  `@/server/ai/gateway` is importable **only** from
  `apps/web/src/server/ai/modelSelection.ts`. Follow the existing domain-wall
  and `@/server/*` UI-wall rules in that file — same shape, same comment
  density. A build that imports the gateway anywhere else must fail.
- `handleAiRequest.ts`'s call site is updated to the new signature and to
  branch on `outcome`. Its `denied` branch returns the 403 above. **No other
  behaviour in that file changes** (Constraint 1).

**Tests:** the lint rule fails a fixture import; each of the three outcomes;
`denied` returns 403 with the documented body; the existing "aiModel is not
called when the flag is off" assertion still holds.

---

## Task 2 — `findFreeGaps`, a pure domain function

ADR-022 §2: the computation lives in the domain and is unit-tested with no
server, DB or model in the way.

**Files:** `packages/domain/src/trip/freeTime.ts`,
`packages/domain/src/trip/freeTime.test.ts`, and the package's index export.

**Spec:**

```ts
export interface FreeGap {
  dayIndex: number;
  startMinutes: number;   // minutes from midnight, 0-1440
  endMinutes: number;
  durationMinutes: number;
}

export function findFreeGaps(
  detail: TripDetail,
  options?: {
    dayIndex?: number;      // undefined = every day
    afterMinutes?: number;  // default 0
    beforeMinutes?: number; // default 1440
    minMinutes?: number;    // default 0; gaps shorter than this are dropped
  },
): FreeGap[];
```

Rules, each its own test:

- Activities with **no `timeWindow` do not occupy time** and never create or
  close a gap. They are unscheduled, not all-day.
- **Overlapping activities merge** before gaps are computed — two overlapping
  stops are one busy block, not two, and must not produce a negative gap.
- A day with **no timed activities** is one gap spanning the whole window.
- A day with **no activities at all** is likewise one full-window gap.
- Gaps are returned **sorted by `dayIndex`, then `startMinutes`** — a stable
  order, so a caller reading "the largest gap" gets a deterministic answer on
  ties (first in this order wins).
- `afterMinutes`/`beforeMinutes` **clip** gaps rather than filtering them: a
  busy-free day with `afterMinutes: 1200` yields one gap 1200→1440.
- An activity extending past `beforeMinutes` clips, it does not vanish.
- `minMinutes` is applied **after** clipping.
- Zero-length gaps are never returned.
- Invalid input (`afterMinutes >= beforeMinutes`) returns `[]`, does not throw.

Reuse the existing `TimeWindow` shape and whatever minute-parsing
`packages/domain/src/trip/` already has — read `conflicts.ts` first, which
already does time-overlap arithmetic. **Do not add a second date parser**
(KI-73 is an open issue about exactly that duplication).

---

## Task 3 — The `/ask` endpoint: a streaming, multi-turn, tool-using agent

The framework half of Mitchell's request.

**Files:** `apps/web/src/app/api/trips/[tripId]/ask/route.ts`,
`apps/web/src/server/ai/handleAskRequest.ts`,
`apps/web/src/server/ai/readTools.ts`,
`apps/web/src/server/ai/simulatedModel.ts` (add a read/chat branch + `doStream`),
`apps/web/src/server/ai/askAnalytics.ts`, plus tests including
`apps/web/src/app/api/trips/[tripId]/ask/route.int.test.ts`.

**Spec:**

- `POST /api/trips/[tripId]/ask`, beside the untouched `/ai`. Logic lives in
  `handleAskRequest.ts`, not the route file — same reason `handleAiRequest` does
  (Next.js route-shape validation), and so tests can inject a model.
- Request body:
  ```ts
  {
    messages: UIMessage[],           // the thread; capped, see below
    scope: { kind: "trip" } | { kind: "day", dayIndex: number },
  }
  ```
- **Caps, all enforced server-side with a 400 naming the rule broken:**
  the last user message ≤ **4000 characters** (reuse
  `handleAiRequest`'s `MAX_PROMPT_CHARS` value — extract the constant to a
  shared module rather than duplicating the literal); at most **40 messages**
  in the thread; total serialized body ≤ **128 KB**.
- **Access:** `guard(tripId, "viewer")` for a read-only turn. This differs from
  `/ai`'s `"editor"` deliberately — a viewer may *ask* about a trip they can
  see. The moment a **write tool** is offered, the guard for that turn is
  `"editor"`; a viewer's turn gets the read tool set only. Assert both in
  integration tests.
- **Quota:** reuse `consumeQuota(aiQuotas(), userId)`, charged after validation
  and after model selection, exactly as `handleAiRequest` documents.
- **Model:** `selectAiModel({ surface: "ask", userId })` from Task 1. Add
  `"ask"` to `AiSurface`. `denied` → the 403 from Task 1.
- **Agent:** AI SDK v7 `ToolLoopAgent`, streamed. `stopWhen: isStepCount(8)`
  for a read-only turn. Read the installed types at
  `apps/web/node_modules/ai/dist/index.d.ts` for the exact API — do not guess it.
- **Read tools — exactly three (ADR-022's opening set):**
  | Tool | Input | Returns |
  |---|---|---|
  | `read_trip` | none | name, currency, day count, start date, per-day index/date/stop count/cost subtotal, trip cost total, active conflicts by `ref` |
  | `read_day` | `{ day: number }` (1-based) | that day's stops **with `timeWindow`, `location`, `notes`, `kind`, `tags`, `cost`** |
  | `find_free_time` | `{ day?, after?, before?, minMinutes? }` | wraps Task 2's `findFreeGaps` |
  `read_day` carrying time windows is the whole point: ADR-022 records that the
  command envelope never carried them, which is why free-time questions were
  unanswerable twice over.
- **`{ tripId, userId }` arrive via `contextSchema` / `toolsContext`.** No tool
  declares a `tripId` parameter (Constraint 3). Add a test asserting no tool's
  input schema contains a `tripId` key — a structural assertion, so a future
  tool cannot quietly reintroduce it.
- **Scope narrowing is instruction + default, not a lie.** With
  `scope.kind === "day"`, the system instruction names that day as the subject
  and `find_free_time`/`read_day` default to it. The model may still read
  another day if the user explicitly asks about one — M16's gate asserts a
  day-scoped summary *does not mention other days*, which is about the answer,
  not about withholding the tool.
- **`simulatedModel` gains a chat branch** for surface `"ask"`, and a real
  `doStream()` implementation. It must produce a **plausible multi-turn
  conversational answer that reads the tools** — call `read_trip` (and
  `read_day` when the scope is a day), then answer in prose from the result.
  This is the path every Vercel environment takes with `ai-live` off; if it
  cannot answer, the deployed sidebar is broken. Keep it deterministic — e2e
  asserts its content.
- **Per-ask analytics (M16 Wave 3's foundation):** `askAnalytics.ts` records,
  per turn, via `onStepEnd`/`onEnd`: which tools were called and with what
  arguments, the **tool-call count to reach an answer**, step count, token
  usage, latency, whether it answered, and **which offered tools were never
  called**. Write to the existing structured log — no new table (Constraint 6).
  The never-called list is a reported number, not an inference.

**Tests:** unit tests for each read tool against a fixture `TripDetail`; the
no-`tripId`-in-any-schema structural assertion; integration tests for the caps
(each 400), viewer vs editor tool sets, quota refusal, the `denied` 403, and a
full simulated turn producing prose. Use `@tc/fixtures`' Japan trip — it is the
canonical fixture (ADR-030).

---

## Task 4 — The rail, docked (M16 Wave 1)

No AI changes. `SPEC.md` §9's docked presentation only.

**Files:** `apps/web/src/components/assistant/AssistantRail.tsx`,
`apps/web/src/components/board/TripBoardScreen.tsx`,
`apps/web/src/components/assistant/preview-fixtures.ts` (delete),
`apps/web/src/lib/preview-registry.ts`, `apps/web/src/app/globals.css`,
and the rail's tests.

**Spec:**

- The rail becomes a **flex sibling** of the plan, not `position: fixed` over
  it — the plan shrinks instead of being overlaid.
- **The scrim is deleted outright**, including its `.assistant-rail-scrim` CSS
  and the `no-restricted-syntax` disable that exists only for it. KI-16 and
  KI-17 were both caused by it; removing the cause is the point.
- Left edge is a **2px `--color-border-strong`** divider, not a hairline —
  SPEC §9: "a structural wall, not a card edge". Width stays **356px**, full
  height under the header.
- **Both `<Preview>` blocks are deleted** — the quick-ask chip row and anything
  left of "What I noticed". `preview-registry.ts` is updated in the same change
  or KI-31's orphan guard trips. `PREVIEW_QUICK_ASKS` and its fixture file go
  with them.
- Copy follows docked mode — no "drag the header to park it anywhere".
- The `.trip-board-content` right-padding hack that reserved 356px for a fixed
  rail is removed along with the fixed positioning it compensated for.
- Keep: the launcher pill's measured `rackHeight` offset (it solves a real
  overlap), the demo-board suppression (`isDemo`), and the "closed until asked
  for" default.

**Deferred and still owned by M16:** SPEC §9's bubble and floating
presentations. Do not build them.

**Verification (M16 gate requires it):** walk the rail in a real browser at
**1280px and below 1180px** — the viewport gap that let M10's Wave-1 gate pass
with a page-blocking scrim. Both widths, open and hidden.

---

## Task 5 — The conversation in the sidebar

The user-visible half of Mitchell's request: a discussion he can see and
continue.

**Files:** `apps/web/src/components/assistant/AssistantRail.tsx`,
`apps/web/src/components/assistant/Transcript.tsx`,
`apps/web/src/components/assistant/suggestedQuestions.ts` (+ its test),
`apps/web/src/components/board/TripBoardScreen.tsx`,
`apps/web/src/lib/apiClient.ts`.

**Spec:**

- **A transcript.** User and assistant turns render in order, visibly distinct
  from one another. The assistant's prose is **the model's own text** — not a
  derived receipt. This is the channel ADR-022 says the command endpoint
  structurally lacks.
- **Multi-turn.** The thread accumulates in client state and is posted back on
  each turn, so "no, I meant Tuesday" has something to refine (Ruling R1).
  A **New conversation** control clears it.
- **Streaming.** Tokens appear as they arrive. A turn in flight shows a
  distinct pending state; the composer is disabled while streaming.
- **Tool calls are visible but quiet** — a one-line "Checked day 3" affordance,
  not raw JSON. A conversation that silently pauses for four seconds reads as
  broken.
- **Scope comes from the page.** `useFocus()`'s `focusedDay` produces
  `{kind:"day", dayIndex}`; no focused day produces `{kind:"trip"}`. The
  existing context line ("Looking at Day 3" / "Looking at <trip name>") stays
  and must agree with what is actually sent — same value, one source.
- **Suggested questions, derived (Ruling R5).** `suggestedQuestions.ts` is a
  **pure function** of `(TripDetail, focusedDay)` returning **at most 4**
  strings. It replaces `PREVIEW_QUICK_ASKS`. Rules, each unit-tested:
  - A day is focused → questions about *that day*, naming it ("What's the plan
    for day 3?", "Where's the most free time on day 3?").
  - No day focused → trip-shaped questions ("How is the trip looking?",
    "Which day has the most free time?").
  - **Active conflicts exist** → one question naming the conflict count.
  - **Stops whose `kind` is neither `booked` nor `transit` exist** → one
    question about what still needs booking. (M18's contract fields are merged
    and inert; this reads them, it does not build M18's surfaces.)
  - **An empty trip** (no days) → questions that start a plan, not questions
    about content that does not exist.
  - Never emit a question about data the trip does not have. A suggestion that
    returns "there isn't one" is a broken suggestion.
- **Errors are inline**, next to the composer, not a toast — keep the existing
  `askError` treatment.
- **Keep the existing refusals** and their exact copy: the queued-unsent-edits
  refusal, and the viewer refusal. Both currently return `false` so the typed
  prompt survives; that behaviour stays.
- **Simulated is labelled.** The existing `Simulated` badge stays and applies to
  the streamed answer.

---

## Task 6 — Write tools and propose → review → approve (M9)

What makes it "plan a trip from start to finish" rather than "ask about a trip".

**Files:** `apps/web/src/server/ai/writeTools.ts`,
`apps/web/src/server/ai/handleAskRequest.ts`,
`apps/web/src/components/assistant/ProposalCard.tsx`, plus tests.

**Spec:**

- The write tools are the **derived planning tools that already exist**
  (`buildPlanningTools()`), offered inside the agent. They are not
  reimplemented (ADR-015 invariant 5; ADR-022 §4).
- Offered **only** when the turn's guard resolved `"editor"`. A viewer's turn
  never sees them.
- **Nothing commits without approval.** Use `toolApproval: 'user-approval'`
  (ADR-022's recorded mechanism, Ruling R3). The fallback shape is
  pre-authorised in R3 if that API cannot express server-side batch commit.
- **The proposal is reviewable before it is truth.** The client renders what
  would change — reuse `summarizeBatch` for the human sentence, and show the
  resolved commands as a list. Approve commits; reject leaves the trip
  **byte-identically untouched**, which is its own test.
- **On approval the commit is ONE atomic batch** through the existing
  `resolveBatch` → `flushPlanningBatch` path: one history entry, one undo
  (ADR-013). Not one command per tool call.
- **Geocode enrichment applies to an approved batch** exactly as it does on the
  command path — approval must not become a second door that skips KI-15's
  protection.
- **The model never writes a cost it does not have.** M9's "honest unknowns":
  `Money` is already `.optional()`; the instruction must forbid inventing an
  amount, and a test asserts a proposal for a stop with no known price carries
  no `cost` rather than `amountMinor: 0`.
- **Grounding (`SearchPlaces`) is NOT in this task.** It is M9 scope, it needs
  LocationIQ throttling at 2 req/s, and it is the single largest thing that can
  burn the night. The existing server-side `enrichCommandLocations` still runs
  on an approved batch, so locations are no worse than the command path today.
  Record it as the named remainder.

---

## Task 7 — Eval set and replay (M16 Wave 3) — **stretch, lowest priority**

Only if Tasks 1-6 are complete and green. If time runs out, this is the task to
drop; say so in the PR rather than half-landing it.

- A fixed set of ~10 questions with verifiable outcomes, replayed in CI against
  **recorded** transcripts — no live call in CI. Begins closing KI-11.
- The per-ask analytics from Task 3 are summarised per replay run: tool-call
  count per answer, correct-tool rate, tokens, error rate, and **which tools
  were never called**.

---

## What this plan does not do

Stated so the morning review is not a scavenger hunt.

- **Neither M16's nor M9's gate closes.** Both gates require a real,
  non-mocked model call with its `meta` pasted into the milestone file, and
  M16's requires Mitchell's four acceptance assertions run live. Those need
  `ai-live` on and a person watching. The four status flags
  (`TODO.md`, the milestone file's boxes, the retro, "Current milestone") stay
  as they are — flipping them without a passed gate is exactly the drift
  `docs/milestones/README.md`'s gate-close checklist exists to prevent.
- **M18 remains the current milestone** and its surfaces remain unbuilt. This
  branch reads M18's merged `kind`/`tags` fields (Task 5's booking question)
  but builds none of its surfaces.
- **No `SearchPlaces` grounding** (Task 6's note).
- **No bubble or floating assistant presentation** (Task 4's note).
- **No conversation persistence across reloads** (Ruling R1).

## How Mitchell sees it work in the morning

`ai-live` is **off in every Vercel environment**, so the deployed sidebar runs
the simulated path — which Task 3 makes genuinely conversational for exactly
this reason. To see it against a real model:

- **Locally:** `AI_LIVE=true` in `.env.local` with `AI_GATEWAY_API_KEY` set.
- **On the preview:** flip `ai-live` in the Vercel Toolbar's Flags Explorer —
  which works again since the CSP fix (PR #80).

The PR body will carry both, plus whatever the walk actually proved.
