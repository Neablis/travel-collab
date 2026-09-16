# M9 finishes: the assistant escalates, the transcript loses its boxes, and new trip becomes a conversation

**Status: DESIGN — 2026-09-15.** Not yet an ADR. Scopes the remainder of **M9**, which
stays one milestone with one gate (Mitchell's decision, 2026-09-15, taken against the
recommendation to split the new-trip flow into its own milestone — recorded because the
milestone file warns specifically about its gate growing back).

**Opened by:** Mitchell, 2026-09-15:

> i want (when in a AI payment tier) the ability to go through building a trip with the
> walkthrough, but also have the AI take a first pass at filling in that trip? […] then
> when its done, they have the ability to have a conversation with a ai agent to get more
> details or ask questions, then generate the trip.

> i really dislike how the AI right now will ask me to reframe a ask in order for it to do
> the work. It should do what it needs to do.

> i think the designs have some modeling around collapsing the thinking, but having it be
> expandable to see all the steps it took

## What this covers

M9's three original remainders — grounding, conversation durability, the eval/replay
harness — plus three additions that arrived with the 2026-09-15 design handoff (`SPEC.md`
§30) and Mitchell's asks above. It does not restate M9's file; read
`docs/milestones/M9-ai-planning-partner.md` first, and `.design-sync/handoff/SPEC.md` §30
beside it.

**Read §30.2 before estimating anything here.** The four new-trip questions are a fixed
local script and the first model call is the one after the last answer. A build that makes
the questions themselves conversational turns every abandoned New-trip sheet into billed
turns.

## The decisions, in one place

| Question | Decision | Taken |
|---|---|---|
| Where does this scope live | All of it in M9, one gate | Mitchell, 2026-09-15 |
| What "confident" means for escalation | Both: an **act** (an escalation tool) and a **widened band** (a `certainty` enum) | Mitchell, 2026-09-15 |
| How an escalated turn re-enters | AI SDK v7 `prepareStep` — not a turn restart, not a client retry | This document |
| What conversation durability persists | `localStorage` only. No table, no migration | Mitchell, 2026-09-15 |
| How many new-trip turns | **Four** — `where`, `when`, `pace`, `feel`. `who` is dropped | Mitchell, 2026-09-15 |
| What a free account costs | **Zero model calls, start to finish.** Fully deterministic | Mitchell, 2026-09-15 |
| What the paid conversation runs against | A **draft trip** — a real row, hidden until opened | Mitchell, 2026-09-15 |
| How `feel` drives selection | Hand-authored themes across the 148-day library | Mitchell, 2026-09-15 |

## 1. Escalation and certainty

**The complaint, diagnosed.** The "ask again saying what you want changed" copy is the
`withheld` posture (`assistant/grants.ts`) — an editor whose turn the classifier read as a
question, so the write tools were not handed over. The posture's own comment argues the
copy is honest, and it is; **the defect is that there is no recovery path**, so a
misclassification costs a whole turn and makes the user do the classifier's job.

**And most of what is observed today is not the real classifier.** `ai-live` is off in
every Vercel environment, so the deployed classifier is `simulatedModel.classifyStep()`, a
keyword predicate (`asksForAChange(text) || asksForAPlaybookDay(text)`) that deliberately
excludes the word "plan". That is KI-2026-09-12-a's territory and it means the deployed
symptom and the architectural gap have different causes. Both are fixed here.

### 1a. `certainty` — the widened band

`classifyAskIntent` returns `certainty: "sure" | "unsure"` beside the task class.

- The instruction's tie-break line — `'If you are unsure, use "plan".'` — is **replaced**,
  not kept alongside it. Keeping both counts the bias twice.
- An absent, unparseable or errored `certainty` defaults to `"unsure"`, preserving
  askIntent.ts rule 3's fail-open direction. **This module must stay total.**
