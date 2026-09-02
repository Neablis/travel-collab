// AI request handler (Task 5.5): wires the Wave 5 pieces (gateway, envelope,
// page tools) into one endpoint's logic. Lives outside
// app/api/**/route.ts because Next.js's route-type-checking only allows a
// route file to export HTTP method handlers + a small set of config fields
// — any other export (like this function) fails `next build`'s route-shape
// validation. The route file just re-exports POST, which calls this.
//
// Model selection: `handleAiRequest` takes an OPTIONAL `model`. When a caller
// injects one — every test in route.int.test.ts except one, which omits it on
// purpose to exercise the no-model path (see its own comment) — it is used
// as-is and no flag is consulted, so test behavior is otherwise unchanged from
// before the kill switch existed. When none is injected, which is every real
// request, `selectAiModel()` decides: the real gateway model when the
// `ai-live` flag is on, the simulated model when it is off. The default
// parameter form (`model: LanguageModel = aiModel()`) could not survive that
// change, because a default is evaluated at call time and would construct the
// gateway client — and throw on a missing AI_GATEWAY_API_KEY — before the flag
// could be read.
//
// Selection happens AFTER guard() on purpose: guard() is where the session is
// established, so the per-user targeting described in the design spec's §6 can
// later be added to the flag declaration without moving this call site.
//
// ADR-033 Decision 4 retired the `board` and `combined` surfaces from here —
// neither had a production caller, and /ask supersedes them with
// propose → review → approve. What is left is the page-authoring surface the
// Notebook uses. The planning pipeline they drove (`planningTools`,
// `batchResolver`, `flushPlanningBatch`, `geocodeEnrichment`, `planSummary`)
// is untouched and still shared: it was always the pipeline, not the door.
import { z } from "zod";
import { generateText, isStepCount, type LanguageModel } from "ai";
import { PageContext, type PageContent } from "@tc/contracts";
import { guard } from "@/server/pages-guard";
import { aiQuotas, aiStepQuotas, consumeQuota, quotaRefusal, settleAiSteps } from "@/server/quota";
import { deniedResponse, selectAiModel } from "@/server/ai/modelSelection";
import { SIMULATED_MODEL_ID } from "@/server/ai/simulatedModel";
import { buildEnvelope, type AiCommandSurface } from "@/server/ai/context";
import { MAX_PROMPT_CHARS } from "@/server/ai/limits";
import { buildPageTools, validateComposedPage } from "@/server/ai/pageTools";
import { recordCommandMetrics, type CommandMetricsRecord } from "@/server/ai/aiMetrics";

const AiRequest = z.object({
  prompt: z.string().min(1).max(MAX_PROMPT_CHARS, `prompt must be ${MAX_PROMPT_CHARS} characters or fewer`),
  surface: z.enum(["page"]),
  pageContext: PageContext.optional(),
});

// Max tool-call round-trips (steps) for a page composition. A step is ONE model
// round-trip, however many tool calls it packs into that message.
//
// Composing a page is a single `compose_page` call, so 3 is a backstop for a
// model that wanders, not a budget to spend. The retired planning surfaces
// carried a 32-step budget and an `AI_MAX_STEPS` operator override sized
// against a worst-case itinerary (~28 tool calls); neither has anything left to
// bound here. The step-budget-as-blast-radius argument itself did not retire —
// it lives on as `MAX_ASK_STEPS` in handleAskRequest.ts, which is the loop that
// can still run long.
const MAX_STEPS = 3;

// Per-call retry ceiling passed to generateText (the AI SDK's own retry of
// transient provider failures). Surfaced in the response `meta` so a caller
// can tell an actual success from a retried one, and read the same ceiling the
// failure message ("Failed after N attempts") counts against.
const AI_MAX_RETRIES = 2;

