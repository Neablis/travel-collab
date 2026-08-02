// AI request handler (Task 5.5): wires the Wave 5 pieces (gateway, envelope,
// planning tools, page tools) into one endpoint's logic. Lives outside
// app/api/**/route.ts because Next.js's route-type-checking only allows a
// route file to export HTTP method handlers + a small set of config fields
// — any other export (like this function) fails `next build`'s route-shape
// validation. The route file just re-exports POST, which calls this.
//
// Model injection: `handleAiRequest` takes an optional `model` (an AI SDK
// `LanguageModel`) that defaults to `aiModel()`. The route's `POST` never
// passes one, so the only path that can ever reach a real provider is a real
// request hitting the real deployed/dev route with AI_GATEWAY_API_KEY set —
// tests call `handleAiRequest` directly with a fake model (ai/test's
// MockLanguageModelV4) and never touch `POST`'s default, so they never
// construct `aiModel()` and never hit the network.
//
// `geocoder` is different: unlike `model`, it's used by only ONE of the three
// surfaces (board/combined's enrichment step, well after the `surface ===
// "page"` branch has already returned), and only when the resolved batch
// actually has an AddActivity/UpdateActivity with a `location` to look up. A
// default parameter is evaluated at call time whenever the argument is
// omitted — which is every real request, since route.ts's `POST` never passes
// one — so `geocoder: Geocoder = getGeocoder()` here would construct the real
// LocationIQ geocoder (ADR-007) unconditionally, including for `page`-surface
// requests that never touch location data at all. `getGeocoder()` throws if
// LOCATIONIQ_API_KEY is unset, so that would break page-surface (Notebook
// AI-authoring) on a missing key too. Instead `geocoder` stays optional and is
// resolved lazily, right where `enrichCommandLocations` needs it — see there.
// Tests inject a fake `Geocoder` the same way they inject a fake model, so no
// test needs LOCATIONIQ_API_KEY.
import { z } from "zod";
import { generateText, isStepCount, type LanguageModel } from "ai";
import { PageContext, type PageContent, type TripHistory } from "@tc/contracts";
import { guard } from "@/server/pages-guard";
import { getTripHistory } from "@/server/history";
import { aiModel } from "@/server/ai/gateway";
import { buildEnvelope, type AiSurface } from "@/server/ai/context";
import { buildPlanningTools, flushPlanningBatch } from "@/server/ai/planningTools";
import { buildPageTools, validateComposedPage } from "@/server/ai/pageTools";
import { summarizeBatch } from "@/server/ai/planSummary";
import { resolveBatch } from "@/server/ai/batchResolver";
import { enrichCommandLocations } from "@/server/ai/geocodeEnrichment";
import { getGeocoder, type Geocoder } from "@/server/geocoding";

const STATUS: Record<string, number> = {
  "invalid-command": 400,
  forbidden: 403,
  "trip-not-found": 404,
  "concurrency-conflict": 409,
};

const AiRequest = z.object({
  prompt: z.string().min(1),
  surface: z.enum(["page", "board", "combined"]),
  pageContext: PageContext.optional(),
});

// Max tool-call round-trips (steps) per surface. A step is ONE model
// round-trip, however many tool calls it packs into that message: a model that
// emits its whole plan at once costs 1 step, one that emits a single call per
// message costs a step per call. So the planning budget has to cover the WORST
// case, not the typical one — "a 7-day itinerary with lunches and something
// nearby" is ~7 AddDay + ~21 AddActivity ≈ 28 calls.
//
// The old board budget of 6 was sized for small edits ("AddDay then AddActivity
// onto it") and silently truncated every itinerary-sized request: the
// 2026-07-26 run spent all 6 steps on AddDay and returned 6 empty days with
// zero activities, and the 2026-07-25 run ("15 AddDays across 6 steps") died on
// the same ceiling. The system prompt now asks for everything in one message,
// which keeps the usual cost at 1–3 steps; this ceiling is only the backstop
// for when the model insists on going one at a time. Page composition is still
// a single compose_page call.
const MAX_STEPS: Record<AiSurface, number> = { page: 3, board: 32, combined: 32 };

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

function buildAiMeta(result: AiResultLike, model: LanguageModel, durationMs: number): AiCallMeta {
  return {
    model: { requested: requestedModelId(model), served: result.finalStep?.response?.modelId ?? null },
    finishReason: result.finishReason,
    truncated: result.finishReason === "tool-calls",
    steps: result.steps.length,
    toolCalls: result.toolCalls.map((c) => ({ name: c.toolName, input: c.input })),
    usage: {
      inputTokens: result.usage.inputTokens ?? null,
      outputTokens: result.usage.outputTokens ?? null,
      totalTokens: result.usage.totalTokens ?? null,
    },
    warnings: [...(result.warnings ?? [])],
    maxRetries: AI_MAX_RETRIES,
    durationMs,
  };
}