- `question + unsure` does not withhold, and routes to the `mid` tier rather than `cheap`.
  Uncertainty resolves upward on both axes, which is already the stated rule.
- `certainty` lands in `AskIntentRecord`.

**Why this is worth having beyond the band itself.** Today "confidently a question" and
"unsure, defaulting to plan" arrive as the same value, so the classifier's guess rate is
structurally unobservable. Splitting them makes the fail-open rate measurable for the first
time, which is eval-harness fuel.

**It is an enum, never a float.** KI-88 is the precedent: the verdict used to be free text
capped at 8 output tokens, a reasoning model spent the whole budget reasoning and emitted
nothing, and the classifier failed open on every turn with no error anywhere. The fix was
to demand a typed field instead of a word. A self-reported probability is that mistake's
cousin, and a threshold is a knob nobody can defend a value for.

### 1b. The escalation tool — the act

A control-plane tool defined with `defineTool`: `needs` nothing, `spend: "none"`, input
`{ reason, intendedChange }`.

- **Offered only in the `withheld` posture.** Structurally unreachable for a viewer or an
  unentitled plan, both of which resolve to `read-only`, where rephrasing would not recover
  anything.
- **On call, `prepareStep` hands the next step the write set via `activeTools` and the
  escalated tier.** The read results already in the message history are kept; the write
  schemas were never sent before that step, so the classifier's ~3,400-token saving
  survives on every turn that does not escalate.
- **Once per turn**, tracked on the turn meter, not in the model's head.
- **Charged** — one step against `MAX_ASK_STEPS` and against the quota's admission charge.
- **Ledgered** — the `TurnLedger` gets an escalation line, so it reaches `ai_usage` and M21
  bills it like anything else.

**Why it cannot widen access, mechanically.** `minimumRoleFor` is computed over the set
actually selected and the handler already refuses to build an agent the actor's role does
not cover. Escalation exists only where role and plan both already permit `propose` — that
is the definition of `withheld` — so the escalated set can never exceed what the actor may
do. askIntent.ts rule 2 holds without anyone remembering it.

**The copy changes.** `instructionsFor` already varies on posture. The `withheld` branch
stops describing a retry the user has to perform and starts describing a tool the model can
call.

**The by-product.** Every escalation is a labelled classifier miss — the sentence, the
wrong verdict, and the model's own correction in `intendedChange`. That is the eval corpus
KI-11 needs, written by real use rather than by hand.

**Ordering.** KI-94 lands before this. Escalation adds a charged step; riding the existing
admission hole would widen it.

## 2. The transcript

One component — `components/assistant/Transcript.tsx`, consumed by `AssistantRail`, with
its types imported by `TripBoardScreen`. The new-trip flow becomes a third consumer rather
than a fourth implementation.

### 2a. No bubbles (`SPEC.md` §30.5)

- **Your turn** — a 2px `--color-brand` rule on the left, 11px indent, 13px / 1.5,
  `--color-slate`. No background, no border box, no radius. Today it is
  `rounded-md bg-brand-tint px-2.5 py-1.5`.
- **The assistant** — no container at all, full-width prose, 14px / 1.65, `--color-ink`.
  Today it is already container-less at `text-sm leading-relaxed`, so this is a type change
  rather than a structural one.
- Turn gap opens to 15px.

**The theme hazard needs a test, not care.** `nightdesk` and `airmail` currently paint
white user text on a filled brand bubble. Remove the bubble and that text is invisible on
the panel ground. The theme contract becomes: a look may restyle `--a-you-rule`,
`--a-you-ink` and `--a-asst-ink`, **both inks sit on the panel background and both must
stay legible there**, and no look may reintroduce a filled message box. Assert contrast per
look.

### 2b. Collapsed steps

The raw material exists: `ToolNote = { id, label }` and `toolNoteLabel()` already render a
tool call as a sentence. Today they are a flat, always-visible list above the answer.

