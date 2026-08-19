# Feature flags via Vercel Flags, and the AI kill switch (design)

**Status:** Accepted — 2026-08-19
**Deciders:** Mitchell (product/eng), Claude (architect)
**ADR:** `docs/architecture/ADR-019-feature-flags-and-simulated-model-seam.md`
**Depends on:** ADR-015 (AI via Vercel AI Gateway, tools derived from schemas)

## What this is

Two things, in one pass:

1. **A feature-flag capability** for this repo, using Vercel's Flags product via
   the `flags` SDK — the first flag infrastructure the project has had.
2. **Its first consumer:** a kill switch on model calls, so the deployed app can
   be shared publicly without exposing an unbounded token bill.

The kill switch is not a refusal. With the flag off, the AI endpoint returns a
**simulated plan that really flows through the whole pipeline** — resolved,
geocode-enriched (vacuously), batched, appended to the event log, projected —
and is marked `simulated: true` on the wire. A visitor can exercise the
assistant, watch the board change, undo it, and inspect history, at zero token
cost and zero model latency.

## Why now, and why this is off-roadmap

`AGENTS.md` requires that scope creep past the current milestone's gate be called
out rather than absorbed. This is that call-out, made and accepted deliberately:

- Current milestone is **M10 Wave 2**; the resume point is **Phase 3 (the
  unscheduled rack)**. See `docs/STATUS.md`.
- Feature flagging appears in neither M10 nor M9.
- It is being inserted anyway because the driving need is external to the
  roadmap: the project is about to be shared with other people, and
  `AI_GATEWAY_API_KEY` currently sits behind an endpoint any authenticated
  visitor can call in a loop.

M10 Wave 2 Phase 3 resumes immediately after this lands. This insert does not
reopen or move M10's gate.

## The core decision

**Adopt the Flags SDK with the Vercel adapter as the project's flag mechanism,
and implement the AI kill switch by swapping the injected model rather than by
branching the request handler.**

The second half is the load-bearing part. `handleAiRequest` already accepts an
injectable `model: LanguageModel` — a seam built for tests, which inject
`MockLanguageModelV4`. Reusing that seam for the kill switch means the "off" path
is *not a parallel code path*: it is the same code path with a different model.
Everything downstream of `generateText` — `resolveBatch`, `enrichCommandLocations`,
`flushPlanningBatch`, `summarizeBatch`, the `meta` envelope, the event append, the
projection update — is untouched and unaware.

Rejected alternative: an early return in the route that emits a canned refusal.
Simpler (~40 lines), but the trip never changes, so nothing downstream of the
model is exercised and a visitor clicking the assistant hits a dead end. The
stated goal was "test functionality as if it was on"; a refusal does not meet it.

## Verified API surface

Checked against the published packages on 2026-08-19, not from memory:

| Fact | Source |
|---|---|
| `flags@4.3.0`, `@flags-sdk/vercel@1.4.6` both published | `npm view` |
| `flag()`, `getProviderData()`, `createFlagsDiscoveryEndpoint()`, `dedupe()` all export from `flags/next` | `dist/next.d.ts` |
| `defaultValue` is used when `decide` returns `undefined` **or throws**, async errors included; an adapter that throws also falls back to it | `dist/types-*.d.ts` |
| `FlagDeclaration` accepts `adapter` and `decide` together — **"explicitly provided values always override adapters"** | `dist/types-*.d.ts` |
| `Identify<E> = (params: { headers, cookies }) => E \| undefined` — identify receives **only headers and cookies** | `dist/types-*.d.ts` |

Two of these changed the design and are called out where they bite (§5, §6).

## 1. Module layout

```
apps/web/src/server/flags.ts                        flag declarations + accessors (server-only)
apps/web/src/server/ai/simulatedModel.ts            the fake LanguageModel
apps/web/src/server/ai/modelSelection.ts            flag -> which model
apps/web/src/app/.well-known/vercel/flags/route.ts  Flags Explorer discovery endpoint
```

