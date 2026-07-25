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

// Max tool-call round-trips per surface. Page composition is one tool call;
// planning may chain a few (e.g. AddDay then AddActivity onto it).
const MAX_STEPS: Record<AiSurface, number> = { page: 3, board: 6, combined: 8 };

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
    "The planning tools take human references: name an existing activity by its exact `title` (its `id` also works) via `activityRef`, and a day as \"day N\" (1-based, e.g. \"day 2\"; a `dayId` or null/\"backlog\" also work) via `dayRef`. The server resolves them — never invent, guess, or reformat a UUID.",
    "If a title is ambiguous (matches two activities), the tool says so; reference that one by its exact `id` instead.",
    "When adding a NEW entity, generate a fresh random UUID for its id: `activityId` on AddActivity, `dayId` on AddDay.",
    "A MoveActivity `position` is a zero-based index into the target day's activity list.",
    "To dismiss a conflict, reference it by its `ref` number in the context's `conflicts` list via `conflictRef` — only conflicts listed there can be dismissed, and never copy a raw conflict id.",
    "All money amounts are integer minor units (cents), never decimals: 5.00 is `amountMinor` 500, so multiply a decimal amount by 100 (500 EUR → 50000).",
    "Codes are case-sensitive — use these exact forms: weekday anchors are lowercase three-letter codes (`mon`, `tue`, `wed`, `thu`, `fri`, `sat`, `sun`); `currency` is an uppercase ISO-4217 code (e.g. `EUR`); a location/anchor country is an uppercase ISO-3166 alpha-2 code (e.g. `IT`).",
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
  const planning = buildPlanningTools(tripId, detail);
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

  const calls = planning.getCollected();
  if (calls.length === 0) {
    // Nothing to apply — return the trip unchanged rather than submitting an
    // empty batch (executeTripCommandBatch requires at least one command). The
    // `message` is what tells the user *why* nothing moved, instead of a
    // silent board reload that looks like the request was dropped. `meta`
    // disambiguates the two zero-command causes: the model called no tools
    // (meta.toolCalls empty) vs. it called them but every ref failed to
    // resolve (meta.toolCalls populated, resolvedCommands still empty).
    const history: TripHistory | null = await getTripHistory(tripId);
    return Response.json({
      detail,
      history,
      message:
        "I couldn't turn that into any changes, so nothing was applied. Try naming the activities and days as they appear on the board.",
      meta,
      resolvedCommands: [],
    });
  }

  const batch = await flushPlanningBatch(tripId, calls, userId);
  if (!batch.ok) {
    return Response.json(
      { error: batch.error.message, code: batch.error.code, meta, resolvedCommands: calls },
      { status: STATUS[batch.error.code] ?? 400 },
    );
  }
  // A plain-language summary of what actually got applied — derived from the
  // committed batch, so it can never claim an edit the batch didn't make (see
  // planSummary). Names resolve against the pre-change `detail`.
  // `resolvedCommands` is the post-resolution batch (real UUIDs) so a caller
  // can see how each human `*Ref` mapped to an id vs. what the model asked for
  // in `meta.toolCalls`.
  return Response.json({
    detail: batch.detail,
    history: batch.history,
    message: summarizeBatch(calls, detail),
    meta,
    resolvedCommands: calls,
  });
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