- Collapse to one line: `"<n> steps · <the last one>"`, with a caret.
- Expanding in place reveals the full list and reads "Hide how it got there".
- **The step line keeps its bordered container** — §30.5 is explicit that it is a
  disclosure, not a voice.

**Two constraints.**

*Accessibility.* The component carries `role="log"` with an explicit `aria-live="off"` and
exactly one `sr-only` `role="status"` region **outside** the mutating content, with a
comment recording that a second nested live region was a prior review finding. The
disclosure must be a real `<button aria-expanded>` and must add no region.

*The streaming signal.* Today the tool lines appearing **are** the visible "something is
happening" during a stream — that is why they exist, per the component's own comment about
a conversation that silently pauses for four seconds reading as broken. Collapsed, the
summary line must keep updating as steps arrive, or streaming looks stalled again.

### 2c. `scrollIntoView` goes

`Transcript.tsx` scrolls with `scrollIntoView({ block: "end" })`. §30.6 bans it repo-wide
in favour of `scrollTop`, and that ban has teeth: `Board.tsx` and `Column.tsx` both carry
comments about `scrollIntoView` moving every scrollable ancestor, and **KI-2026-09-13-a is
an open bug in exactly that family**. Switching to `scrollTop` also retires the jsdom
feature-guard, since `scrollTop` exists in jsdom.

### 2d. Design-wall tokens

The file already records that an arbitrary Tailwind value trips the design wall. §30.5's
2px rule, 11px indent, 13px/1.5 and 14px/1.65 are arbitrary values unless they become
tokens. **Add tokens** rather than four more entries to KI-2026-09-05-v's 128 line-level
disables.

## 3. New trip is four turns

**Supersedes** `NewTripWizard`'s four-step stepper (Where · When · Who & Money · Shape)
entirely. In its place, inside the same sheet, a transcript asking one question at a time.

| # | id | Question | Answer affordances |
|---|---|---|---|
| 1 | `where` | Where are you going? | Six city chips, or type one |
| 2 | `when` | How long, roughly? | Length chips, **or** exact date inputs |
| 3 | `pace` | What pace do you want? | Slow · Balanced · Packed |
| 4 | `feel` | What is the trip about? | Eight chips, multi-select |

- Chips commit on click; the composer commits on Enter or Send; both stay live on every
  turn. Empty and whitespace-only answers do not commit.
- An answered turn collapses to your own words with a quiet **Change** under it, which
  returns to that turn. **Later answers are kept, not cleared** — you re-answer forward.
- `feel` unpicked commits as "A bit of everything" rather than blocking.
- No stepper and no progress bar: a transcript shows its own progress, and the stepper was
  the element that made the sheet grow.
- **No typing indicator and no artificial delay during the four turns.** There is nothing
  to wait for. A fake delay to make it feel like a model is explicitly wrong.

**Both exits stay open.** *Create empty* from turn one — this path already exists, since
`NewTripWizard` creates a trip from a name alone. *Create with this* from the first answer
onward. Once a trip has been produced the footer's primary becomes *Open the trip*.

**The per-turn footer belongs to this consumer, not to `Transcript`.** "Change" has no
meaning in the assistant panel; the shared component stays about two voices and one
disclosure.

**Close KI-2026-09-12-e while the file is open.** `NewTripWizard`'s retry is safe against a
*rejected* command but not a *lost response*, so a committed write can still duplicate or
deadlock. Rewriting the file around an open defect and keeping it is not acceptable.

## 4. The fork, and what generates

After turn 4 the flow forks on **assistant access, resolved from M20's entitlements**.
Never from a plan name compared by rank. The design file's own `ntAIAccess()` does exactly
that (`lapsed → free`, `trial → plus`, else the plan) because a mockup has no resolver —
**do not copy it.**

### 4a. Without access — deterministic, zero model calls

**Mitchell, 2026-09-15:** *"No free tier never calls model, it just looks like its talking
to ai, but it is fully deterministic from start to end."*

