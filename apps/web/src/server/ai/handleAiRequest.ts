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
    "When adding a NEW activity, generate a fresh random UUID for its activityId.",
    "A MoveActivity `position` is a zero-based index into the target day's activity list.",
    `Context: ${JSON.stringify(envelope)}`,
  ].join("\n");

  if (surface === "page") {
    const { tools } = buildPageTools();
    let result;
    try {
      result = await generateText({ model, system, prompt, tools, stopWhen: isStepCount(MAX_STEPS.page) });
    } catch (err) {
      return Response.json({ error: `model call failed: ${errorMessage(err)}` }, { status: 422 });
    }
    // AI SDK v7: `result.toolResults` now spans ALL steps (previously, in v4,
    // GenerateTextResult.toolResults reflected only the last step, which
    // required manually flattening `result.steps[].toolResults` to find a
    // compose_page call made on an earlier step). No workaround needed here
    // anymore.
    const composed = result.toolResults.find((r) => r.toolName === "compose_page") as
      | { toolName: string; output: { title: string; content: PageContent } }
      | undefined;
    if (!composed) {
      return Response.json({ error: "model did not compose a page" }, { status: 422 });
    }
    const validated = validateComposedPage(composed.output.content);
    if ("error" in validated) {
      return Response.json({ error: validated.error }, { status: 422 });
    }
    return Response.json({ content: validated });
  }

  // board | combined
  const planning = buildPlanningTools(tripId, detail);
  const tools = surface === "combined" ? { ...planning.tools, ...buildPageTools().tools } : planning.tools;
  try {
    await generateText({ model, system, prompt, tools, stopWhen: isStepCount(MAX_STEPS[surface]) });
  } catch (err) {
    return Response.json({ error: `model call failed: ${errorMessage(err)}` }, { status: 422 });
  }

  const calls = planning.getCollected();
  if (calls.length === 0) {
    // Nothing to apply — return the trip unchanged rather than submitting an
    // empty batch (executeTripCommandBatch requires at least one command). The
    // `message` is what tells the user *why* nothing moved, instead of a
    // silent board reload that looks like the request was dropped.
    const history: TripHistory | null = await getTripHistory(tripId);
    return Response.json({
      detail,
      history,
      message:
        "I couldn't turn that into any changes, so nothing was applied. Try naming the activities and days as they appear on the board.",
    });
  }

  const result = await flushPlanningBatch(tripId, calls, userId);
  if (!result.ok) {
    return Response.json(
      { error: result.error.message, code: result.error.code },
      { status: STATUS[result.error.code] ?? 400 },
    );
  }
  // A plain-language summary of what actually got applied — derived from the
  // committed batch, so it can never claim an edit the batch didn't make (see
  // planSummary). Names resolve against the pre-change `detail`.
  return Response.json({
    detail: result.detail,
    history: result.history,
    message: summarizeBatch(calls, detail),
  });
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
