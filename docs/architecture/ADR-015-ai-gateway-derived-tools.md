# ADR-015: AI via Vercel AI Gateway, tools derived from schemas

**Status:** Accepted — 2026-07-20
**Deciders:** Mitchell (product/eng), Claude (architect)
Design spec: `docs/specs/2026-07-20-M7-solo-delight-design.md`

## Context

M7 adds AI-powered features: generating pages (via the macro registry) and
editing plans (via the command pipeline). Both features need a provider-agnostic
model access path with spend controls and a constrained, hallucination-safe tool
surface that prevents the model from inventing actions outside the user's
capability set.

An unconstrained approach (free-form prompting, hand-written tool definitions,
direct provider SDKs) creates token waste, hallucinated tools, and tool-schema
drift. A schema-derived, layered-defense approach — combining schema-constrained
generation with server-side pipeline validation — keeps the model safe without
losing capability.

## Decision

1. **All model calls route through Vercel AI Gateway.**
   Using `@ai-sdk/gateway` + `ai` (Vercel's provider-agnostic SDK), all model
   calls specify a provider-agnostic model string and route through the gateway.
   This centralizes spend caps, usage tracking, and provider A/B testing in one
   place. Environment: `AI_GATEWAY_API_KEY` (server-only secret). No client-side
   model access; all AI flows are server-mediated.

2. **Two derived tool families, never hand-written.**

   **Planning tools:** Each `@tc/contracts` command Zod schema becomes a tool.
   The Vercel AI SDK accepts Zod schemas natively; no translation layer needed.
   The model generates structured commands; they execute as one M6 atomic batch
   through the standard pipeline, producing a single history entry ("AI: added 3
   activities"). Layered defense: schema-constrained decoding stops most
   hallucination at generation; the pipeline rejects anything that slips
   through. **The model can do nothing a user couldn't** — the same validation
   that guards human commands guards AI output.

   **Page tools:** `insert_block` and `compose_page` (names TBD in the plan).
   Both take a macro vocabulary parameter; the vocabulary is a registry-generated
   enum derived from the `@tc/pages` macro registry entries. Unknown macro names
   fail schema validation before touching a document. Macro params are derived
   from each registry entry's Zod schema.

3. **Typed context envelope bounds hallucination and token use.**
   Each AI request carries a schema-defined context object specifying: (a) the
   user's current location (`tripId`, optional `dayRef`), (b) a **summarized**
   projection (day list with dates, activity names, cost totals — not full
   `TripDetail`), and (c) only the **surface-relevant** tool family (page tools
   when editing a page, planning tools when editing the plan; both families
   together only in a combined flow). This small action space + small context
   allows a cheaper model to suffice and reduces token waste.

4. **Layered defense: generation + execution validation.**
   Schema-constrained decoding at generation (tools defined by Zod schemas) +
   server-side pipeline/registry validation at execution (unknown macros rejected,
   bad params downgraded or rejected, commands validated by the standard command
   pipeline) means the model is doubly constrained. If generation somehow hallucinates
   a tool or schema violation, execution catches it.

## Consequences

- Vercel AI Gateway integration in `apps/web/src/server` (AI generation handlers).
- New environment variable: `AI_GATEWAY_API_KEY` (required at deploy time).
- Tool derivation code: `@tc/contracts` and `@tc/pages` emit tool definitions
  (Zod schemas) consumed by the Vercel AI SDK. No hand-written tool manifests.
- AI requests are always server-mediated; clients send user intent, servers
  invoke the model with the appropriate context envelope.
- Validation before page insert: unknown macros or bad params are rejected or
  downgraded to plain text; the page never receives a malformed node.
- AI edits to the plan flow through the standard M6 atomic-batch pipeline, so
  they undo/redo/revert as a single unit and appear in trip history with a
  synthetic actor ID.

## Alternatives rejected

- **Free-form prompting (no derived tools).** The model would invent tool names,
  hallucinate params, and consume unbounded context. Cost and safety are both
  unacceptable.
- **Hand-written tool definitions.** Tool schemas would be defined separately
  from `@tc/contracts` command schemas and the `@tc/pages` registry, creating
  drift, duplication (violating Invariant 5), and maintenance burden. Derived
  tools bind the source of truth to the source code it came from.
- **Direct provider SDK (OpenAI, Anthropic, etc.).** Losing the gateway means
  losing provider-agnostic model strings, spend-tracking aggregation, and
  easy A/B testing across providers. Multi-provider switching becomes painful.