The trip is assembled by code from `content/playbooks/` and described by canned copy, then
a quiet note: the trip is finished and yours to edit; changing it by asking is part of
Plus, with a *See plans* button to the plans route (`SPEC.md` §29, M21). The composer is
gone — no teaser, no disabled input.

**The material, measured.** 148 playbook days across 19 bundles; 1,156 stops; 301 distinct
cities; 929 stops carrying real `lat`/`lng`. Human-authored, time-windowed, costed,
`kind`-tagged, and already the days Discover ranks.

| Answer | Drives | Against |
|---|---|---|
| `where` | which days are eligible | 301 cities |
| `when` | how many days to lay down | 4 / 7 / 10 / 14 / 21 |
| `pace` | stops per day | real stop counts per day |
| `feel` | which days fit the theme | **does not exist yet — see 4b** |

**The free path is grounded by construction.** The content is real and 80% geocoded, so a
deterministic generation has none of KI-81's problem: it cannot invent a restaurant in
Shropshire because it is not inventing anything. **Grounding therefore gates only the paid
path**, which means the free flow is shippable before `SearchPlaces` lands.

### 4b. `feel` needs a theme vocabulary that does not exist

The entire tag vocabulary across all 1,156 stops is four values — `meal` (346), `outdoors`
(330), `ticketed` (245), `lodging` (15). Those are booking-and-type tags. Of the eight
`feel` chips, two have even a rough counterpart. Six would be inert.

**Decision (Mitchell, 2026-09-15): hand-author themes across the library.**

1. `packages/fixtures/src/bundle/schema.ts` gains a `themes` array on a playbook day;
   `lint.ts` enforces a **closed** vocabulary (the eight `feel` values, no free text);
   `content.test.ts` and `pnpm content:verify` keep it honest. Additive, so the 148
   existing days stay valid while the pass is in flight.
2. **ADR-041 gets an amendment**, since this changes the format that ADR defines.
3. 148 judgement calls across 19 JSON files, imported through
   `pnpm --filter web content:import` like any other content change.

**This pass needs a named owner.** It is the largest non-code chunk in the milestone and
the most likely to sit half-done. It does pay past M9: M11b's Discover has city and rating
facets and no thematic one, and M12 is adding country search to the same box, so a closed
theme vocabulary on 148 public days is read by three surfaces.

*Neighbouring debt, while those files are open:* KI-2026-09-06-d — eight bundles carry
unverified model-estimated prices.

### 4c. With access — a draft trip

**Mitchell, 2026-09-15:** *"rather than creating the trip, it then lets you start
interacting with the ai agent like if the trip really existed using those questions to
build context, then the ai assistant will take a shot at the first pass of that trip."*

Turn 4 commits → **the trip is created with `status: "draft"`** → the existing assistant
runs against it unchanged: `read_trip`, `read_day`, `tripId` in ambient context, the
nine-stage admission chain, the tools, the proposal flow. The composer stays live and the
conversation continues in the trip's context. *Open the trip* flips `draft` → `active`.

This is not a tripless scope. A genuinely tripless conversation would need a new `AskScope`,
a tool set reading and writing a draft document held in the request, a second path through
admission, and a proposal flow retargeted away from trips — duplicating machinery that
already works.

**What it costs:**

- `TripStatus` gains a third value. `trip_summaries.status` is already `text NOT NULL
  DEFAULT 'active'`, so this is a **contracts change, not a migration**. Per `AGENTS.md` a
  contracts change is its own reviewed PR.
- Draft trips are filtered out of every listing.
- A reaper for abandoned drafts.
- **Every consumer of `status` must handle the third value, forced at compile time.**
  KI-2026-09-05-h is open and is exactly this class: *"`narrow` and `optionsFor` are not
  total over `FilterDimension`, and `serializePageNode` has no `never` default: two silent
  holes a new dimension or node type falls through."* Adding a union member is how those
  holes are found the hard way.

