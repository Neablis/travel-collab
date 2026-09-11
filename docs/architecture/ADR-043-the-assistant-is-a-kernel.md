# ADR-043: The assistant is a kernel — a tool is a module, a scope is a grant, and admission is one pipeline

**Status:** **Accepted — 2026-09-10.** Mitchell's four decisions the same day are recorded
inline below; kicking off the M9 Phase 0 branch against it is the acceptance.
**Deciders:** Mitchell (product/eng); Claude (architect) — drafted
Related: **ADR-033** (one AI route — this says what is *behind* that door), ADR-019 + its
2026-08-25 and 2026-09-08 amendments (the kill switch and the gateway chokepoint, both
unchanged), ADR-037 (a widget is a module — the shape this borrows), ADR-015 Invariant 5
(tool schemas are derived, never hand-written twice), ADR-042 (the assistant inserts a
playbook day)
Design and cost accounting: `docs/specs/2026-09-10-assistant-kernel-design.md`
Milestone: **M9 Phase 0** — `docs/milestones/M9-ai-planning-partner.md`

## Context

Mitchell, 2026-09-10, against KI-2026-09-05-t:

> i want a really easy to use, add functionality and audit system for […] Essentially all
> calls to Vercels AI service should be its own service that could if needed be its own
> service […] And most important, the ability to measure cost, tool calls, and leverage
> multimodel to do easy things (is this a question) from hard (Plan me a 6 day trip) […] It
> should be trivial to add a new tool and only use it in the contexts that make sense.

`handleAskRequest()` is one 455-line function running thirteen steps. That is not itself a
defect — the overnight review confirmed no reachable bug in it — but it is the shape that
makes the ~15 open AI known issues expensive to fix one at a time, and M9 was sized on the
assumption that it is fixed first.

Three properties cost the most, measured rather than asserted:

1. **Tool sets are stated twice.** `offeredToolNamesFor` is a hand-written switch tested
   against itself (F-F02). The tool modules already know which set they belong to.
2. **Every tool receives the same ambient context**, whether it reads it or not. No tool's
   dependencies are legible, and nothing stops a new one reaching what it should not.
3. **Cost is assembled at three points inside one callback**, with one term (the
   classifier's own round-trip) added back by hand because the observed record structurally
   cannot see it.

## Decision

The assistant becomes a **kernel** at `apps/web/src/server/assistant/`, behind an import
wall, under four rules.

### 1. A tool is a module that declares what it needs

`defineTool({ name, domain, effect, spend, input, output, needs, minimumRole, run })`.

`output` is a **required** zod schema — this is KI-9's July agreement (a model call that
requires an output schema, so a new un-parsed consumer is a type error) landed at the tool
boundary rather than as a separate wrapper. `needs` is a tuple of typed keys into a
dependency registry, and `run`'s second parameter is `Pick<AssistantDeps, Needs[number]>`:
a tool that did not declare the geocoder **cannot** reach it, as a compile error rather
than a convention. `spend: "none" | "vendor"` makes the set of paths to a vendor key a
filter over the registry instead of something a reviewer has to notice — which is the
invisibility KI-93 is made of.

**Derivation is unchanged.** `defineTool` is the envelope; derivation stays the body. The
write tools are still emitted from `@tc/contracts` command schemas and the page tools from
the `@tc/pages` macro registry, so a thirteenth command still yields a thirteenth tool with
no hand edit (ADR-015 Invariant 5).

### 2. A scope is a grant of (domain, effect) pairs, and the tool set is a filter over it

Domains: `itinerary | library | pages | places | account | system`. Effects: `read |
propose` — nothing a tool does commits, which stays a property of the shape.

A surface grants a **list of (domain, maxEffect) pairs**, and `toolsFor(grant)` filters the
registry. ADR-033 Decision 4's narrowing — *"a page turn holds no planning write tool, and
a planning turn holds no page insert tool"* — stops being a sentence that three hand-written
constants have to keep true and becomes the `itinerary` domain capped at `read` on the page
surface and the `pages` domain absent from the planning one.

