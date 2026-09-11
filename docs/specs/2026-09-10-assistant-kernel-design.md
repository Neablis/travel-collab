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
  description: "…",           // REQUIRED — the SDK needs it, and it is the biggest
                              // single lever on whether the model picks the right tool
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

**A collector is a dependency, not a closure.** Write tools and page tools do not execute —
they *collect*, and the loop ends (that is what makes "the turn changes nothing" a property
of the shape). Today that collection lives in a closure captured by `buildWriteTools()`,
which is why those builders return `{ tools, getCollected, getInserts }` rather than tools.
Under `defineTool` the collector is a per-turn **dependency**: `needs: ["proposalBuffer"]`
or `needs: ["pageBuffer"]`, supplied in `AssistantDeps` when the turn is built. This is the
rule paying for itself on its first use — the thing a write tool can reach that a read tool
cannot is now stated in the tool's own definition instead of being implied by which builder
constructed it.

**Two channels supply the deps, and the split is deliberate** *(added 2026-09-10 after P1;
the first draft implied all deps are closed over, which would have been a regression)*.
Ambient deps — `trip`, `actor`, `scope` — ride the AI SDK's own `contextSchema`, which is
what gives ADR-022 §3 its **structural** guarantee that a tool cannot be pointed at a
different trip: the tripId is not a tool argument, so a model cannot supply one. Turn deps —
`proposalBuffer`, `pageBuffer` — are closed over by the builder, because a buffer is
per-turn mutable state and not context. `needs` is still the whole of what a tool may reach;
the split is *where a value comes from*, never a second permission system. P3's admission
pipeline is where the two are assembled, and it does not collapse them.

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

**A surface kind is not a tool set, and conflating them is the trap in P2** *(found on the
first build against this spec)*. `AskScope`'s kinds are `trip | day | page`; today's three
tool *sets* are `read-only | planning | page`. They are different axes — a `trip`-scoped turn
by a viewer is `read-only`. The grant is a **`min` over four independent caps**, one per
domain:

```
grantedEffect(domain) = min(
  surface[domain],     // what this surface is about at all            (§2)
  roleAllows,          // viewer → read, editor → propose              (trip membership)
  planAllows,          // ai.ask → read, ai.command → propose          (§7c, M20)
  classifierAllows,    // question → read, edit|plan → propose         (§5)
)
```

`AskToolPosture` (`propose | withheld | read-only`) is then **derived** from comparing those
terms rather than being a fourth input: `withheld` is precisely the case where role and plan
both permit `propose` and the classifier did not. That derivation is what keeps the
instruction honest — telling an editor "I can only answer questions" is a lie today only
because the two causes are distinguishable, and this keeps them distinguishable by
construction.

**Tool domains, pinned:** `read_trip`, `read_day`, `find_free_time` are `itinerary`/`read`;
`search_playbooks` is `library`/`read` (it reads the Playbook corpus, not the trip); the
twelve command tools are `itinerary`/`propose`; `insert_playbook_day` is `library`/`propose`;
`insert_text` and `insert_widget` are `pages`/`propose`.

> **Corrected 2026-09-10, after P2.** This block previously justified itself by claiming that
> tagging `search_playbooks` `itinerary` *"would silently drop it from the page surface,
> which today has it."* **That is false**, and P2 found it the right way — by writing the
> test this sentence implies and watching it refuse to fail. The page row grants `itinerary`
> at `read` as well, so a `read`-effect tool is offered either way. More than that:
> `itinerary` and `library` carry **identical caps on all three rows today**, so retagging
> either library tool changes no tool set at all.
>
> The tags are still worth having, but for an honest reason rather than that one: they are
> **audit vocabulary now and behaviour later.** Nothing derivable can pin them while the caps
> agree — which is why `grants.test.ts` pins all seven tools' domains *directly*, as literals,
> rather than against `SURFACES`. They start bearing weight the first time a surface grants
> one domain without the other, which is exactly what a `city` or `timeline` surface would do:
> the Playbook library without the trip itinerary.

**Three mechanical gotchas, each measured rather than reasoned** *(P2, 2026-09-10)*:

- **The role cap's rank comparison belongs in `@/server/accessPolicy`, not in the kernel.**
  `minimumRoleFor` is a `max` over `TripRole`, and AGENTS.md invariant 6c says exactly one
  place may know that a viewer ranks below an editor. So `roleAtLeast` is exported from
  `accessPolicy` (with `hasAtLeast` delegating to it) and that module is allowlisted through
  the wall. A second `RANK` table inside the kernel is what the invariant forbids, and it is
  the obvious thing to write.
- **The obvious spelling of the allowlist is broken.** `no-restricted-imports` matches
  `group` with the `ignore` package, which follows gitignore semantics — *a file cannot be
  re-included once a parent directory is excluded*. So `["@/server/**", "!@/server/ai/context"]`
  **denies its own exception**: measured on ESLint 9.39, every allowlisted import was
  rejected. The wall uses a negative-lookahead `regex` instead.
- **Building the tool set dynamically erases `toolsContext`'s type.** `InferToolSetContext`
  over a `Record<string, Tool>` resolves to nothing and types `toolsContext` as `undefined` —
  at the one call site ADR-022 §3's structural guarantee rides on. `registry.ts` exports an
  `AssistantToolSet` that pins the context parameter, so a bogus key still errors by name.
  This is the trap `readTools.ts` warns about at length, reached from a new direction.

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

### 3b. Five corrections to §3, from building it *(P3, 2026-09-11)*

**The pipeline is NINE stages, not eight.** The caps are `min(surface, role, plan,
classifier)` and `classifier` comes from the last of the eight — so the tool set, the derived
posture and `minimumRoleFor`'s backstop 403 can only resolve *after* every listed stage has
run. §3 therefore had no name for the step that produces the thing the pipeline returns,
while also requiring every refusal to name a stage. `grantTools` is the ninth and last, and
it can refuse, which is what makes it a stage rather than an epilogue. The other eight and
their order are exactly as specified.

**`AiGrant` names the admission verdict; the (domain → effect) map is `GrantedEffects`.**
P2 took `AiGrant` for the map before §3 was written against it, and both are load-bearing.
The verdict keeps the name — it is what the `ai.grant` audit record is a record *of*, and
"grant" in the permissions sense is the more load-bearing reading.

**The pipeline lives inside the kernel, and its bindings are ports.** §3 said the pipeline
"returns one value" and never said where it lives, and "Where it lives" put the kernel behind
an allowlist that denies all five things the pipeline needs — `guard`, `getPage`,
`selectAiModel`, `consumeQuota`, `classifyAskIntent`. P3 resolved the contradiction by putting
`evaluateAiGrant` in `src/server/ai`, outside the wall, and flagged the choice rather than
making it silently. **Decided: it moves inside, in P4.** The reason is the requirement this
work opened on — the service should *"know how to pull in context, evaluate context"* — and a
pipeline outside the wall puts the entire audit surface outside the wall with it. `ai.grant`
is the answer to "what is and isn't allowed", and it should not be the one part of the
assistant that a service extraction would leave behind. The bindings become ports, which
`admissionPorts.ts` already is.

**§7d's ordering claim is true but currently unenforced, and P5 is what closes it.**
`selectModel` runs before `admitQuota` because an incident forced it — but `admitQuota` reads
nothing `selectModel` produces today, so the data dependency that makes the other stages'
order structural does not exist for this pair. It is held by two test assertions and nothing
else. When P5 has `selectModel` hand `ResolvedEntitlements.ceilings` to `admitQuota`, the
order becomes structural. **P5 is closing a real gap there, not restating a property.**

**`classifyTask` is not a conditional stage.** §3 describes it as running *"only when there is
a write half to withhold"*, which is the one thing a fixed array cannot express. The stage
always runs; the *model call* inside it is conditional on `canWrite && page === null`. The
distinction matters because "the array is the order" is the property the whole section rests
on.

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

### 5b. Model identity and its price are INPUTS, not constants

**Mitchell, 2026-09-10:** *"that cost is not forever, and the model we use might change, so
that needs to be a variable input in the system."*

The $0.0011-per-request figure quoted throughout this document and M20 is **one measurement
of one model on one date**, not a property of the system. DeepSeek's rates for the configured
model already changed once mid-scoping (2026-08-16). Three rules follow, and they are
constraints on this design rather than notes about M20's:

**No model id is ever a literal in kernel code.** §5's tiers (`cheap`, `mid`, `strong`) are
*names of slots*, and the slots resolve through configuration. Today `serverConfig.aiModel`
and `aiClassifierModel` already do this for two models; the tier map generalises the same
mechanism rather than replacing it, so `selectAiModel()` stays the one chokepoint and
ADR-019's lint wall is unaffected. Swapping a model is a configuration change plus a rate
entry — no kernel code moves.

**The kernel never multiplies tokens by a price.** There is no rate constant, no currency
type and no cost arithmetic anywhere inside it (§7a). Pricing is a **join, performed
downstream, as at a point in time**, against a dated append-only rate record that lives
outside the kernel — M20's 2026-09-02 amendment makes it a committed file, the mirror image
of the plan-version file, so that a rate change publishes a new dated entry and never
rewrites history. A model swap and a price move are then the same operation, and neither
corrupts the series.

**The compiled default must not be able to disagree silently with what runs.** This is not
hypothetical: `config.ts:15` compiles `DEFAULT_AI_MODEL = "anthropic/claude-haiku-4-5"`, and
production sets `AI_MODEL` to `deepseek/deepseek-v4-flash-0731`. M20 link 5 records the
consequence in the only way that matters — *"costing the compiled default instead of the
configured model overstates the bill by roughly an order of magnitude, and this note exists
because that mistake was made once already while scoping this milestone."*

Two things close it, and both are cheap:

- **Every ledger row records the RESOLVED id** of every model the turn actually used, turn
  and classifier separately (§7a). No analysis ever has to assume which model ran, which is
  what made the original mistake possible.
- **`GET /api/health/ai-mode` reports the resolved tier map** alongside the `live`/`source`
  it already returns. Today that endpoint answers *whether* AI is live and not *what* is
  running, so "which models is production actually on?" is answerable only by reading
  environment variables in a dashboard — which is exactly how a compiled default goes
  unnoticed. One field, and the question becomes answerable from outside.