## 5. Grounding, and two doors into one vendor

**Grounding** is unchanged from M9's own scope section and is not restated here, except for
what Phase 0 changed: under `defineTool`, `SearchPlaces` declares `spend: "vendor"` and
would be **the first tool to do so** — all eight declare `"none"` today, which is why
`TurnLedger.capacity` is structurally empty on every turn. Grounding is what gives that
field a producer.

Three things a build must not get wrong, all already recorded: LocationIQ `/v1/search` with
`viewbox` + `bounded=1` and **not** the Nearby/POI endpoint (public BETA, format may change
without notice); **2 requests/second on the free tier** — throttle, never `Promise.all`,
which is what actually broke the 2026-08-02 dogfood run; and one extra step per *turn*, not
per place, so `meta.steps` reads 2–3 rather than 18.

**KI-93 — the second door.** `geocodeQuota()` has one caller, the `/api/geocode` proxy. The
AI path geocodes through `enrichCommandLocations` inside `commitProposal`, on the **apply**
path, which is not a tool and does not run inside a turn. Fix by settling post-hoc from the
`LocationEnrichmentReport` that already exists, reusing KI-67's never-refusing settlement.

After grounding there are **two producers against one quota** — `SearchPlaces` on the turn
path, enrichment on the apply path. *Open product decision:* enrichment is best-effort and
never fails a request, so a ceiling reached mid-batch should stop further lookups rather
than refuse the turn, which puts the check **inside** the enrichment loop. `docs/guidelines/`
states no policy on partial enrichment under a ceiling.

**KI-94 — the burst hole, and it lands before escalation.** Admission pre-authorises one
step and settles the rest afterward, so N in-flight requests can overshoot the global
ceiling by up to N × (budget − 1). The fix reserves the full budget atomically at admission
and reconciles the unused part after. It needs a **refund primitive `quota.ts` deliberately
lacks**, and two hazards must survive review:

- `bump` clamps its amount to a positive integer precisely so no caller can decrement
  usage. A refund reopens that, and a refund larger than its reservation would let an actor
  **drain their own counter** — a worse hole than the one being closed.
- The fixed window can roll between reserve and refund, so the refund must be conditional
  on the row still being in the window reserved against — the same SQL family as the
  existing `greatest(...)` monotonicity guard.

**Reserving without reconciling is not a shortcut**: it charges every one-step answer the
full budget and recreates KI-67 in reverse. **KI-97 closes with KI-94** and must not be
closed separately.

## 6. Durability

**`localStorage` only. No table, no migration** (Mitchell, 2026-09-15). This is consistent
with the ruling already recorded on `AssistantTurn`: *"Client-held: there is no
conversations table and no migration in this plan (Ruling R1), so this array IS the
thread."*

What it holds: the in-progress answers before turn 4, and the conversation thread after it.
On the paid path the four answers are baked into the draft row once turn 4 commits, so
`localStorage` carries only the thread from that point.

**Not the trip's event stream**, which would persist server-side with no new table but put
the conversation into history and time travel — undo would start reverting chat turns.

**Every access wrapped**, following `lib/pendingDemoClone.ts`: *"Every access is wrapped:
Safari's private mode throws on `localStorage`."* Degrade to empty, never throw. Two
recorded precedents for why: KI-2026-09-02-a (Node 26 leaves `window.localStorage`
undefined in the jsdom unit lane) and `SPEC.md` §28 (the old `theme` key still holds a
stale stored value — **version the key**).

**What the gate box can and cannot claim.** A thread survives a **reload**. It does not
survive a device change or cleared site data. The thread is a working surface, not a
record.

## 7. The exit gate as it grows

Ten boxes today, eighteen after this. For comparison, M20 closed with 32.

