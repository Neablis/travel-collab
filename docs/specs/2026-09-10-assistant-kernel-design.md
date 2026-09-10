# The assistant is a kernel: typed tools, declared scopes, one admission pipeline

**Status: ACCEPTED — 2026-09-10, as `docs/architecture/ADR-043-the-assistant-is-a-kernel.md`.**
Runs as **M9 Phase 0**, ahead of M17's remaining exit-gate boxes. This document is the
design and the cost accounting; ADR-043 carries the decision and the four rules.

**Opened by:** Mitchell, 2026-09-10, against KI-2026-09-05-t:

> Lets take on refactoring it, and the entire AI Ask system, i want a really easy to use,
> add functionality and audit system for […] Essentially all calls to Vercels AI service
> should be its own service that could if needed be its own service, it knows how to pull in
> context, evaluate context and be deeply efficient without sacrificing functionality and
> accuracy. And most important, the ability to measure cost, tool calls, and leverage
> multimodel to do easy things (is this a question) from hard (Plan me a 6 day trip) and use
> the correct model for each. It should be trivial to add a new tool and only use it in the
> contexts that make sense.

## Why now

KI-2026-09-05-t is not a defect. It is the **shape** that makes the other AI entries
expensive: stream E's census found 14–17 of 40 open entries citing `server/ai`, and KI-9,
22, 80, 82, 93, 94 and 97 are all consequences of model output crossing into the system at
many places with no single typed boundary. M9 was sized on the assumption that this is
fixed first. It is therefore M9's Phase 0 rather than a cleanup inside one of its tasks.

## What is there today, measured

`handleAskRequest` is 455 lines of body in a 1,048-line file (~583 of which are comments
recording incidents — **none of them are deleted by this work; each moves with the step it
describes**). It runs thirteen steps in one function:

| # | Step | Today |
|---|---|---|
| 1 | Demo trip refusal | inline, first, before the guard |
| 2 | Identify actor | `guard(tripId, ASK_MINIMUM_ROLE)` |
| 3 | Resolve write capability | `hasAtLeast(userId, members, "editor")` |
| 4 | Raw body byte cap | inline, measured before parse |
| 5 | JSON parse | inline, guarded → 400 |
| 6 | Request shape | `AskRequest.safeParse` |
| 7 | Prompt char cap + turn kind | inline |
| 8 | Day-scope range check | inline |
| 9 | Page-scope server verification | `getPage` + trip match + role |
| 10 | Model selection + kill switch | `selectAiModel` |
| 11 | Quota admission | `consumeQuota([...aiQuotas(), ...aiStepQuotas()])` |
| 12 | Intent classification | `classifyAskIntent` |
| 13 | Tool assembly + role re-check + agent + stream | inline |

### The three properties that make it expensive to change

**Tool sets are stated twice.** `offeredToolNamesFor` is a hand-written switch over three
set names, and its test asserts it against itself (F-F02). The tool modules already know
which set they are in; the switch is a second statement of the same fact, and every new
tool has to be added to both.

**Every tool receives the same ambient context.** `readToolsContext({tripId, userId,
detail, scope})` is handed to all of them under every tool name, whether the tool reads any
of it or not. No tool's dependencies are legible from its definition, and nothing in the
type system stops a new tool reaching something it has no business reaching.

**Cost is assembled at three points, inside a callback.** The recorder's `sink` writes the
analytics line, records the Sentry metrics, and starts the step settlement — three
consumers of a record that is built by observing the agent, plus one term (the classifier's
own round-trip) that has to be added back by hand because `record.steps` structurally
cannot see it. There is no single value that says what a turn cost.

## The design

Six pieces. Each is independently landable and each deletes something.

### 1. A tool is a module

The shape ADR-037 gave widgets, applied to tools:

```ts
export const readDay = defineTool({
  name: "read_day",
  domain: "itinerary",
  effect: "read",              // read | propose — nothing here commits
  spend: "none",               // none | vendor  → the ledger and the quota hook
  input: ReadDayInput,         // zod
  output: DayReadout,          // zod — REQUIRED
  needs: ["trip"] as const,    // typed keys into the dependency registry
  minimumRole: "viewer",
  run: (input, deps) => …,     // deps is exactly Pick<AssistantDeps, "trip">
});
```

Four of those fields are the whole point:

- **`output` is required.** This is KI-9 at the tool boundary: a tool cannot return a shape
  nothing parsed. The wrapper agreed with Mitchell in July — a model call that *requires* an
  output schema, so a new un-parsed consumer is a type error — is `defineTool` plus
  `callModel` (§6), not a separate abstraction.
- **`needs` is the audit property.** `run`'s second parameter is `Pick<AssistantDeps,
  Needs[number]>`. A tool that did not declare `geocoder` cannot reach the geocoder, and
  that is a compile error rather than a convention. Answering "what can this tool touch?"
  becomes reading one line.
- **`spend` enumerates the vendor doors.** KI-93 exists because a second path to
  `LOCATIONIQ_API_KEY` was invisible. Once every tool declares whether it spends, the set of
  spending paths is a filter over the registry, not something a reviewer has to notice.
- **`effect` is `read | propose`, never `commit`.** The turn changes nothing; that stays a
  property of the shape, as it is today.

**Derivation survives.** ADR-015 invariant 5 (tool schemas are derived, never hand-written
twice) is not weakened: `defineTool` is the *envelope*, derivation stays the *body*. The
write tools are emitted by a generator that maps each `@tc/contracts` command schema to one
`defineTool` call, and the page tools from the `@tc/pages` macro registry. A thirteenth
command still produces a thirteenth tool with no hand edit. A bespoke tool
(`search_playbooks`) is a hand-written module. Both end up in the same registry.

### 2. A scope is domains × effect

```ts
type ToolDomain = "itinerary" | "library" | "pages" | "places" | "account" | "system";
type Effect     = "read" | "propose";
```

A **surface** — what the user is actually looking at — declares what it grants. A grant is a
**list of (domain, maxEffect) pairs**, not one effect over all domains; that asymmetry is
load-bearing and is the one place the first sketch was too simple:

```ts
const SURFACES = {
  trip: [{ domain: "itinerary", max: "propose" }, { domain: "library", max: "propose" }],
  day:  [{ domain: "itinerary", max: "propose" }, { domain: "library", max: "propose" }],
  page: [{ domain: "itinerary", max: "read"    }, { domain: "library", max: "read" },
         { domain: "pages",     max: "propose" }],
} satisfies Record<SurfaceKind, SurfaceGrant>;
```

`toolsFor(grant)` is the registry filtered by `tool.effect ≤ grant[tool.domain]`, with a
missing domain meaning "not granted". The three current sets fall out of it rather than
being declared beside it, and each reproduces today's behaviour exactly:

- **read-only** — every pair capped at `read`. Today: `READ_TOOL_NAMES`.
- **planning** — `trip`/`day` as written above. Today: `READ_TOOL_NAMES + WRITE_TOOL_NAMES`
  (`itinerary` writes plus `insert_playbook_day`, which is `library`/`propose`).
- **page** — `pages` at `propose`, `itinerary` and `library` at `read`. Today:
  `READ_TOOL_NAMES + PAGE_TOOL_NAMES`.

So *"a page turn holds no `RemoveActivity`, and a planning turn holds no `insert_widget`"*
— ADR-033 Decision 4's narrowing — stops being a sentence three constants have to keep
true, and becomes the `itinerary` domain being capped at `read` on one surface and the
`pages` domain being absent from the other.

`minimumRoleFor` becomes `max(tool.minimumRole)` over the set actually selected. Its own
comment already says this is what it wants to be — *"the moment a tool that is not in
`READ_TOOL_NAMES` is offered […] this answers `editor` without anyone having to
remember"* — and the hand-written switch was the thing stopping it. `offeredToolNamesFor`,
`READ_TOOL_NAMES`, `WRITE_TOOL_NAMES` and `PAGE_TOOL_NAMES` are all deleted (F-F02).

**Adding a tool that should only exist on one surface is one tag.** Adding a surface
(`city`, `timeline`, `system`) is one row. That is the "trivial to add a new tool and only
use it in the contexts that make sense" requirement, expressed as data.

### 3. One admission pipeline, one verdict, one audit record

Steps 1–12 become a declared array of named stages:

```ts
const ADMISSION: readonly Stage[] = [
  refuseDemoTrip,      // before the guard: /demo is anonymous (ADR-031)
  identifyActor,       // guard() → userId, detail, members
  capRawBody,          // measured on bytes, before parse
  parseRequest,        // JSON + zod, 400 naming the rule broken
  resolveSurface,      // the page/day CLAIM verified server-side (ADR-033 D2)
  selectModel,         // entitlement + kill switch
  admitQuota,          // requests AND steps (KI-67)
  classifyTask,        // only when there is a write half to withhold
];
```

**The order is a value, not statement order.** Three of the transitions are recorded
incidents: charging before model selection burned a caller's whole allowance against an
outage that produced zero provider calls; a malformed request must not cost an allowance
either; a bad page id must cost nothing. Today those are defended by comments. As an array
they are defended by a test that asserts the sequence, and each comment moves onto its
stage.

The pipeline returns one value:

```ts
type AiAdmission =
  | { ok: true; grant: AiGrant }      // actor, surface, grants, tools, model, taskClass
  | { ok: false; refusal: AiRefusal } // machine code + Response, as today
