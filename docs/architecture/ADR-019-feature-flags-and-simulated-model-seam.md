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
  `docs/known-issues.md`. **Closed 2026-09-11** by M9 Phase 0 P6, which put the
  `/ask` stream envelope in `packages/contracts/src/assistant.ts` and moved
  `SIMULATED_HEADER` there with it — the verdict stays a header, for the reason
  this ADR gives for setting it before a byte of the stream. The entry is now
  `docs/known-issues/resolved/` (the single file this line points at was split
  per-entry on 2026-08-30, KI-95).

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

## Amendment — 2026-09-08: per-user targeting, built (Vercel Entities)

Recorded on Mitchell's request, 2026-09-08:

> *"Can you implement Vercel Entities so i can do targeted Feature Flags for
> turning on AI?"*

The original decision left this one option away and said so: *"Per-user
targeting is one `identify` option away … Not built now."* This amendment is
that option being taken. Nothing above is reversed.

### 1. What was built

`apps/web/src/server/flagEntities.ts` — a new module holding the **entities**
this app publishes about the caller, and the `identify` that produces them.
`aiLiveFlag` gains `identify: identifyFlagEntities` and a second type parameter;
that is the entire change to the declaration, exactly as §6 of the design spec
predicted.

It is a **new module rather than a few lines in `server/flags.ts`** for the
reason Decision 1 already gives: that module is declarations only, because
`getProviderData(flags)` enumerates every one of its exports and expects each to
be a flag. `identifyFlagEntities` would have been the second thing it broke on.

### 2. The entities, and why exactly three

| Attribute | Why it is published |
|---|---|
| `user.id` | The Auth.js user id, which is `actor_id` verbatim. The only identifier stable across sign-ins, and therefore the only sound thing to bucket a percentage rollout by (`vercel flags rollout ai-live --by user.id`). |
| `user.email` | The handle a rule is actually written with. `id` is `google-<sub>` — an opaque number — so targeting by it alone would mean copy-pasting uuids out of Postgres to turn AI on for one person, which is the task this exists to make easy. |
| `user.emailDomain` | So "everyone at my company" is one `eq` rule instead of one per person, without depending on which string operators the dashboard offers on `email`. |

The list stays this short deliberately. These attributes are sent to Vercel on
every evaluation; Vercel already runs the compute this app is deployed on and
already holds all three, so no new processor sees them — but it is still a real
export of identity, and each addition should have to justify itself the way
these do.

### 3. Targeting may only WIDEN. The dashboard fallthrough is part of the design

A caller no rule matches falls through to the flag's dashboard default. A
signed-out caller is one of those: `identify` publishes **no `user` key at
all** for them, rather than a user with blank attributes, so no user-keyed rule
can match — an entity keyed on `""` would otherwise let one rule match every
unidentifiable caller at once.

Therefore: **the `ai-live` fallthrough must stay "Simulated".** Rules turn live
AI *on* for named people; they are never the thing keeping everyone else off it.
This is a configuration the code cannot enforce, so it is stated where the
commands that set it are (`docs/guidelines/environments-and-deploys.md`).

### 4. This is targeting, not entitlement — the amendment above still stands

The 2026-08-25 amendment's three-way outcome is untouched. A user no rule
matches gets **`simulated`**, not `denied`: they still get a working assistant
that mutates their trip and badges itself, which is the whole point of the kill
switch being a model swap. `denied` remains reserved for entitlement — a
database fact about an account tier, per §3 of that amendment — and remains
unreachable in production. Flag targeting and entitlement are two questions with
two answers, and folding the first into the second would have made "you are not
in the rollout" indistinguishable from "your plan does not include this".

### 5. Failing closed survives, by one verified detail

`identify` runs **before** the SDK's `defaultValue` machinery: `getEntities` is
called ahead of `applyResult` (verified in `flags@4.3.0`, `dist/next.js`). So an
`identify` that throws — a failed session read — escapes the flag call entirely
and is **not** covered by `defaultValue: false`.

Two consequences, both deliberate:

- `flagEntities.ts` has **no try/catch**. Swallowing the failure would publish
  `{}`, i.e. "anonymous", which falls through to a dashboard configuration
  rather than to a guarantee.
- The catch that matters is the one `aiLive()` already had, for the
  `readOverrides` case. It now covers this too, and its comment says so.

Off remains the answer to every question this flag cannot resolve.

### 6. `GET /api/health/ai-mode` had to say WHERE its answer came from

Per-user targeting silently broke a guarantee KI-25 bought. That endpoint
reported `{ live }`, and e2e's `global.setup.ts` refused to run a suite unless
it read `false`. But the probe is unauthenticated: once a rule can serve "Live"
to a named user, an anonymous `live: false` says nothing about the signed-in
user the specs sign in as moments later.

So `aiLive()` is now a thin reader over `aiLiveMode()`, which returns
`{ live, source: "env" | "flag" }`, and the endpoint reports both. `"env"` means
`AI_LIVE` decided it and the flag was never consulted — a fact about the server,
true of every caller. `"flag"` means Vercel Flags answered for this caller only.
`global.setup.ts` now requires `source === "env"`, which is a **tightening**: an
unset `AI_LIVE` used to pass on a `false` from the flag and now refuses.
`.env.example` ships `AI_LIVE=false` and CI sets it in the workflow env, so both
supported lanes are unaffected.

### 7. `auth` is imported lazily, and that is not a style choice

`@/server/auth` reaches `server/users.ts` → `server/db/client.ts` →
`server/config.ts`, which **throws at module load when `DATABASE_URL` is
unset**. A static import would put that in `server/flags.ts`'s module graph and
therefore in the discovery endpoint's — so `.well-known/vercel/flags`, a
protocol route that needs no database and builds without one today, would start
failing Next's page-data collection in any checkout without an `.env.local`.
`docs/guidelines/cloud-agent-sessions.md` documents what that failure looks like
and how long it takes to recognise; it is not a cost worth paying for a static
import.

### 8. What is still not built

- Any second flag, and any general flag-driven UI gating pattern. `identify` is
  written to be shared: a second flag reusing the same function reference is
  deduped to one session read per request, and the SDK groups flags by their
  identify reference into a single `bulkDecide` call.
- Entitlement (`denied`). Unchanged from the 2026-08-25 amendment.
- Any entity that is not the user — a trip, say. `Identify` receives only
  `{ headers, cookies }`, so a `tripId` from the route path is not reachable
  from it; targeting by trip would need a different mechanism, not a wider
  entity.

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