**Already satisfied — confirm, do not rebuild (3).** Rejecting leaves the trip untouched;
no fabricated cost; the conversational build → refine → approve mechanism.

**M9's original remainder (4).** One real non-mocked model call with its `meta` pasted into
the milestone file; the 2026-08-02 Rochester prompt re-run verbatim with real coordinates
in the right region; recorded transcripts replaying in CI without a live call; **and a
thread that survives a reload**.

> **The fourth is new, and it closes a gap that predates this work.** M9's audit names
> three remainders — grounding, conversation durability, evals. Grounding has a box, evals
> have a box, **durability has never had one**. One of the three things M9 exists to do
> could have been skipped without failing its own gate.

**The three promoted KIs (3).** KI-12 names the trip and sets its dates; KI-93 routes every
vendor call through the geocode quota; KI-94/97 holds the step ceiling under concurrency.

**New trip (4).** A free account's entire flow makes **zero model calls**, asserted; four
answers produce a named, dated trip; the fork reads entitlements and never a plan rank, and
the no-access path generates deterministically and links to plans; both exits stay open and
*Create with this* works from the first answer.

**Assistant behaviour and transcript (3).** A withheld turn escalates at most once, is
charged a step, and never widens past what role and plan already permit; a turn's work
collapses to one line and expands in place; no bubbles in any transcript, with all four
looks legible on the panel ground.

**Retro (1).**

## 8. Build order

Not a second gate — the dependency chain.

1. **KI-94 + the refund primitive.** Everything downstream charges steps.
2. **The transcript rebuild** — no bubbles, collapsed steps, `scrollTop`, tokens. One
   component; every later surface inherits it finished.
3. **The theme authoring pass** — schema, ADR-041 amendment, 148 days. Long lead time, no
   code dependency, so it runs alongside everything from here.
4. **The four-turn transcript and the deterministic free path.** Depends on 2 and 3, not on
   grounding. **This is the first shippable slice.**
5. **Grounding + KI-93.** Grounding multiplies LocationIQ traffic, so the unmetered door
   closes with it.
6. **`TripStatus: "draft"`** — its own contracts PR.
7. **The paid fork** — the assistant conversing against the draft.
8. **Escalation + `certainty`.** After 1.
9. **The eval/replay harness.** Escalations are labelled misses, so it runs last and is fed
   by 8.
10. **KI-12**, which lands across 4 and 7 rather than alone.

## 9. Testing

**Zero model calls on the free path — assert at the seam.** `selectAiModel()` is ADR-019's
single chokepoint and has a lint wall keeping it so. A counter there proves the claim for
the whole flow, including paths nobody thought to test. Per-call-site assertions do not.

**Escalation never widens — assert as a property, not a scenario.** Escalation exists only
in `withheld`, and `withheld` is by definition where role and plan both permit `propose`.
Assert `postureFor` never yields the tool outside it and the claim holds for cases nobody
enumerated.

**KI-2026-09-12-a closes as a side effect.** The simulated classifier emits only `plan` or
`question`, so `edit` is unreachable in the integration suite and every "write turn"
assertion is really a `plan` turn. Adding `certainty` means touching that model anyway —
which is the moment to give it the `edit` verdict, since the KI says that needs a product
judgement about the real classifier's prompt and this document is making exactly that
judgement.

**Three tests that do not exist today:**

- A concurrent `Promise.all` of distinct users against the global step bucket. Every
  current quota test issues requests in sequence.
- Contrast assertions per look — `nightdesk` and `airmail` lose user-text legibility the
  moment the bubble goes.
- The abandoned-sheet model-call counter.

**Reuse, do not rebuild:** `@tc/factories` for data, `admission.test.ts`'s stage-order
assertion, `grants.test.ts`, `taskClass.test.ts`, `route.int.test.ts`, `Transcript.test.tsx`,
`NewTripWizard.test.tsx`, `content.test.ts`.