`minimumRoleFor` becomes `max(minimumRole)` over the set **actually selected**, which is
what its own comment already says it wants to be. `offeredToolNamesFor` and the three name
manifests are deleted.

Adding a tool that belongs on one surface is one tag. Adding a surface is one row.

### 3. Admission is one declared pipeline returning one verdict and one audit record

The thirteen steps become an array of named stages — `refuseDemoTrip, identifyActor,
capRawBody, parseRequest, resolveSurface, selectModel, admitQuota, classifyTask` — returning
`{ ok: true; grant } | { ok: false; refusal }`.

**The ordering becomes a value.** Three of its transitions are recorded incidents (charging
before model selection burned a caller's whole allowance against an outage that made zero
provider calls; a malformed request must not cost an allowance; a bad page id must cost
nothing). Today they are defended by comments. As an array they are defended by a test that
asserts the sequence, and each comment moves onto its stage.

One `ai.grant` record per turn names the actor, the granted pairs, the tools actually
offered, the model chosen, and — on refusal — which stage refused and why. **That record is
the answer to "what is and isn't allowed."**

### 4. Cost is a return value, and the model is chosen by task class

`TurnLedger` — **`cost`** (model tokens: turn and classifier separately, no currency type
anywhere), **`capacity`** (vendor call counts, never summed into cost) and **`toolCalls`** — is
what a turn returns. The analytics log, the Sentry metrics and the step settlement become
readers of it rather than three assemblies of it.

The classifier's output widens from `question | write` to a task class, and the class picks
a model tier: `question` → cheap, `edit` → mid, `plan` → strong. `compose` is decided by
the **surface**, not the classifier, for the same reason a page turn is not classified
today. Every tier still resolves through `selectAiModel()` — ADR-019's chokepoint and its
lint wall are untouched, and the kill switch still covers every call. Uncertainty resolves
*upward*, toward the stronger model, the same bias `askIntent` already applies.