**Open, and deliberately not decided here:** whether the tier map should be a Vercel Flag
rather than an environment variable. The infrastructure exists — `ai-live` is already a flag
with per-user entities (ADR-019's 2026-09-08 amendment) — and a flag would let a model be
swapped without a redeploy, which matters most during an incident (a provider degrades and
you want off it now). The argument against is that a model id is not a targeting decision and
the flag would be a second source of truth beside `AI_MODEL`. **The tier map is built as a
single resolved value either way**, so whichever source feeds it is one function's
implementation and not a change to anything that reads it. Raised for Mitchell rather than
assumed.

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

## 7. Built for M20 and M21, on Mitchell's instruction

**Mitchell, 2026-09-10:** *"Lets make sure to take into consideration the upcoming milestone
around stripe and people paying for there account, and limits to the AI agent depending on
the tier, that might influence design decisions about how we structure measureing and
build."*

It does. M20 ("An account knows what it may do") and M21 (Stripe) were scoped 2026-09-01/02
in enough detail that this is a fit check, not a guess — and checking it changed four things
in the design above rather than confirming them. **The goal is that M20 links 5 and 9 are
wiring, not redesign.**

### 7a. `TurnLedger` IS the `ai_usage` row, field for field

M20 link 9 specifies the table: *"user id, endpoint, model, classifier model, input and
output tokens (turn and classifier separately), step count, outcome, and `created_at`"*, no
question text and no trip content, and written **on the failure paths too** *"because the
round-trips already made were already paid for"*.

So `TurnLedger`'s model half is shaped as that row, not as a cousin of it, and M20 link 9
becomes an `INSERT` plus a migration:

```ts
interface TurnCost {                 // the ai_usage row, one per request
  userId: string;
  endpoint: "ask" | "ask.apply";
  outcome: "completed" | "error" | "abort";
  turn:       { model: string; tokensIn: number | null; tokensOut: number | null };
  classifier: { model: string; tokensIn: number | null; tokensOut: number | null } | null;
  steps: number;
  planVersionRef: string | null;     // see 7c
}
```

Turn and classifier stay **separate**, because the whole reason the classifier has its own
model id and its own `gen_ai.invoke_agent` span is that *"did the classifier save more than
it cost"* is unanswerable if its spend is folded into the turn's. Recording them summed
would undo that at the durable layer.

**Written on all three end paths** is already free: `createAskRecorder`'s single-writer latch
fires exactly once per turn on `onEnd`, abort and error. The ledger becomes a fourth reader
of that latch, not a fourth place that has to get once-only right.

**No dollars, and never `Money`.** M20's second decision, and it is the KI-1 / KI-14 /
`budgetPerPerson` defect class on its third recorded recurrence: a live request costs
**$0.0011**, and `Money`'s integer minor units round that to **zero**. Every request would
store as free. The ledger carries tokens and model ids; the price is a join against a dated
rate file. `TurnLedger` therefore has **no currency type anywhere in it**, and that is a
constraint on this design, not a note about M20's.

### 7b. Cost and capacity are two ledgers, not two fields of one

**This is a correction to §6 above.** The first draft put geocode lookups in `TurnLedger`
beside model tokens as `vendorCalls`. M20's third decision forbids summing them:

> **Attribute marginal cost only.** Model tokens are the per-account marginal cost. Vercel,
> Postgres and LocationIQ are not: the geocoder is a **daily-capped free tier**, which is a
> capacity limit rather than a per-call charge.

Two different questions with two different answers, so:

```ts
interface TurnLedger {
  cost:     TurnCost;                                   // billable — model tokens only
  capacity: { vendor: "locationiq"; calls: number }[];  // NOT billable — quota only
  toolCalls:{ name: string; ms: number; ok: boolean }[];// neither — efficiency
}
```

`capacity` is what KI-93 settles against `geocodeQuota()`. It must never be summed into a
per-account cost, and the type keeps them apart so that nobody has to remember. A
`spend: "vendor"` tool contributes to `capacity`; only a model call contributes to `cost`.

### 7c. The entitlement port is a set with ceilings, not a boolean

Today `AiEntitlementCheck = (actor) => boolean | Promise<boolean>`. That port cannot express
what M20 needs, so **P5 widens it** and M20 fills it:

```ts
type EntitlementResolver = (actor: AiActor) => Promise<ResolvedEntitlements>;

interface ResolvedEntitlements {
  has(capability: Entitlement): boolean;  // SET MEMBERSHIP. Never a rank, never an order.
  ceilings: { perUserRequests: number; perUserSteps: number };
  planVersionRef: string | null;
}
```

Three rules of M20's are load-bearing on this signature:

- **A plan is a set, not a rank.** *"`premium` lists its own entitlements in full; it is
  never `[...PLUS, 'trip.collaborators']`."* So the port exposes `has()` and **no comparison
  operator at all** — no `atLeast`, no ordering, nothing shaped like `accessPolicy.ts`'s
  `RANK`. Copying that rank table is the obvious move here and the wrong one.
- **Resolve per request from the database, never from the JWT** — *"a downgrade must bite
  before a token refreshes"* — which is why the resolver is `async` and is called inside the
  admission pipeline rather than read off the session.
- **A purchase pins a plan version**, so per-user ceilings come from the *pinned* version.
  See 7c-note below.

**`ai.ask` and `ai.command` are the effect axis.** M20's entitlement vocabulary is `ai.ask`,
`ai.command`, `trip.collaborators`. The first two map exactly onto §2's `effect`: `ai.ask` is
`read`, `ai.command` is `propose`. So the tool filter takes its cap from **two** sources
intersected — the actor's trip **role** and the account's **plan** — through one filter
rather than two mechanisms:

```
grantedEffect(domain) = min( surface.max(domain), roleAllows(domain), planAllows(domain) )
```

A `free` account is refused `ai.ask` at the `selectModel` stage and never reaches tools at
all. A `plus` account on a trip where it is a viewer gets `read` from both and `read` is what
it gets. This is the single strongest reason to build §2 as (domain, effect) pairs rather
than as three named sets: **the plan gate is the same shape as the role gate, so it is a
third input to an existing computation instead of a new one.**

**7c-note — one field M20's link 9 does not list, and I think should.** `planVersionRef` on
the usage row. M20 describes pricing as *"a join across both as at a point in time"*, which
works when what was in force is derivable from `created_at`. Under rule 4 it is not: a
purchase **pins** a version, so two accounts billing on the same day can be on different
pinned versions, and the row's date does not say which. Reconstructing it from the grant
history afterwards is possible but is exactly the kind of derivation that goes wrong once
and corrupts a series silently. Recording the ref costs one column. **Flagged for Mitchell
rather than assumed** — the kernel emits the field, and M20 decides whether to store it.

### 7d. Ceilings are a parameter of admission, and the pipeline order already agrees

M20 link 5: *"`aiQuotas()` and `aiStepQuotas()` take entitlements and return different
ceilings. **The bucket `name` must not vary by tier**"* — a tier-suffixed bucket would zero an
account's usage on upgrade and let anyone farm free calls by toggling — and *"per-user
ceilings come from the account's pinned plan version; global ceilings stay in the
environment."*

This lands cleanly on §3's pipeline for a reason worth stating, because it could easily have
gone the other way: `selectModel` already runs **before** `admitQuota`, and it has to, for a
recorded incident (charging before selection burned a caller's whole allowance against an
outage that made zero provider calls). Resolving entitlements needs to happen before the
ceilings are known, and the ceilings are needed by admission. **The order the incident forced
is the order the tier requirement needs.** So `selectModel` resolves entitlements and hands
`ResolvedEntitlements.ceilings` to `admitQuota`; nothing in the sequence moves.

### 7e. Task class proposes a tier; entitlement caps it

§5 routes `question → cheap`, `edit → mid`, `plan → strong`. With tiers, that becomes a
proposal rather than a decision: `capTier(tierFor(taskClass), entitlements)`. It is the same
cap-an-upper-bound shape as 7c's effect intersection and as §2's surface grant — three
places, one idea, which is what makes it teachable.

M21 (Stripe) needs nothing from the kernel beyond this. Payments never enter it; what M21
consumes is the `ai_usage` series that link 9 stores, joined against a dated rate file, and
the kernel's contribution to that is 7a and 7b.

### 7f. One stale claim found in M20 while checking this

M20 link 9 says *"`/ask` must also account for what it spends, which it currently does not:
`handleAskRequest.ts:306` charges `aiQuotas()` and never `aiStepQuotas()` or
`settleAiSteps`."* **That has been false since ADR-033's merge.** `handleAskRequest` charges
`consumeQuota([...aiQuotas(), ...aiStepQuotas()], userId)` and settles through
`settleAiSteps` in the recorder's sink — KI-67's fix moved onto `/ask` when it became the one
door. Corrected in place in M20's file, dated, rather than left for whoever builds link 9 to
discover. It makes link 9 smaller, not larger.

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

The wall must be **deny-by-default over `@/server/**` with an explicit allowlist**, not a
denylist of named modules.

**This is a correction, made 2026-09-10 after P1 built the denylist version this document
originally specified and reported that it does not hold.** The first draft named five
forbidden specifiers — `next/*`, `@/server/db/*`, `@/server/pages`, `@/server/auth`,
`@/server/pages-guard` — and claimed *"everything the kernel needs from those arrives as an
injected port."* That claim was false on the day it was written and lint agreed with it:
`search_playbooks` imports `discoverDays` from `@/server/playbooks`, `insert_playbook_day`
imports `readableSavedDay` from `@/server/savedDays`, and **both of those import
`./db/client`** (`playbooks.ts:17`, `savedDays.ts:12`). ESLint sees only direct imports, so
a five-name denylist is defeated by one hop — and the failure is silent, which is the worst
property a boundary can have.

A denylist is the wrong shape here for a reason that generalises: it has to enumerate what
is bad, so it is wrong every time someone adds a module, and it is wrong *quietly*. An
allowlist has to enumerate what is permitted, so it is wrong loudly, at the moment of the
change, in the diff of the person making it.

So: from inside `src/server/assistant/**`, **no `@/server/*` import at all** except a named
allowlist of modules that are provably pure (`@/server/ai/context` today), plus no `next/*`.
Everything else arrives as an injected port. `discoverDays` and `readableSavedDay` become
`AssistantDeps` ports in P2 — which is also the change that makes the tools declaring them
say so in their `needs`, so the audit property covers the library reads too.

That is what "could be its own service" means concretely — the module graph, not a
deployment — and it is a claim the wall has to be able to *prove*, not one the document gets
to assert.

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