**CLAUDE.md's rules apply unchanged.** An e2e verdict only from
`pnpm --filter web test:e2e:ci-like`. Every test seen to fail for its own reason before it
counts — break the code, watch it go red, restore, watch it go green; the PR template asks
for the source edit and the real failure text. The full suite is a final-review cost, paid
once when the branch leaves draft.

*Wall context:* new tests land under the test-quality wall — KI-2026-09-02-b (169
grandfathered violations) and KI-2026-09-02-c (`packages/*` have no ESLint at all).

## 10. Open — decisions Mitchell owes before build

1. **Generation failure** (§30.6). The four answers must survive it; *Create with this* is
   the floor, never a lost conversation.
2. **Offline at the fork** (§30.6). The four turns work offline because they are local; the
   generation does not. Say so at the fork, not at the start.
3. **Ceiling reached with access** (§30.6). Has assistant access, no turns left today.
   §17's meter copy, not a plan gate.
4. **No content for the destination.** Not in §30.6; added here. 301 cities is broad and
   someone will type Boise. A named, dated trip with empty days and honest copy, rather
   than a generator quietly returning three days in the wrong country.
5. **Partial enrichment under a geocode ceiling** (§5). A product call, and
   `docs/guidelines/` has no policy.
6. **Who authors the 148-day theme pass** (§4b).
7. **"Recent and nearby" has no data source.** The original reason
   `wizard-destination-chips` was tagged `unplaced`: no destination exists on `TripSummary`
   or `TripDetail`. `DRIFT.md`'s D11 now calls the shells "no longer orphaned", but the data
   gap is unchanged. Either the label drops and they become static suggestions, or something
   starts storing destinations — which is D6/KI-34's neighbourhood, not M9's.
   **ANSWERED 2026-09-16: the label drops.** Plain suggestions, no label;
   `wizard-destination-chips` leaves the registry. Nothing starts storing destinations.
8. **"Longer" acquired a day count.** `NT_NIGHTS` maps it to 21 nights, reversing the
   2026-08-23 decision that `Longer` has no day count the design implies. Confirm it is
   intentional.
   **ANSWERED 2026-09-16: intentional — 21 nights holds and the 2026-08-23 decision is
   reversed.** `Longer` becomes a fifth real length chip and `wizard-longer-chip` leaves
   the registry. Recorded here and in plan 4's D-B now; `NewTripWizard.tsx:25-30` states
   the old decision as live fact and **is corrected in the same commit that wires the
   chip**, not before — a comment recording the reversal above code still implementing
   the old one is the defect class that cost #184 two findings.

**Items 1–4 and 6 remain open**, and they gate the fork (§4) and the theme pass (§4b) —
not the four turns (§3) or the transcript (§2), which are unblocked by the three answers
above. Item 5 was **taken in code** while building KI-93: a geocode ceiling reached
mid-batch stops further lookups and does not fail the request, with the skipped names
reported. See `docs/plans/2026-09-16-M9-remainder.md` §B.

## 11. Deltas from the 2026-09-15 design handoff

Recorded here and owed to `DRIFT.md`, the way M11b recorded its two.

| Delta | §30 says | This build does | Why |
|---|---|---|---|
| **Four turns, not five** | Five: where · how long · who · pace · what it is about | Four — `who` dropped | Mitchell, 2026-09-15. "Who is coming?" accepts a name or an email, which is an invite: M11's flow, gated by M20's collaborator entitlement. Recording intent inside a wizard collides with two milestones' rules |
| **Draft trip on the paid path** | "the conversation continues in the context of the trip being built" | A real row at `status: "draft"`, hidden until opened | §30 does not say what the conversation runs against. A draft row is the reading that reuses the whole assistant |

**Not a delta**, though an earlier reading of this document called it one: §30.3's
"generated once and described in one turn" does **not** state that a model generates it.
Mitchell's deterministic reading is the natural one, and no divergence is recorded.