**A tier is the name of a slot, and the model filling it is an input** (Mitchell,
2026-09-10: *"that cost is not forever, and the model we use might change, so that needs to
be a variable input in the system"*). No model id is a literal in kernel code; the kernel
never multiplies tokens by a price; pricing is a downstream join against a dated,
append-only rate record. Every ledger row carries the **resolved** id of every model the
turn actually used, and `/api/health/ai-mode` grows the resolved tier map — because
`config.ts` compiles a default of `anthropic/claude-haiku-4-5` while production runs
`deepseek/deepseek-v4-flash-0731`, and M20 link 5 records that gap already costing one
estimate an order of magnitude. Spec §5b.

## Consequences

**Good.** The 455-line body becomes orchestration. Adding a tool is one file and one tag.
"What may this actor do, and what did it cost?" is one function and one record. KI-9's
type-forcing lands. KI-93 and KI-94 get a place to be fixed rather than a place to be
described. A question stops paying a planning model's price.

**Costs, accepted.** Six phases, six PRs, interposed ahead of M17's then-open gate boxes —
Mitchell's
placement decision, on the KI's own argument that this is a schedule multiplier on every
M9 task. A misrouted `plan` on a cheap tier is a quality regression the upward bias
mitigates but does not eliminate. The kernel lives behind a lint wall rather than a package
boundary, which is weaker than the compiler; see below.

### 5. The ports are shaped by M20, not merely left for it

**Added 2026-09-10, Mitchell:** *"Lets make sure to take into consideration the upcoming
milestone around stripe and people paying for there account, and limits to the AI agent
depending on the tier, that might influence design decisions about how we structure
measureing and build."* It did — four things changed rather than being confirmed. Full fit
check in the spec, §7.

- **`TurnLedger` is the `ai_usage` row, field for field** (M20 link 9), so that link is an
  `INSERT` and a migration rather than a redesign. Turn and classifier tokens stay
  **separate** — folding them would undo the reason the classifier has its own model id.
  **No dollars and no `Money` anywhere in it**: a live request costs $0.0011 and `Money`'s
  integer minor units round that to zero, which is the KI-1/KI-14/`budgetPerPerson` defect
  class on its third recurrence.
- **Cost and capacity are two ledgers, not two fields of one** — a correction to the first
  draft, forced by M20's *"attribute marginal cost only"*. Model tokens are billable; the
  geocoder is a daily-capped free tier, which is a capacity limit. The type keeps them apart
  so nobody has to remember not to sum them. KI-93 settles against the capacity half.
- **The entitlement port is a set with ceilings, not a boolean.** `has(capability)` and **no
  comparison operator at all** — M20's *"a plan is a set, not a rank"*, where copying
  `accessPolicy.ts`'s `RANK` is the obvious move and the wrong one. Resolved `async`, per
  request, from the database, because a downgrade must bite before a token refreshes.
- **`ai.ask` and `ai.command` are rule 2's effect axis.** M20's entitlement vocabulary maps
  onto `read` and `propose`, so the plan gate is a **third input to the existing filter**
  rather than a second mechanism: `min(surface.max, roleAllows, planAllows)`. That is the
  strongest reason to build rule 2 as (domain, effect) pairs instead of three named sets.
- **Per-tier ceilings need no reordering.** M20 link 5 has `aiQuotas()`/`aiStepQuotas()` take
  entitlements. Rule 3's pipeline already runs `selectModel` before `admitQuota`, forced by a
  recorded incident — and that is exactly the order resolving ceilings requires. The
  incident's order and the tier requirement agree.

**Not decided here.** Which tier grants what, what any ceiling is, and what anything costs
are **M20's**, under four rules Mitchell decided 2026-09-01. This work builds only the ports
they fill and chooses no tier, ceiling or price. M21 (Stripe) needs nothing from the kernel
at all: payments never enter it, and what M21 consumes is the series link 9 stores. KI-22 (the stream envelope into `packages/contracts`) is
its own PR, because AGENTS.md reserves a contracts change as one. `resolveBatch` is not
rewritten; KI-10 needs its own call.

**Corrected 2026-09-11, after P5.** Decision 4 above carried §6's *first draft* — "model
calls, tool calls, vendor calls" — for a day after §7b had already split cost from capacity,
so the ADR's two halves disagreed about the type the phase builds. P5 found it while building
against both. `compose` routes to the `mid` tier, which decision 4 never assigned: a page turn
writes a bounded amount into one page. That is a choice, not a derivation.

**Corrected 2026-09-10, after P1.** The import wall is **deny-by-default over `@/server/**`
with an allowlist**, not a denylist of named modules. The denylist first specified here was
built and reported unsound on the same day: two tools reach `./db/client` transitively via
`@/server/playbooks` and `@/server/savedDays`, ESLint sees only direct imports, and lint
passed. A boundary that fails silently is worse than none; an allowlist is wrong loudly, in
the diff of whoever widens it. `defineTool` also takes a required `description` — omitted
from decision 1's field list, and the SDK requires it. Spec §"Where it lives".

**Nothing in the comment record is deleted.** `handleAskRequest.ts` is ~583 lines of
comments recording incidents, and they look like bulk. Each moves with the step it
describes (F-E07's explicit "do not").

## Alternatives considered

**`packages/assistant` instead of a lint wall.** The compiler would enforce the boundary for
free, which is strictly stronger. Rejected because `packages/*` have no ESLint configuration
at all (KI-2026-09-02-c), and the move would put the most security-sensitive code in the app
somewhere unlinted. The wall is written so the import graph is already correct if that KI
closes and the extraction becomes a `git mv`.

**A predicate on each tool instead of a domain tag.** More expressive; auditability was the
requirement, and a set membership is readable at a glance where a predicate is not.

**Moving the `Scope:` line out of the system prompt.** It is the one channel reaching both a
real model and the simulated one, and it is server-authored, so it is not an injection
vector. It stays, as a labelled data block.

**Splitting the handler without the type work first.** This is what "split into ~5
functions" would have been. It moves the 455 lines into five files and closes none of the
~15 known issues, because those are consequences of untyped boundaries rather than of
function length.
