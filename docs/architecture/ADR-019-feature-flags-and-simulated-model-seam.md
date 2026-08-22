# ADR-019: Feature flags via Vercel Flags, and the AI kill switch via a simulated model seam

**Status:** Accepted — 2026-08-19
**Deciders:** Mitchell (product/eng), Claude (architect)
Design spec: `docs/specs/2026-08-19-feature-flags-and-ai-kill-switch-design.md`

## Context

The app is about to be shared publicly. `AI_GATEWAY_API_KEY` (ADR-015) sits
behind `/api/trips/:id/ai`, an endpoint any authenticated visitor can call in
a loop — there is no spend control between a visitor and the model gateway.
The repo has no flag infrastructure at all: no mechanism exists for turning
any behavior on or off without a deploy.

This is an off-roadmap insert — feature flagging appears in neither M9 nor
M10 — made deliberately and called out rather than silently absorbed (per
`AGENTS.md`'s scope-creep rule). See `docs/STATUS.md` for the resume point it
does not disturb.

## Decision

1. **Flags are declared with the Flags SDK against the Vercel adapter, in
   `apps/web/src/server/flags.ts`, declarations only.** The module exports
   nothing but flag definitions — `getProviderData(flags)` in the discovery
   endpoint (below) enumerates every export of this module and expects each
   one to be a flag; a stray helper export would be skipped at best and throw
   at worst, so accessors like `aiLive()` live elsewhere
   (`server/ai/modelSelection.ts`). Flag values are read only from
   `src/server` — the same rule as `server/config.ts` — and reach UI code, if
   they ever need to, as props from a server component, never by a client
   component importing this module.

2. **The AI kill switch is implemented by swapping the injected model, not by
   branching the handler.** `handleAiRequest` already accepted an injectable
   `model?: LanguageModel` — a seam originally built for tests. Reusing it
   means the "off" path is not a parallel code path: `resolveBatch`,
   `enrichCommandLocations`, `flushPlanningBatch`, `summarizeBatch`, the
   `meta` envelope, the event append, and the projection update all run
   exactly as they do for a real model, unaware anything is different. The
   trip really mutates, and the response carries `simulated: true`.

   The actual implementation has a nuance the design spec's first pass didn't
   settle correctly: `simulated` is **not** simply "false whenever a model is
   injected." `handleAiRequest` derives it by an identity check against
   `SIMULATED_MODEL_ID` (`simulatedModel.ts`'s sentinel `modelId`):

   ```ts
   const selected = model
     ? { model, simulated: requestedModelId(model) === SIMULATED_MODEL_ID }
     : await selectAiModel(surface);
   ```

   This is deliberate: `route.int.test.ts`'s "simulated mode" tests inject
   `simulatedModel()` directly (to assert its plan-application behavior — an
   empty `locationReport`, deterministic tool calls — without touching
   `AI_LIVE` or the flag), so `model` being present can't by itself imply
   "not simulated." Only its identity can. When no model is injected — every
   real request — `selectAiModel(surface)` consults the flag and returns
   this same `{ model, simulated }` shape itself.

3. **Fail closed.** The flag's `defaultValue: false`. The Flags SDK falls
   back to `defaultValue` whenever `decide` returns `undefined` **or
   throws** — adapter errors included — so an unreachable Flags service
   degrades to simulated, never to spending.

4. **`AI_LIVE` is a local/CI override living in `aiLive()`
   (`modelSelection.ts`), not in the flag's `decide`.** The SDK treats an
   explicitly-provided `decide` as an override of the adapter: a `decide`
   that returns `undefined` to "fall through" to Vercel triggers
   `defaultValue` instead, never reaching the adapter — so "check the env
   var, else ask Vercel" is not expressible inside the declaration itself.
   The override sits one level up:

   ```ts
   export async function aiLive(): Promise<boolean> {
     if (process.env.AI_LIVE !== undefined) return process.env.AI_LIVE === "true";
     return aiLiveFlag();
   }
   ```

   Strictly `"true"` and nothing else — a typo fails toward not spending
   money. On Vercel this variable must stay unset; the flag is the sole
   source of truth there.

## Consequences

- A Vercel platform dependency: the Flags SDK, the `@flags-sdk/vercel`
  adapter, and (for the discovery endpoint) `FLAGS_SECRET`. Whether the
  Flags product itself is available on the account's plan was a risk noted
  in the design spec, resolved before this ADR was written.
- Simulated plans write real events. A visitor exercising the assistant
  while AI is off permanently mutates that trip's history — undoable like
  any other command, but not a read-only preview.
- A Flags outage silently downgrades live AI to simulated AI. Mitigated, not
  eliminated, by the on-screen "Simulated" badge and the response's notice
  text.
- Per-user targeting is one `identify` option away: the flag is evaluated
  after `guard()` establishes the session, inside a request scope where
  cookies are available, so adding `identify: dedupe(...)` later is additive
  to the declaration and does not move the call site. Not built now.
- New dependencies: `flags`, `@flags-sdk/vercel`. New environment variables:
  `FLAGS_SECRET` (Preview/Production) and `AI_LIVE` (local/CI only, never on
  Vercel).
- The lint wall's exemption widened. The Flags Explorer's discovery endpoint
  must live at the fixed path `src/app/.well-known/vercel/flags/route.ts` —
  neither `src/server/**` nor `src/app/api/**` — but needs to import
  `@/server/flags`. `eslint.config.mjs`'s ignore list gained
  `src/app/.well-known/**`, justified as the same "protocol endpoint, not
  UI" exemption already granted to API routes. `scripts/check-lint-wall.mjs`
  still asserts an ordinary UI file importing `@/server/*` is rejected, so
  the exemption did not silently grow beyond this one fixed path.
- The AI response envelope (now including `simulated`) still isn't
  schematized in `packages/contracts` — filed as KI-22 in
  `docs/known-issues.md`.

## Alternatives rejected

- **A canned refusal.** An early return in the route emitting a fixed "AI is
  off" message would be simpler, but leaves everything downstream of the
  model unexercised — a visitor clicking the assistant hits a dead end
  instead of a real (if simulated) demo. The goal was "test functionality as
  if it was on"; a refusal doesn't meet it.
- **Edge Config.** Would work, but trades the Vercel dashboard's built-in
  flag UI and the Toolbar's per-session override for hand-managed JSON and
  hand-written targeting logic — strictly more to build and maintain for the
  same result.
- **Flagging LocationIQ geocoding too.** Would break the map — the best demo
  surface — for negligible additional savings: the simulated model already
  emits no `location` fields, so `enrichCommandLocations` no-ops and no
  geocoder call happens on the simulated path regardless. Flagging it
  separately would have added a second control for no additional spend
  protection.
