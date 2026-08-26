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

## Amendment — 2026-08-25: the seam is a controlled chokepoint, and it must survive a second entry point

Recorded on Mitchell's decision, 2026-08-25, while scoping **M16** (ADR-022):

> *"Being able to control major chunks of functionality for specific users is
> important. In the future I might make only pro accounts able to use AI."*

This amendment does not change any decision above. It states the invariant those
decisions produced, makes it **enforced rather than conventional**, and widens the
decision point so per-user entitlement can be added inside it later without
touching a single call site.

### 1. The invariant, stated

Exactly two functions carry this, and no others may:

| Function | Sole responsibility |
|---|---|
| `server/ai/gateway.ts` → `aiModel()` | **Constructs** the Vercel AI Gateway client. The only place an `AI_GATEWAY_API_KEY` is ever used. |
| `server/ai/modelSelection.ts` → `selectAiModel()` | **Decides** whether that client is used at all. The only reader of the `ai-live` flag and of `AI_LIVE`. |

Every AI feature reaches a model by asking `selectAiModel()`, never by
constructing one. As of this amendment that is already true in production code —
`aiModel()`'s only non-test caller is `selectAiModel()`, and `selectAiModel()`'s
only non-test caller is `handleAiRequest` — but it is true by comment and habit,
not by any mechanism.

### 2. Enforced by lint, not by comment

`apps/web/eslint.config.mjs` already carries two architectural import walls (the
domain wall and the `@/server/*` UI wall, both from `AGENTS.md`). The gateway
chokepoint becomes a third: **`@/server/ai/gateway` is importable only from
`server/ai/modelSelection.ts`** (and its own tests). Any other import is a lint
error naming this ADR.

The reason to do it now rather than when it is violated: M16 adds a **second AI
entry point** (`POST /api/trips/[tripId]/ask`). A convention that held while
there was exactly one caller is not evidence it will hold with two, and the
failure mode is silent — an endpoint that spends money with the kill switch off
would look entirely normal in review.

### 3. The decision point becomes actor-aware, and its outcome three-way

Two changes to `selectAiModel()`, both forward-looking:

**It takes the actor.** Today the signature is `selectAiModel(surface)`. It
becomes `selectAiModel({ surface, userId })`. `handleAiRequest` already resolves
the session before calling it — the existing comment there says selection happens
after `guard()` *precisely* so per-user targeting could be added later without
moving the call site — but the signature never carried the user, so "later" would
have meant editing every caller. Passing the actor now costs nothing and means a
pro-account check is a change inside one function.

Deliberately **not** assumed: that entitlement is a flag. The Flags SDK's
`identify` can target a user, but a paid tier is more likely a database fact than
a flag value. The signature carries the actor so either implementation fits; the
mechanism stays undecided until there is an account model (M15 owns the account
menu; there is no tier field anywhere today).

**Its outcome is three-way: `live` / `simulated` / `denied`.** This is the load-
bearing part. Decision 2 above makes "off" mean *simulated* — a canned model
emits tool calls and **the trip really mutates**. That is correct for a kill
switch, where the goal is that the product still works without spending. It is
**wrong for entitlement**: a user without access must get a refusal, not a
fabricated answer that edits their trip under them. Denial is a different
outcome, not a quieter model, and the return shape has to admit it before
anything depends on the boolean.

`denied` needs a caller contract, which M16 defines when it builds the second
endpoint: an HTTP status and a response shape the UI can render as "not
available on your plan" rather than as an error. Until an entitlement source
exists, `denied` is unreachable in production — the type exists, nothing returns
it.

### 4. What M16 must do

- Route the `/ask` endpoint through `selectAiModel()`. **No second gateway
  construction, no second flag read.**
- Land the lint rule in §2 as part of the wave that adds the endpoint, not after.
- Widen the signature and the outcome per §3, with `denied` unreachable but
  typed.
- Leave `GET /api/health/ai-mode` reporting the effective mode. It exists for
  KI-25 (e2e runs refusing to proceed against a live model) and for the
  observability KI-24 asks for, and a second entry point does not change it —
  the mode is a property of the seam, not of an endpoint.

### 5. What this is not

Not a rate limit, not a spend cap, not an authorization model. `rateLimit.ts`
exists separately, and access to a *trip* is `guard()`'s job. This is one
question only: **may this actor cause a model call, and if so which model.**

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
