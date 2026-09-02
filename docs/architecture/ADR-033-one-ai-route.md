# ADR-033: One AI route, with the tool set chosen from server-resolved context

**Status:** Accepted — 2026-09-01
**Deciders:** Mitchell (product/eng), Claude (architect)
Design spec: `docs/specs/2026-08-29-one-ai-route-design.md` — written 2026-08-29
at Mitchell's request and left **PROPOSED, not decided** because ADR-022 §4
pinned the command path while PR #88 was in flight. This ADR is the decision it
was waiting for; the spec's evidence and cost list are not restated here.
Amends: **ADR-022 §4** (see Decision 5)
Related: ADR-015 (AI gateway and derived tools), ADR-019 (feature flags and the
simulated model seam), ADR-031 (the demo trip needs no row)

## Context

The app has two AI entry points. `POST /api/trips/[tripId]/ai` is the older
command endpoint: non-streaming, editor-gated, commit-on-arrival, with a
`surface` union of `page | board | combined`. `POST /api/trips/[tripId]/ask`
(and `/ask/apply`) is the M16/M9 agent: streaming, multi-turn, viewer-gated,
read tools plus write tools behind propose → review → approve.

Two doors sharing one pipeline has already produced three recorded defects:

- **KI-87** — a stop created through `/ask` defaults to `kind: hold`; the same
  model output through `/ai` defaults to `planned`. `withDefaultKind` lives in
  `writeTools.ts` and `handleAiRequest` never reaches it.
- **KI-80** — the twelve-case switch over `BatchableCommand["type"]` exists
  twice, in `summarizeBatch` (past tense) and `describeProposedChange`
  (conditional). A thirteenth command fails to compile in two places.
- **The step quota regression.** `aiStepQuotas`/`settleAiSteps` were built by
  **KI-67**, which measured that metering *requests* rather than *steps* turned
  a nominal ceiling of 30 into a real ceiling of 960. That fix was wired into
  `handleAiRequest` only. `/ask` — built afterwards, and the door users actually
  reach — charges `aiQuotas()` alone and never settles, so it is metered exactly
  the way KI-67 proved was wrong.

The last of these is the sharpest argument. It is not a new bug; it is a
resolved bug reintroduced by the existence of a second door, on the door that
replaced the one the fix was written for. Any control added to one door has to
be remembered onto the other, and this one was not.

**Two thirds of `/ai` is already dead.** Its live callers, re-verified against
`dd5ae12`: `page` is live (`PageScreen.tsx:105` → `ComposePanel` →
`composeAiPage`); `board` and `combined` have **no production caller at all** —
`composeAiPlan` is exported and reached only by its own tests.

## Decision

**1. `/api/trips/[tripId]/ask` is the one AI route.** It is the better
substrate — streaming, multi-turn, approval-carrying — and ADR-022 already
records why the command endpoint is structurally unable to answer a question:
its reply is derived from *committed commands*, so a question that changes
nothing returns "I couldn't turn that into any changes."

**2. The tool set is chosen per turn from server-resolved facts — never from a
client-supplied field.** This is the rule that makes one route safe, and it is
ADR-022 §3's identity rule extended to capability. The inputs are the access
guard (already done: `minimumRoleFor` gives a viewer read tools and an editor
read + write) and the surface the request provably came from. A client-supplied
`context: "notebook"` that the server trusted to pick tools would be the same
class of mistake as a client-supplied `tripId` on a read tool, which ADR-022 §3
already forbids. **If the surface cannot be resolved server-side, the narrowest
tool set applies, not the widest.**

This preserves the one thing a separate endpoint genuinely bought: a capability
boundary the client cannot talk its way past.

**3. Endpoint count and tool-set width are independent axes.** Mitchell's
concern when the spec was written — that one endpoint offering every tool pays
for every tool's schema on every round-trip — is real and measured (~816 tokens
for the derived planning schemas; a live run offering 15 tools and calling 4).
It is not, however, an argument for two URLs: both doors already bound their
tool sets by a selector, and neither selector depends on living at its own
address. Only tool-set width costs tokens. Narrowing it further is a separate
question, to be decided with a week of `ai.ask` analytics rather than by
endpoint topology.

**4. `/ai` retires in two steps, because its halves are not equally ready.**

- **`board` and `combined` retire immediately** — no caller, and `/ask`
  supersedes them with propose → review → approve, which is strictly better
  than commit-on-arrival.
- **`page` retires once the agent carries page authoring** and the Notebook
  client is moved onto it. `compose_page` moves as a **derived family**, not a
  rewrite: ADR-015 §2 requires it stay derived from the `@tc/pages` macro
  registry, and only its host changes.

