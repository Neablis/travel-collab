# One AI route, tool sets scoped by server-resolved context

**Status: PROPOSED, not decided.** Written 2026-08-29 at Mitchell's request while
PR #88 (M16 + M9) was in flight. Nothing here is implemented, and nothing here
should be implemented inside PR #88 — ADR-022 §4 pins the command path for the
duration of that milestone. If accepted this becomes an ADR and its own
milestone or phase.

**Opened by:** Mitchell, 2026-08-29 — *"why are we not deprecating that old
endpoint if it's not used?"*, then *"i would prefer us having one route for AI,
and use the context to change if its notebook or travel planning, not the
endpoint, but i could see how having custom build endpoints could protect
excessive token usage through specificness."*

## The correction that started this

I had said `/ai` was unused because the assistant rail had stopped calling it.
**That was wrong**, and it is the reason this document leads with evidence
rather than with a proposal.

`/api/trips/[tripId]/ai` serves three surfaces. Their live callers, as of
`f8e2553`:

| Surface | Live caller | Status |
|---|---|---|
| `page` | `PageScreen.tsx:105` → `ComposePanel` → `composeAiPage` | **Live.** The Notebook's AI page authoring runs entirely on this. |
| `board` | none | **Dead.** No production code passes it. |
| `combined` | none | **Dead.** No production code passes it. |

`board` and `combined` survive only as a type union in `ComposePanel`'s props
and as `composeAiPlan`'s default parameter. There is exactly one `<ComposePanel`
mount in the codebase and it is `surface="page"`.

So the endpoint is not dead, but **two thirds of it is**, and the third that
lives does something `/ask` cannot do at all.

## The tension Mitchell named, and why it does not bite

The concern: a single endpoint offering every tool pays for every tool's schema
on **every model round-trip**, and specificity is what protects against that.

The concern is real and there is measurement behind it:

- The derived planning tool schemas measure ~816 tokens (2026-07-27 audit,
  recorded in `TODO.md`'s AI cost item).
- Mitchell's own live `/ask` run on 2026-08-29 offered **15 tools** and called
  **4**. `find_free_time` — a tool ADR-022 §1 specifically justified as earned
  by a computation — went uncalled while `read_day` ran six times.

So more tools in scope costs tokens *and* appears to degrade selection.

**But the endpoint is not what bounds the tool set — the tool-set selector is,
and both endpoints already have one.**

- `/ai` picks by `surface`: `TOOLS_BY_SURFACE` in `context.ts` maps
  `page → [page]`, `board → [planning]`, `combined → [planning, page]`.
- `/ask` picks by the resolved guard: `offeredToolNamesFor` gives a viewer read
  tools only, an editor read + write.

Neither of those mechanisms depends on living at its own URL. One route whose
tool set is selected per turn gives the single door **and** the narrow tool set.
Endpoint count and tool-set width are independent axes, and only the second one
costs tokens.

## What a separate endpoint genuinely buys, and how to keep it

One thing, and it is worth keeping: a **capability boundary the client cannot
talk its way past**. `/ask` cannot author a Notebook page no matter what the
client sends, because it has no such tool.

The way to preserve that under one route is the rule `/ask` already follows, and
which ADR-022 §3 states for identity:

> **The tool set is derived from server-resolved facts — the access guard, and
> the surface the request provably came from — never from a `context` field the
> client supplies.**

A client-supplied `context: "notebook"` that the server trusts to pick tools is
the same class of mistake as a client-supplied `tripId` on a read tool, which
ADR-022 §3 already forbids. If the surface cannot be resolved server-side, it
must be treated as the *narrowest* tool set, not the widest.

## Proposed shape

1. **One route: `/api/trips/[tripId]/ask`.** It is the better substrate —
   streaming, multi-turn, approval-carrying — and `/ai`'s reply is derived from
   committed commands, which ADR-022 already records as structurally unable to
   answer a question.
2. **The tool set is chosen per turn from server-resolved context**: the access
   role (already done), plus which surface the turn came from. Page authoring
   becomes a tool family on that agent rather than a separate endpoint.
3. **`compose_page` moves as a derived family**, not a rewrite. ADR-015 §2
   requires it stay derived from the `@tc/pages` macro registry; that property
   is preserved, only its host changes.
4. **`/ai` retires in two steps**, because its two halves are not equally ready:
   - **`board` and `combined` can retire immediately** — no caller, and `/ask`
     supersedes them with propose → review → approve, which is strictly better
     than commit-on-arrival.
   - **`page` retires only once the agent carries page authoring** and the
     Notebook client is moved onto it.

## What it costs — the honest list

- **The Notebook client is a rewrite, not a re-point.** `ComposePanel` awaits a
  non-streaming `{ content }` and hands it to `onApply`. The agent streams. That
  is the real work in this proposal, and it is not small.
- **`handleAiRequest`'s accumulated correctness would have to come with it.**
  That file carries the step-budget reasoning, `AI_MAX_STEPS`, the truncation
  notice, geocode enrichment and the quota ordering — each of which exists
  because of a specific past failure recorded in its comments. Retiring the
  endpoint must not retire those lessons.
- **`resolveBatch` is shared already.** `/ask`'s write tools call the same
  resolver and the same `flushPlanningBatch`, per ADR-022 §4. So the *pipeline*
  is already one; this proposal is about the *door*, which is a smaller change
  than it first appears.
- **It closes KI-87 by construction.** That divergence — `/ask` defaulting a new
  activity to `hold` while `/ai` defaults to `planned` — exists only because two
  doors share a resolver but not a creation path.

## What would make this a bad idea

Recorded so the decision is honest rather than one-sided:

- If page authoring and trip planning turn out to want genuinely different
  agents — different instructions, different step budgets, different stop
  conditions — then one route with a branch inside it is two agents wearing one
  URL, and the seam is in the wrong place. The evidence to watch is whether the
  two ever need different `stopWhen` or different system instructions beyond
  their tool lists.
- If `uncalledTools` keeps showing the model ignoring tools it is offered, the
  answer may be *fewer tools per turn* rather than *one route*, and this
  proposal would be optimising the wrong axis. **Wave 3's analytics are the
  instrument for that, and they now exist** — decide with a week of records, not
  with this document.

## Recommendation

Accept the direction, sequence it after M16/M9's gate, and take the free half
now: **retire `board` and `combined` from `/ai`** — dead code with no caller —
in a small PR of their own, leaving `page` alone. That shrinks the endpoint to
the one thing it actually does, makes the eventual consolidation a single
well-understood move, and costs nothing.