`server/flags.ts` is server-only, same rule as `server/config.ts`. It is not
imported by UI code and the CI lint wall keeps it that way. Flag values reach the
UI, when they ever need to, as props from a server component — never by the
client importing this module.

The declaration:

```ts
import { flag } from "flags/next";
import { vercelAdapter } from "@flags-sdk/vercel";

export const aiLiveFlag = flag<boolean>({
  key: "ai-live",
  description:
    "When off, /api/trips/:id/ai returns a simulated plan instead of calling a model.",
  options: [
    { label: "Simulated", value: false },
    { label: "Live", value: true },
  ],
  defaultValue: false, // fail closed — see §5
  adapter: vercelAdapter(),
});
```

The **discovery endpoint** at `.well-known/vercel/flags` uses
`createFlagsDiscoveryEndpoint` + `getProviderData` (both from `flags/next`) and is
authenticated by `FLAGS_SECRET`. It is what makes the flag visible and
overridable from the Vercel Toolbar's Flags Explorer, which matters most on
preview deploys: a per-session override lets a reviewer flip to live AI without
changing the value for everyone else.

New dependencies: `flags`, `@flags-sdk/vercel`.

### The discovery endpoint needs the lint wall widened

`apps/web/eslint.config.mjs` restricts `@/server/*` imports to `src/server/**`
and `src/app/api/**`. The discovery route is at `src/app/.well-known/vercel/flags/`
— a path fixed by the Flags Explorer, and **neither of those**. So
`import { aiLiveFlag } from "@/server/flags"` inside it fails lint as written.

The honest fix is to widen the exemption rather than route around it:

```diff
-    ignores: ["src/server/**", "src/app/api/**"],
+    ignores: ["src/server/**", "src/app/api/**", "src/app/.well-known/**"],
```

`.well-known` routes are protocol endpoints, not UI — the same "exempt shell" the
existing ignore list already describes. The widening gets a comment saying so, and
`scripts/check-lint-wall.mjs` gains a case proving the wall still rejects a
`@/server/*` import from ordinary UI, so the exemption cannot silently grow.

The alternative — re-exporting the flags through a non-`@/server` path — would
satisfy the linter while defeating the rule, and is rejected.

## 2. The model seam

`handleAiRequest`'s signature changes in exactly one way:

```diff
-  model: LanguageModel = aiModel(),
+  model?: LanguageModel,
```

The default-parameter form is removed because a default is evaluated at call time
and would construct the real gateway client before the flag could be consulted.
In its place, inside the function and **after `guard()` has run**:

```ts
const selected = model
  ? { model, simulated: false }   // injected: tests, and only tests
  : await selectAiModel();        // real request: consult the flag
```

```ts
// src/server/ai/modelSelection.ts
export async function selectAiModel(): Promise<{ model: LanguageModel; simulated: boolean }> {
  return (await aiLive())
    ? { model: aiModel(), simulated: false }
    : { model: simulatedModel(), simulated: true };
}
```

Two consequences worth stating plainly:

- **Every existing test is unaffected.** They all inject a model, so they never
  evaluate the flag, never construct `aiModel()`, and never reach the network —
  exactly the property the long comment at the top of `handleAiRequest.ts`
  already asserts. That comment gets extended, and a test enforces the extension
  (§7).
- **The flag is evaluated after `guard()` on purpose.** `guard()` is where the
  session is established. Evaluating downstream of it means §6's per-user
  targeting is an additive change to the declaration, not a relocation of the
  call site.

`geocoder` keeps its existing lazy treatment, untouched.

## 3. The simulated model

`src/server/ai/simulatedModel.ts` hand-rolls a `LanguageModelV4` rather than
importing `MockLanguageModelV4` from `ai/test`, so no test utility ships in the
server bundle. It is the same shape the integration tests already fake — see
`modelWithToolCalls` in `apps/web/src/app/api/trips/[tripId]/ai/route.int.test.ts`.

Behavior, by surface:

| Surface | Emits |
|---|---|
| `board`, `combined` | `AddDay` x2, `AddActivity` x3, generic titles, **no `location`, no `cost`** |
| `page` | one `compose_page` call returning a canned `PageContent` that passes `validateComposedPage` |