**5. ADR-022 §4 is amended, not overturned.** That section reads: *"The command
path is untouched… `handleAiRequest`, `planningTools`, `batchResolver`,
`flushPlanningBatch`, `geocodeEnrichment` and `planSummary` are not modified and
not deleted."* It was a **scope fence for the duration of M16/M9**, and it did
its job — the read agent landed without reshaping the endpoint both doors share.
Its purpose is spent, not wrong. From this ADR: `handleAiRequest` and the `/ai`
route are deleted; `planningTools`, `batchResolver`, `flushPlanningBatch`,
`geocodeEnrichment` and `planSummary` **survive and stay shared** — they were
always the pipeline, not the door.

**6. The lessons in `handleAiRequest` move with the code, and the ones that no
longer apply are recorded as retired rather than dropped.** That file carries
the step-budget reasoning, `AI_MAX_STEPS`, the truncation notice, geocode
enrichment and the quota ordering, each written against a specific past
failure. Deleting the file must not delete the reasoning. Anything that does not
survive the move is written down here or in the milestone file, with why.

## Alternatives rejected

**Keep two doors and fix the divergences individually.** Rejected because it
treats each divergence as a bug rather than as the predictable output of the
structure. The step-quota regression is the proof: a control was added to one
door and simply never reached the other, silently, for the entire life of the
newer endpoint. Three recorded defects from one cause is a structural finding.

**Defer the whole thing until M14.** M14 owns the Notebook redesign, and the
Notebook is `/ai`'s only live caller, so there is a real argument that page
authoring should move once rather than twice. Raised and rejected by Mitchell,
2026-09-01: *"I would rather just close the two doors, and have 1 door, with all
that logic behind it… lets clean that up, and simplify our code today."* The
consequence is accepted explicitly — if M14 redraws the compose surface, the
client work here is redone. The server-side consolidation is not.

**One route, tools picked by a client-supplied context field.** Rejected under
Decision 2. It is the shape that makes a single route *less* safe than two, and
it is the reason Decision 2 is stated as a rule rather than left implicit.

## Consequences

- **KI-87 closes by construction.** Two doors shared a resolver but not a
  creation path, so `withDefaultKind` reached one and not the other; after this
  there is one creation path and nothing left to disagree with.
- **KI-80 does NOT close by construction.** The duplicated twelve-case switch is
  `summarizeBatch` (`planSummary.ts`, past tense) and `describeProposedChange`
  (`writeTools.ts`, conditional), and **both survive and both stay reachable
  from `commitProposal`** — the proposal card needs the conditional mood and the
  post-approval receipt needs the past tense, which is a real distinction one
  door does not collapse. What changes is the *reason it is open*: KI-80 named
  ADR-022 §4 as its blocker, and that pin is lifted, so the refactor its own
  entry describes (`describeCommand(command, detail, mood)`) is now available.
  Both entries need their "waiting on the pin" language corrected.
- **The step-quota regression closes with the merge** — one door means one
  quota path, and KI-67's fix stops being something to remember twice.
- **`simulatedModel`'s `pageCalls()` branch must survive.** It has no `/ask`
  counterpart, and `ai-live` is off in every Vercel environment today, so
  without it a deployed app cannot author a Notebook page at all.
- **`simulatedModel`'s `doStream` throw for command surfaces is deleted, not
  relaxed.** It exists as a loud seam marking that the command path never
  streams; once there is no command path, the seam has nothing to mark.
- **The Notebook client is a rewrite, not a re-point.** `ComposePanel` awaits a
  non-streaming `{ content }` and hands it to `onApply`; the agent streams.
  This is the real cost of the decision and it is not small.
- **KI-79's demo-trip refusal survives unchanged and gets stricter, not looser.**
  `/ask` refuses `isDemoTripId` before the guard, before model selection and
  before the quota, because `requireTripAccess` answers the demo before
  `auth()`. Merging an editor-gated door into a viewer-gated one must not turn
  that refusal into a role check. The three decisions KI-79 lists as
  preconditions for opening the demo path are untouched by this ADR.
- **`AiCommandSurface` disappears** along with `TOOLS_BY_SURFACE`'s command
  entries and `buildEnvelope`'s surface branching. `AiSurface` survives for
  model selection and telemetry.
- **`docs/specs/2026-08-29-one-ai-route-design.md` moves from PROPOSED to
  ACCEPTED**, superseded by this ADR for the decision itself; it stays as the
  evidence and the cost accounting.