// Auditing envelope attached to every AI response so a caller can confirm a
// request actually reached a model and see what it did — which model answered,
// whether tools fired (and with what args), token spend, and timing. Debug
// metadata, not part of the domain contract; safe to ignore on the client.
interface AiCallMeta {
  model: { requested: string; served: string | null };
  // True when no provider was contacted — the plan came from simulatedModel
  // because the ai-live flag is off. See modelSelection.ts.
  simulated: boolean;
  finishReason: string;
  // True when the run ended because `stopWhen` fired while the model still
  // wanted to call tools — the plan is UNFINISHED, not complete. A model that
  // is done returns "stop", and any tool calls it emits are executed and
  // followed by another step; so "tool-calls" surviving as the FINAL finish
  // reason can only mean the step budget cut the model off mid-plan.
  truncated: boolean;
  // Round-trips the model took (1 = answered in a single step).
  steps: number;
  // What the model asked for, BEFORE server-side ref resolution — e.g.
  // { name: "MoveActivity", input: { activityRef: "Colosseum tour", dayRef: "day 2" } }.
  toolCalls: { name: string; input: unknown }[];
  usage: { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null };
  warnings: unknown[];
  maxRetries: number;
  durationMs: number;
}

// Structural view of the generateText result — just the fields meta reads.
// Avoids threading generateText's ToolSet generics through the helper.
interface AiResultLike {
  finishReason: string;
  steps: readonly unknown[];
  toolCalls: readonly { toolName: string; input: unknown }[];
  usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  warnings?: readonly unknown[];
  finalStep?: { response?: { modelId?: string } };
}

// A LanguageModel is either a bare model-id string or a provider model object
// carrying `.modelId` — normalize to the requested id either way.
function requestedModelId(model: LanguageModel): string {
  return typeof model === "string" ? model : model.modelId;
}

function buildAiMeta(
  result: AiResultLike,
  model: LanguageModel,
  durationMs: number,
  simulated: boolean,
): AiCallMeta {
  return {
    model: { requested: requestedModelId(model), served: result.finalStep?.response?.modelId ?? null },
    simulated,
    finishReason: result.finishReason,
    truncated: result.finishReason === "tool-calls",
    steps: result.steps.length,
    toolCalls: result.toolCalls.map((c) => ({ name: c.toolName, input: c.input })),
    usage: usageOf(result),
    warnings: [...(result.warnings ?? [])],
    maxRetries: AI_MAX_RETRIES,
    durationMs,
  };
}

/**
 * `AiCallMeta` in the shape the metrics module counts.
 *
 * A translation and nothing more — every field here already exists on the meta
 * the response carries, so the counters and the `meta` a caller sees can never
 * disagree about what a turn cost. `toolCalls[].input` is deliberately dropped:
 * it is model-supplied and unbounded, and a metric attribute is a series.
 */
function commandMetricsOf(surface: AiCommandSurface, meta: AiCallMeta): CommandMetricsRecord {
  return {
    surface,
    model: meta.model.requested,
    simulated: meta.simulated,
    finishReason: meta.finishReason,
    truncated: meta.truncated,
    steps: meta.steps,
    toolNames: meta.toolCalls.map((call) => call.name),
    usage: meta.usage,
    durationMs: meta.durationMs,
  };
}

/**
 * Token counts off a `generateText` result, in the nullable shape both the
 * response `meta` and the telemetry use.
 *
 * One function rather than the same three `?? null` lines written out at each
 * of three sites. A usage mapping that drifts between the span and the
 * response is the same species of bug as M18's hand-enumerated field list —
 * quieter, because nothing type-checks the two against each other.
 */
function usageOf(result: Pick<AiResultLike, "usage">): AiCallMeta["usage"] {
  return {
    inputTokens: result.usage.inputTokens ?? null,
    outputTokens: result.usage.outputTokens ?? null,
    totalTokens: result.usage.totalTokens ?? null,
  };
}