Three properties matter:

1. **It terminates.** Tool calls on the first `doGenerate`, `finishReason: "stop"`
   on every subsequent one. A fake that re-emits on every step gets its calls
   collected once per remaining step — the failure `modelThatNeverStops` was
   written to document. `MAX_STEPS.board` is 32, so this is not a small mistake.
2. **It emits no `location`.** This is load-bearing, not incidental:
   `enrichCommandLocations` no-ops when there is nothing to look up, so LocationIQ
   spend is avoided *structurally* rather than by a second branch. This is how the
   "LLM only" blast-radius decision stays honest — the geocoder is not flagged,
   but the simulated path cannot reach it either.
3. **It is deterministic.** Fixed titles and counts, so e2e can assert exact
   content rather than "something happened".

## 4. Marking the response as simulated

Two channels, both additive.

**On the wire:** `simulated: true` at the top level of the response JSON, and
`meta.simulated` inside the existing audit envelope. `AiCallMeta` gains one
boolean.

**In the message:** a notice appended through the **existing `withNotices`
mechanism** that already carries `TRUNCATED_NOTICE` and the geocode notice — no
new plumbing, and it composes correctly with those:

> `Simulated response — AI is disabled on this deployment.`

**Client:** `PlanOutcome` in `apps/web/src/lib/apiClient.ts` gains
`simulated: boolean`; `composeAiPage` returns `{ content, simulated }`.
`AssistantRail` and `ComposePanel` render a small "Simulated" badge alongside the
message.

**Contracts:** the AI response envelope is **not** schematized in
`packages/contracts` today — `composeAiPlan` parses `detail`/`history` via
`parseOutcome` and reads `message` loosely. Adding `simulated` therefore requires
no `docs/contracts/CHANGELOG.md` entry. That absence is itself a gap under
invariant 5 ("contracts change by protocol, not by drift"), but closing it means
schematizing the whole AI envelope, which is out of scope here. It is filed as a
known issue instead (§8).

## 5. Local development, and failing closed

**The `AI_LIVE` override lives in our accessor, not in `decide`.** The type
definitions say `adapter` and `decide` may both be supplied and that "explicitly
provided values always override adapters" — so a `decide` that returns `undefined`
to "fall through" to the adapter does **not** work: `undefined` triggers
`defaultValue`, and the adapter is never consulted. The override therefore sits
one level up:

```ts
export async function aiLive(): Promise<boolean> {
  // Local/CI escape hatch ONLY. On Vercel this variable is unset and the flag
  // is the sole source of truth.
  if (process.env.AI_LIVE !== undefined) return process.env.AI_LIVE === "true";
  return aiLiveFlag();
}
```

`vercelAdapter()` authenticates through Vercel OIDC / the `FLAGS` environment
variable and has nothing to talk to on `localhost`. With `AI_LIVE=false` in
`.env.local`, local dev and Playwright never contact Vercel at all.
`vercel env pull` remains available for anyone who wants to exercise the real
adapter locally.

**`defaultValue: false` means an unreachable Flags service degrades to simulated,
not to spending.** Given that the entire purpose is spend protection, failing
closed is the correct direction — and the degradation is *not silent*, because
the `simulated: true` marker and the message notice surface it on exactly the
screen the user is looking at.

## 6. Per-user targeting, later

`Identify` receives `{ headers, cookies }` and nothing else — it cannot be handed
a `userId` by the call site. Per-user targeting is therefore an `identify` that
reads the session itself:

```ts
identify: dedupe(async () => {
  const session = await auth();
  return session?.user?.id ? { user: { id: session.user.id } } : undefined;
}),
```

`dedupe` (from `flags/next`) keeps this to one session read per request even if
several flags identify the same way. Entities then flow to the Vercel dashboard,
where targeting rules are written without a deploy.

This is **not built now** — the flag is global, as agreed. What is built now is
the evaluation point: the flag is consulted after `guard()`, inside a request
scope where cookies are available, so adding `identify` later is a change to one
declaration and to nothing else.

