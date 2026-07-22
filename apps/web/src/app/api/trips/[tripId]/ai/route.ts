// AI route (Task 5.5): wires the Wave 5 pieces (gateway, envelope, planning
// tools, page tools) into one endpoint. POST /api/trips/:id/ai
// { prompt, surface, pageContext? } → for `page` surface, a validated
// PageContent; for `board`/`combined`, the atomic-batch result (detail +
// history) from whatever tool calls the model made.
//
// Model injection: `handleAiRequest` takes an optional `model` (an AI SDK
// `LanguageModel`) that defaults to `aiModel()`. The exported `POST` never
// passes one, so the only path that can ever reach a real provider is a real
// request hitting the real deployed/dev route with AI_GATEWAY_API_KEY set —
// tests call `handleAiRequest` directly with a fake model (ai/test's
// MockLanguageModelV1) and never touch `POST`'s default, so they never
// construct `aiModel()` and never hit the network.
import { z } from "zod";
import { generateText, type LanguageModel } from "ai";
import { PageContext, type PageContent, type TripHistory } from "@tc/contracts";
import { guard } from "@/server/pages-guard";
import { getTripHistory } from "@/server/history";
import { aiModel } from "@/server/ai/gateway";
import { buildEnvelope, type AiSurface } from "@/server/ai/context";
import { buildPlanningTools, flushPlanningBatch } from "@/server/ai/planningTools";
import { buildPageTools, validateComposedPage } from "@/server/ai/pageTools";

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

// NOTE (pre-existing dependency skew, not introduced by this task): the
// installed @ai-sdk/gateway (^1.0.0 → resolved 1.0.41) builds against
// @ai-sdk/provider's LanguageModelV2, while this repo pins "ai": "^4.0.0",
// whose `generateText`/`LanguageModel` type is still V1. `aiModel()`'s
// return value is therefore not structurally a `LanguageModelV1` by TS's
// judgment even though gateway models are drop-in compatible with `ai`'s
// runtime in practice for the v4/v2-bridge era. Cast at this one seam
// rather than threading `any` through the rest of the route; worth
// revisiting (pin @ai-sdk/gateway to a V1-era version, or upgrade `ai` to
// v5) as a follow-up outside Task 5.5's scope.
export async function handleAiRequest(
  request: Request,
  tripId: string,
  model: LanguageModel = aiModel() as unknown as LanguageModel,
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
  const system = `You are the travel-collab planning/authoring assistant. Use ONLY this context — no outside knowledge of the trip: ${JSON.stringify(envelope)}`;

  if (surface === "page") {
    const { tools } = buildPageTools();
    let result;
    try {
      result = await generateText({ model, system, prompt, tools, maxSteps: MAX_STEPS.page });
    } catch (err) {
      return Response.json({ error: `model call failed: ${errorMessage(err)}` }, { status: 422 });
    }
    // `result.toolResults` only reflects the LAST step (AI SDK v4 quirk —
    // GenerateTextResult.toolResults is `lastStep.toolResults`, not every
    // step's). Since compose_page may be called on an earlier step (a
    // follow-up "stop" step commonly follows), search every step's results.
    const stepToolResults = result.steps.flatMap((step) => step.toolResults) as Array<{
      toolName: string;
      result: { title: string; content: PageContent };
    }>;
    const composed = stepToolResults.find((r) => r.toolName === "compose_page");
    if (!composed) {
      return Response.json({ error: "model did not compose a page" }, { status: 422 });
    }
    const validated = validateComposedPage(composed.result.content);
    if ("error" in validated) {
      return Response.json({ error: validated.error }, { status: 422 });
    }
    return Response.json({ content: validated });
  }

  // board | combined
  const planning = buildPlanningTools(tripId);
  const tools = surface === "combined" ? { ...planning.tools, ...buildPageTools().tools } : planning.tools;
  try {
    await generateText({ model, system, prompt, tools, maxSteps: MAX_STEPS[surface] });
  } catch (err) {
    return Response.json({ error: `model call failed: ${errorMessage(err)}` }, { status: 422 });
  }

  const calls = planning.getCollected();
  if (calls.length === 0) {
    // Nothing to apply — return the trip unchanged rather than submitting an
    // empty batch (executeTripCommandBatch requires at least one command).
    const history: TripHistory | null = await getTripHistory(tripId);
    return Response.json({ detail, history });
  }

  const result = await flushPlanningBatch(tripId, calls, userId);
  if (!result.ok) {
    return Response.json(
      { error: result.error.message, code: result.error.code },
      { status: STATUS[result.error.code] ?? 400 },
    );
  }
  return Response.json({ detail: result.detail, history: result.history });
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function POST(request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  return handleAiRequest(request, tripId);
}