export async function handleAiRequest(
  request: Request,
  tripId: string,
  model?: LanguageModel,
): Promise<Response> {
  // `editor`, not membership: this handler WRITES — it authors Notebook
  // content. A viewer driving the assistant would be a viewer editing the trip
  // through a second door (M11 link 3).
  const g = await guard(tripId, "editor");
  if ("error" in g) return g.error;
  const { userId, detail } = g;

  const parsed = AiRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    // The size cap is the one rejection a legitimate caller can hit by
    // accident (a pasted document), so it says which rule it broke instead of
    // the generic envelope — and it is a clean 400 here rather than something
    // the provider bills us for and then errors on.
    const issue = parsed.error.issues.find((i) => i.path[0] === "prompt");
    return Response.json({ error: issue?.message ?? "malformed request" }, { status: 400 });
  }
  const { prompt, surface, pageContext } = parsed.data;

  // Injected model => that exact model is used and the flag is never consulted;
  // "simulated" is derived from whether the injected model IS simulatedModel's
  // sentinel (route.int.test.ts's "simulated mode" tests inject simulatedModel()
  // directly, to exercise its plan-application behavior without flipping
  // AI_LIVE — so `model` alone can't decide this, only its identity can). No
  // model => ask the flag, which already returns this same shape.
  let selected: { model: LanguageModel; simulated: boolean };
  if (model) {
    selected = { model, simulated: requestedModelId(model) === SIMULATED_MODEL_ID };
  } else {
    // Reachable once the ai-live flag is on but AI_GATEWAY_API_KEY is unset:
    // selectAiModel()'s live branch calls aiModel(), which throws in that case
    // (see gateway.ts). Without this try/catch that throw becomes a bare
    // unhandled-rejection 500 instead of this file's standard error envelope
    // — pre-existing under the old default-parameter form too, but now
    // reachable by flipping a flag on a public deployment rather than only by
    // a local misconfiguration.
    let outcome;
    try {
      outcome = await selectAiModel({ surface, userId });
    } catch (err) {
      return Response.json(
        { error: `model selection failed: ${errorMessage(err)}`, simulated: false },
        { status: 503 },
      );
    }
    // `denied` is unreachable today — no entitlement source exists yet
    // (ADR-019 amendment §3) — but the branch is real so this endpoint
    // already renders the contract Task 3's /ask endpoint reuses.
    if (outcome.outcome === "denied") return deniedResponse(outcome.reason);
    selected = { model: outcome.model, simulated: outcome.outcome === "simulated" };
  }
  const activeModel = selected.model;
  const { simulated } = selected;

  // Charged AFTER validation and AFTER model selection, and before the first
  // `generateText`. A malformed request costs the operator nothing, so it must
  // not cost the user their allowance — and neither must a request that never
  // reached a model at all: charging before selection meant a missing
  // AI_GATEWAY_API_KEY (the 503 above) burned the caller's whole hourly and
  // daily allowance on retries against an outage that produced zero provider
  // calls, so the incident outlived its own fix by a day. Nothing between
  // selection and here reads the counters, so the move is order-safe.
  // Applies in simulated mode too: the request still writes to the log and the
  // limiter's job is to bound requests, not to guess which ones reached a
  // provider.
  // Two layers, both charged here (KI-67). `aiQuotas` bounds how many times an
  // actor may ask; `aiStepQuotas` bounds what asking COSTS, in model
  // round-trips. Only one round-trip can be pre-authorised, because the real
  // step count does not exist until generateText returns — `settleAiSteps`
  // below charges the rest once it does. An actor already over either ceiling
  // is refused here, before a provider is touched.
  const quota = await consumeQuota([...aiQuotas(), ...aiStepQuotas()], userId);
  if (!quota.allowed) return quotaRefusal(quota);

  const envelope = buildEnvelope({ detail, surface, pageContext });
  // Left verbatim by ADR-033's first step, which retired the surfaces but not
  // this text: most of the rules below (activityRef/dayRef, MoveActivity,
  // conflictRef, money units) describe planning tools the page surface is not
  // handed, so they are ~1.5k characters of dead instruction on every request.
  // Trimming them changes what a live model is told and so changes page
  // behaviour — a separate, separately-verified change, not a cleanup to fold
  // in here.
  //
  // The ID rules matter where they still apply: a tool that takes a UUID can
  // only get it by copying it verbatim from the envelope. Without that
  // instruction the model references things by title alone, fails to fill the
  // required id field, and emits zero tool calls — nothing then changes.
  const system = [
    "You are the travel-collab planning/authoring assistant.",
    "Use ONLY the context below — no outside knowledge of the trip.",
    "Emit EVERY tool call the request needs in ONE message, all at once. Do not add one day, wait for the result, then add the next — every call is collected and applied together as a single atomic change, so no call depends on seeing an earlier call's result. Working one at a time wastes the request's budget and leaves the plan half-finished.",
    "Fully satisfy the request in that one message: if the user asks for a 7-day itinerary with meals and activities, emit all 7 days AND every activity, not just the days.",
    "You never write, copy, or invent a UUID. The tools take human references and the server assigns all ids:",
    "- Name an existing activity by its exact `title` via `activityRef`.",
    '- Choose a day via `dayRef`: "day N" (1-based, e.g. "day 2"), or "backlog"/null for the backlog.',
    '- Day numbers count the days this request will produce, so an activity can target a day added in the SAME message — if your calls add 3 days to an empty trip, the third is "day 3".',
    "- Do NOT provide activityId or dayId; the server generates ids for anything new.",
    "If a title matches two activities, the change is skipped and reported; reference the intended one by its exact `id` from the context.",
    "A MoveActivity `position` is a zero-based index into the target day's activity list.",
    "To dismiss a conflict, reference it by its `ref` number in the context's `conflicts` list via `conflictRef` — only conflicts listed there can be dismissed, and never copy a raw conflict id.",
    "All money amounts are integer minor units (cents), never decimals: 5.00 is `amountMinor` 500, so multiply a decimal amount by 100 (500 EUR → 50000).",
    "Codes are case-sensitive — use these exact forms: weekday anchors are lowercase three-letter codes (`mon`, `tue`, `wed`, `thu`, `fri`, `sat`, `sun`); `currency` is an uppercase ISO-4217 code (e.g. `EUR`); a location/anchor country is an uppercase ISO-3166 alpha-2 code (e.g. `IT`).",
    "Prefer SetTripDates over SetTripStartDate. SetTripDates sets the range AND matches the number of days to it; SetTripStartDate only moves day 1.",
    'Only set the trip name if the trip still has a placeholder name (for example "New trip") or the user explicitly asked you to rename it. Never rename a trip the user has already named as a side effect of another request.',
    `Context: ${JSON.stringify(envelope)}`,
  ].join("\n");

  const { tools } = buildPageTools();
  let result;
  const startedAt = Date.now();
  try {
    result = await generateText({
      model: activeModel,
      system,
      prompt,
      tools,
      stopWhen: isStepCount(MAX_STEPS),
      maxRetries: AI_MAX_RETRIES,
      // Names this run in Sentry's AI Agents view. Sentry's `VercelAI`
      // integration emits the run's spans off the AI SDK's own telemetry
      // channel; `functionId` is the only thing it cannot infer, and
      // without it every run in this app is a span called `invoke_agent`.
      telemetry: { functionId: "compose_page" },
    });
  } catch (err) {
    return Response.json(
      {
        error: `model call failed: ${errorMessage(err)}`,
        simulated,
        meta: failedMeta(activeModel, Date.now() - startedAt, simulated),
      },
      { status: 422 },
    );
  }
  const meta = buildAiMeta(result, activeModel, Date.now() - startedAt, simulated);
  // Settle the round-trips this answer actually cost, beyond the one already
  // pre-authorised (KI-67). Placed immediately after `meta` is built so every
  // return path below it — composed, not-composed, invalid — is charged the
  // same: the provider was paid for those steps whatever the handler decides
  // to do with the result. Never throws; see settleAiSteps.
  await settleAiSteps(aiStepQuotas(), userId, meta.steps);
  // Same placement, same reason, different ledger: the metrics count what the
  // turn spent whatever the handler returns below. Never throws either.
  recordCommandMetrics(commandMetricsOf(surface, meta));
  // AI SDK v7: `result.toolResults` now spans ALL steps (previously, in v4,
  // GenerateTextResult.toolResults reflected only the last step, which
  // required manually flattening `result.steps[].toolResults` to find a
  // compose_page call made on an earlier step). No workaround needed here
  // anymore.
  const composed = result.toolResults.find((r) => r.toolName === "compose_page") as
    | { toolName: string; output: { title: string; content: PageContent } }
    | undefined;
  if (!composed) {
    // meta.toolCalls shows what the model DID do instead of composing.
    return Response.json({ error: "model did not compose a page", simulated, meta }, { status: 422 });
  }
  const validated = validateComposedPage(composed.output.content);
  if ("error" in validated) {
    return Response.json({ error: validated.error, simulated, meta }, { status: 422 });
  }
  return Response.json({ content: validated, simulated, meta });
}

// Minimal meta for the model-call-failure path, where there is no result to
// read — just which model was attempted and how long before it gave up.
function failedMeta(
  model: LanguageModel,
  durationMs: number,
  simulated: boolean,
): Pick<AiCallMeta, "model" | "simulated" | "maxRetries" | "durationMs"> {
  return {
    model: { requested: requestedModelId(model), served: null },
    simulated,
    maxRetries: AI_MAX_RETRIES,
    durationMs,
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