## 7. Testing

Per the `AGENTS.md` rule that an invariant asserted in a comment must be enforced
by a test:

- **Unit** — `simulatedModel()` emits the expected tool calls for each surface,
  and **terminates**: a second `doGenerate` returns `"stop"`, so a 32-step budget
  yields one batch, not 32.
- **Unit** — `selectAiModel()` returns the gateway model when the flag is true and
  the simulated model when false, with the flag stubbed.
- **Unit** — `aiLive()` honors `AI_LIVE` and ignores the adapter when it is set.
- **Integration** — `handleAiRequest` with the simulated model injected returns
  200, `simulated: true`, a genuinely mutated trip, and an **empty
  `locationReport`** (proving no geocoder call).
- **Integration** — the existing AI suite passes unchanged, which is the evidence
  that an injected model still bypasses flag evaluation entirely.
- **Regression** — an explicit test that the flag-off path constructs no gateway
  client: `aiModel()` throws without `AI_GATEWAY_API_KEY`, so a flag-off request
  with that variable unset must still return 200.
- **E2E** — with `AI_LIVE=false`, ask the assistant from the rail and assert both
  the "Simulated" badge and the board actually changing.

## 8. Documentation

- **ADR-019** — the flag mechanism and the simulated-model seam. Irreversible
  enough to warrant one: it introduces a platform dependency.
- `.env.example` — `FLAGS_SECRET`, `AI_LIVE`, with the local-only warning on the
  latter phrased as bluntly as `AUTH_DEV_LOGIN`'s.
- `docs/guidelines/environments-and-deploys.md` — a "Feature flags" section:
  where values live per environment, how to flip one, how preview overrides work.
- `apps/web/eslint.config.mjs` — the widened lint-wall exemption (§1), plus the
  matching assertion in `scripts/check-lint-wall.mjs`.
- `docs/known-issues.md` — the un-schematized AI response envelope (§4).
- `docs/STATUS.md` — the off-roadmap insert and the M10 Phase 3 resume point.

## Invariant check

| Invariant | Status |
|---|---|
| 1. Event log is sole source of truth | Held. Simulated plans go through `flushPlanningBatch` like any other; no projection is written directly. |
| 2. Projections disposable | Untouched. |
| 3. Conflicts are data | Untouched. |
| 4. Domain core is pure | Held. Everything here is in `apps/web/src/server`; `packages/domain` is not modified and gains no I/O. |
| 5. Contracts change by protocol | No contract changes. The AI envelope's absence from contracts is pre-existing and filed as a known issue (§4). |
| 6. Single-player now, multi-persona always | Held, and reinforced: §6's targeting keys off `actor_id`-style user identity rather than a "the user" singleton. |

## Risks

1. **Vercel Flags availability is unverified.** `@flags-sdk/vercel@1.4.6` is
   published, but whether the Flags product is enabled on this account's plan has
   not been confirmed. If it is gated, the fallback is a plain `decide()` reading
   Edge Config or an environment variable, and **only `server/flags.ts` changes** —
   §2 through §7 are provider-agnostic by construction. Confirming this is the
   first task of the plan, before any code is written.
2. **Simulated plans write real events.** A visitor exercising the assistant
   permanently mutates that trip's history. This is the intended behavior — it is
   what makes the demo real — but it is not a read-only preview mode, and the
   distinction should be understood before the link is shared widely.
3. **Fail-closed can mask an outage.** If Vercel Flags is unreachable, live AI
   silently becomes simulated AI. Mitigated by the on-screen marker, not
   eliminated.

## Out of scope

- Schematizing the AI response envelope in `packages/contracts`.
- Any second flag, or a general flag-driven UI gating pattern.
- Flagging LocationIQ geocoding (decided against; see §3 for why the simulated
  path avoids it anyway).
- Rate limiting or per-user token budgets — a different control from a kill
  switch, and a reasonable follow-up.
- Building `identify` / per-user targeting (§6 prepares for it; it is not built).