```

and emits one `ai.grant` record naming the actor, the surface, the granted (domain,
effect) pairs, the tools actually offered, the model chosen and — on a refusal — which
stage refused and why. **That record is the answer to "what is and isn't allowed":** one
function to read, one log line to query, instead of thirteen steps to trace.

`handleAskRequest` becomes admission → build agent → stream, and F-F03's duplicated body
ritual collapses into `capRawBody` + `parseRequest`, shared with the apply handler.

### 4. Prompt assembly is typed blocks, and tool results are tainted

Two channels, and they never mix.

```ts
type PromptBlock =
  | { kind: "rule"; text: string }                     // ours, constant
  | { kind: "data"; label: string; value: unknown };   // fenced, escaped, never a sentence
```

The system instruction is built only from `rule` blocks plus `data` blocks. User text is
only ever a `user`-role message. Today `pageInstructions` interpolates a page title into a
sentence — `The page is called "${page.title}"` — and the title is user-authored; under
this it becomes a `data` block with a label.

**Tool results carrying user-authored trip content are wrapped as untrusted data.** This is
the part that is specific to *this* product rather than generic hygiene: trips are
collaborative and shared by link, so another editor's activity title, another member's
note, and a Playbook day authored by a stranger are all attacker-influenceable relative to
the person asking. A standing rule says content inside a data envelope is data and never an
instruction; `read_trip`, `read_day` and `search_playbooks` return their user-authored
fields inside one.

The `Scope:` line stays a `data` block with its existing prefix, so `parseAskScope` and the
simulated model keep working and the round-trip test in `context.test.ts` survives
unchanged. Moving the scope onto a side-channel was considered and rejected: it buys
nothing here (the line is server-authored) and costs the one channel that reaches both a
real model and the simulated one.

### 5. Model routing by task class

The classifier already runs and already costs a round-trip. Its output widens from
`question | write` to a task class, and the class picks the tier:

| Task class | Chosen by | Tier | Why |
|---|---|---|---|
| `question` | classifier | cheap | "is this a question" is the cheapest thing we ask |
| `edit` | classifier | mid | a bounded change to an existing trip |
| `plan` | classifier | strong | "plan me a 6 day trip" — multi-day generation |
| `compose` | **the surface**, not the classifier | mid | a page turn is `compose` by construction |

`compose` is decided structurally for the same reason a page turn is not classified today:
its tool set comes from a scope the server verified, not from what the sentence sounds
like, so paying for a classification would be spend with nothing to buy.

Every tier resolves through `selectAiModel()` — ADR-019's single chokepoint and its lint
wall are unchanged, and the kill switch still covers every call. What changes is that the
chokepoint takes a task class instead of a fixed pair of model ids.

**The saving this buys, and the risk.** Today a question and a plan cost the same model. A
question routed to a cheap tier is the dominant term, because questions are most turns. The
risk is a misrouted `plan` answering on a cheap model, which is a quality regression rather
than a dead end — so the router biases the same way `askIntent` already does: every
uncertainty resolves *upward*, toward the stronger model.

### 6. Cost is a return value: `TurnLedger`

```ts
interface TurnLedger {
  modelCalls: { taskClass: TaskClass; model: string; tokensIn: number | null;
                tokensOut: number | null; ms: number }[];
  toolCalls:  { name: string; ms: number; ok: boolean }[];
  vendorCalls:{ vendor: "locationiq"; count: number }[];
}
```

One value per turn. The three things that assemble cost today become **readers** of it:
the analytics log, the Sentry metrics, and the step settlement. Three consequences:

- The classifier's round-trip is a ledger line rather than a `+1` added by hand in the
  sink, so the under-metering that comment has to warn about stops being possible.
- **KI-93 gets a home.** A `spend: "vendor"` tool's lookups are ledger lines, and settling
  them is the same post-hoc, never-refusing mechanism KI-67 already built for steps. The
  mid-batch policy question KI-93 raises is still a product call and is **not** answered
  here; what this does is make the count available at the one place that settles.
- **KI-94 gets a home.** Reserve-and-settle needs one place that knows the reservation and
  the actual. That place is now the ledger. The refund primitive itself is
  security-sensitive and stays its own reviewed step, as KI-94 requires.

## What this deliberately does NOT do

**No entitlement policy. No usage table. No migration.** M20 ("An account knows what it may
do") was scoped 2026-09-01 and owns plans, tiers, per-tier ceilings and the `ai_usage`
token ledger, under four rules Mitchell already decided: a plan is a set and not a rank;
trials, referral rewards and admin boosts are one time-bounded grant with three `source`
values; entitlements resolve per request from the database, never from the JWT; and a
plan's contents are versioned data that a purchase pins.

This work builds the **ports** those rules will fill — `AiEntitlementCheck` (which already
exists and is already stubbed `EVERYONE_IS_ENTITLED`) and a `UsageLedger` sink taking a
`TurnLedger`. Nothing here chooses a tier, a ceiling or a price. Building the policy now
would pre-empt decisions that are already made and recorded elsewhere.

**No comment deleted.** F-E07 says it, and it is repeated here because the temptation is
real: the file is half comments and they look like bulk. They are the incident record. Each
one moves with the step it describes.

**KI-22 is not in this chain.** AGENTS.md reserves a contracts change as its own reviewed
PR, so moving the stream envelope into `packages/contracts` follows as P6, separately.

**`resolveBatch` is not rewritten.** M9's own file says explicitly not to; KI-10 needs its
own call first.

## Where it lives, and what holds the line

`apps/web/src/server/assistant/`, behind an **import wall** in
`apps/web/eslint.config.mjs` modelled exactly on the gateway chokepoint wall: both a
`no-restricted-imports` pattern (cheap, specific message) and an
`import/no-restricted-paths` zone (resolves the import, so relative spellings are closed
too — the bypass a review actually found against the gateway rule).

The wall forbids, from inside `src/server/assistant/**`: `next/*`, `@/server/db/*`,
`@/server/pages`, `@/server/auth`, and `@/server/pages-guard`. Everything the kernel needs
from those arrives as an injected port. That is what "could be its own service" means
concretely — the module graph, not a deployment.

**Why not `packages/assistant`.** The compiler would enforce the boundary for free, which
is stronger than a lint rule. It was rejected for one reason: `packages/*` have no ESLint
configuration at all (KI-2026-09-02-c), so the move would put the most security-sensitive
code in the app somewhere unlinted. If that KI closes, extraction is a `git mv` plus a
`package.json` — the wall above is written so that the import graph is already correct on
the day it happens.

## Phases

Each is one PR. Verification per AGENTS.md's tiers — Tier 2 (`minimal-check-subset`) while
the branch is in draft, Tier 3 once.

| Phase | Lands | Deletes / closes |
|---|---|---|
| **P0** | This spec + ADR-043 + M9 placement | — (Tier 1: runs nothing) |
| **P1** | `defineTool`, the registry, every tool ported, the import wall | ambient `toolsContext`; sets up KI-9 |
| **P2** | Domains × effect, `toolsFor`, computed `minimumRoleFor` | `offeredToolNamesFor`, three name manifests (F-F02) |
| **P3** | `evaluateAiGrant` staged pipeline; handler shrinks to orchestration | the 455-line body (KI-2026-09-05-t), F-F03 |
| **P4** | Prompt blocks + tool-result tainting | string-concatenated instructions |
| **P5** | Task classes, tiered routing, `TurnLedger`, sinks rewired | the hand-added classifier step; homes for KI-93/94 |
| **P6** | Stream envelope → `packages/contracts` (own PR) | KI-22 |

## Cross-reference

KI-2026-09-05-t (this entry), KI-9 (the hub), KI-22, KI-80, KI-82, KI-93, KI-94, KI-97;
F-E07, F-F02, F-F03, F-F04, F-F09; ADR-015 invariant 5, ADR-019 (+ its 2026-08-25 and
2026-09-08 amendments), ADR-033, ADR-037, ADR-042; M9, M20.