export async function handleAiRequest(
  request: Request,
  tripId: string,
  model: LanguageModel = aiModel(),
  geocoder?: Geocoder,
): Promise<Response> {
  const g = await guard(tripId);
  if ("error" in g) return g.error;
  const { userId, detail } = g;

  const parsed = AiRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "malformed request" }, { status: 400 });
  }
  const { prompt, surface, pageContext } = parsed.data;

  const envelope = buildEnvelope({ detail, surface, pageContext });
  // The ID rules matter: planning tools (Move/Update/Remove) require the
  // activity's/day's UUID, which the model can only get by copying it verbatim
  // from the envelope. Without this instruction the model tends to reference
  // activities by title alone, fail to fill the required id field, and emit
  // zero tool calls — the trip then comes back unchanged.
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

  if (surface === "page") {
    const { tools } = buildPageTools();
    let result;
    const startedAt = Date.now();
    try {
      result = await generateText({
        model,
        system,
        prompt,
        tools,
        stopWhen: isStepCount(MAX_STEPS.page),
        maxRetries: AI_MAX_RETRIES,
      });
    } catch (err) {
      return Response.json(
        { error: `model call failed: ${errorMessage(err)}`, meta: failedMeta(model, Date.now() - startedAt) },
        { status: 422 },
      );
    }
    const meta = buildAiMeta(result, model, Date.now() - startedAt);
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
      return Response.json({ error: "model did not compose a page", meta }, { status: 422 });
    }
    const validated = validateComposedPage(composed.output.content);
    if ("error" in validated) {
      return Response.json({ error: validated.error, meta }, { status: 422 });
    }
    return Response.json({ content: validated, meta });
  }

  // board | combined
  const planning = buildPlanningTools();
  const tools = surface === "combined" ? { ...planning.tools, ...buildPageTools().tools } : planning.tools;
  let gen;
  const startedAt = Date.now();
  try {
    gen = await generateText({
      model,
      system,
      prompt,
      tools,
      stopWhen: isStepCount(MAX_STEPS[surface]),
      maxRetries: AI_MAX_RETRIES,
    });
  } catch (err) {
    return Response.json(
      { error: `model call failed: ${errorMessage(err)}`, meta: failedMeta(model, Date.now() - startedAt) },
      { status: 422 },
    );
  }
  const meta = buildAiMeta(gen, model, Date.now() - startedAt);

  // Turn the model's raw tool intents (human refs, no UUIDs) into concrete
  // commands in one batch-aware pass: mint new ids, resolve refs against the
  // trip AS THE BATCH BUILDS IT, and drop any command whose ref can't be
  // matched. `resolutionErrors` are the drops — surfaced for the caller.
  const { commands: resolvedCommands, errors: resolutionErrors } = resolveBatch(planning.getCollected(), detail, {
    tripId,
    actorId: userId,
  });
  // `no-op` drops are informational (the domain simply had nothing to do), not
  // something the user needs told "couldn't be matched" — only count real drops.
  const skipped = resolutionErrors.filter((e) => e.code !== "no-op");

  if (resolvedCommands.length === 0) {
    const history: TripHistory | null = await getTripHistory(tripId);
    return Response.json({
      detail,
      history,
      message: withNotices(
        skipped.length > 0
          ? "I couldn't match that to anything on your trip, so nothing was applied. Try naming the days and activities as they appear on the board."
          : "I couldn't turn that into any changes, so nothing was applied.",
        meta.truncated ? [TRUNCATED_NOTICE] : [],
      ),
      meta,
      resolvedCommands: [],
      resolutionErrors,
    });
  }

  // Best-effort server-side geocode enrichment (ADR-007): the model is never
  // trusted with real coordinates, so every AddActivity/UpdateActivity with a
  // `location` gets it replaced with a real geocoder lookup here, right before
  // the batch is submitted. See geocodeEnrichment.ts for the dedupe/parallel/
  // fallback behavior.
  const commands = await enrichCommandLocations(resolvedCommands, () => geocoder ?? getGeocoder());

  const batch = await flushPlanningBatch(tripId, commands, userId);
  if (!batch.ok) {
    return Response.json(
      { error: batch.error.message, code: batch.error.code, meta, resolvedCommands: commands, resolutionErrors },
      { status: STATUS[batch.error.code] ?? 400 },
    );
  }
  const summary = summarizeBatch(commands, detail);
  const notices: string[] = [];
  if (skipped.length > 0) {
    notices.push(
      `${skipped.length} other change${skipped.length === 1 ? "" : "s"} couldn't be matched and ${skipped.length === 1 ? "was" : "were"} skipped.`,
    );
  }
  // Everything collected before the cut-off IS applied — truncated, not
  // discarded — so this rides alongside the summary rather than replacing it.
  if (meta.truncated) notices.push(TRUNCATED_NOTICE);
  const message = withNotices(summary, notices);
  return Response.json({
    detail: batch.detail,
    history: batch.history,
    message,
    meta,
    resolvedCommands: commands,
    resolutionErrors,
  });
}

// What the user is told when `meta.truncated` — the step budget ended the run
// while the model still had calls to make. Without this the response reads as a
// confident "Done — added a day, added a day, …" over a half-built trip.
const TRUNCATED_NOTICE =
  "I didn't finish the whole plan before running out of room — ask me to continue and I'll pick up from here.";

// Parenthesised caveats appended to a message, so the summary of what DID apply
// always leads.
function withNotices(message: string, notices: string[]): string {
  return notices.length > 0 ? `${message} (${notices.join(" ")})` : message;
}

// Minimal meta for the model-call-failure path, where there is no result to
// read — just which model was attempted and how long before it gave up.
function failedMeta(model: LanguageModel, durationMs: number): Pick<AiCallMeta, "model" | "maxRetries" | "durationMs"> {
  return {
    model: { requested: requestedModelId(model), served: null },
    maxRetries: AI_MAX_RETRIES,
    durationMs,
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
