// The /ask endpoint's logic (M16, ADR-022): a streaming, multi-turn,
// tool-using agent that ANSWERS questions about a trip and changes nothing.
//
// It lives beside `handleAiRequest`, not inside it. That endpoint's design
// guarantee is that its user-facing message is derived from the commands it
// committed — "so the response can never claim an edit the batch didn't make"
// (planSummary.ts) — which is exactly why it cannot answer a question: a turn
// resolving to zero commands returns a fixed sentence and the model's own text
// is discarded. Answering is a second concern, and it gets its own endpoint
// rather than a second output channel on that pipeline (ADR-022 §4, and the
// alternative Mitchell rejected).
//
// It lives outside app/api/**/route.ts for the same reason `handleAiRequest`
// does: Next.js's route-shape validation only permits HTTP-method exports from
// a route file, so a function tests import directly to inject a model cannot
// live there.
//
// What is deliberately shared with the command endpoint: `guard()`,
// `consumeQuota`, `selectAiModel()` and the `ai-live` kill switch. One
// chokepoint covers both entry points, so nothing can spend without the flag
// (ADR-019's 2026-08-25 amendment).
import { z } from "zod";
import { createAgentUIStreamResponse, isStepCount, ToolLoopAgent, type LanguageModel } from "ai";
import type { TripRole } from "@tc/contracts";
import { guard } from "@/server/pages-guard";
import { aiQuotas, consumeQuota, quotaRefusal } from "@/server/quota";
import { deniedResponse, selectAiModel } from "@/server/ai/modelSelection";
import { SIMULATED_MODEL_ID } from "@/server/ai/simulatedModel";
import { askScopeLine, type AskScope } from "@/server/ai/context";
import { MAX_ASK_BODY_BYTES, MAX_ASK_MESSAGES, MAX_PROMPT_CHARS } from "@/server/ai/limits";
import { buildReadTools, readToolsContext, READ_TOOL_NAMES } from "@/server/ai/readTools";
import { createAskRecorder, type AskAnalyticsSink } from "@/server/ai/askAnalytics";

// Round-trips one question may take. Eight is generous for a read-only turn —
// three tools, and the shape of a real answer is "read what you need, then
// speak", which is 2-3 steps — while staying far below the command endpoint's
// 32, because a question that has taken eight round-trips is not converging.
const MAX_ASK_STEPS = 8;

// The tools this endpoint offers. Read-only today (ADR-022's opening set); M9's
// write tools join them here.
const OFFERED_TOOL_NAMES: readonly string[] = READ_TOOL_NAMES;

// **The guard follows the tool set, not the endpoint.**
//
// `/ai` asks for `editor` because every surface it serves writes. A read-only
// turn is different: a viewer may ask about a trip they can already see, and
// refusing them would be a permission rule that exists only because the
// assistant happens to share a route prefix with one that writes.
//
// Written as a computation rather than a constant so the rule is executable:
// the moment a tool that is not in `READ_TOOL_NAMES` joins `OFFERED_TOOL_NAMES`
// — M9's `AddActivity`, say — this becomes `editor` without anyone having to
// remember. Both branches are asserted in the /ask route's integration suite
// (a unit test cannot import this module: `guard()` pulls in next-auth).
export function minimumRoleFor(toolNames: readonly string[]): TripRole {
  const readOnly = (READ_TOOL_NAMES as readonly string[]).slice();
  return toolNames.every((name) => readOnly.includes(name)) ? "viewer" : "editor";
}

export const ASK_MINIMUM_ROLE = minimumRoleFor(OFFERED_TOOL_NAMES);

// Only the fields this handler enforces caps on. The authoritative validation
// is `validateUIMessages` inside `createAgentUIStreamResponse`, which knows the
// full UIMessage part union including tool parts; duplicating it here would be
// a hand-written copy of someone else's schema. What this does is turn the
// three ceilings into a 400 that NAMES the rule broken, before a model is
// selected and before the caller is charged.
const AskUiMessage = z.object({
  id: z.string().min(1),
  role: z.enum(["system", "user", "assistant"]),
  parts: z.array(z.object({ type: z.string() }).passthrough()),
});

const AskScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("trip") }),
  z.object({ kind: z.literal("day"), dayIndex: z.number().int().min(0) }),
]);

const AskRequest = z.object({
  messages: z
    .array(AskUiMessage)
    .min(1, "messages must not be empty")
    .max(MAX_ASK_MESSAGES, `a thread may hold at most ${MAX_ASK_MESSAGES} messages`),
  scope: AskScopeSchema,
});

type AskUiMessage = z.infer<typeof AskUiMessage>;

/** Every text part of a message, concatenated — what the cap is measured against. */
function textOf(message: AskUiMessage): string {
  return message.parts
    .filter((part) => part.type === "text" && typeof (part as { text?: unknown }).text === "string")
    .map((part) => (part as unknown as { text: string }).text)
    .join("");
}

function badRequest(error: string): Response {
  return Response.json({ error }, { status: 400 });
}

/**
 * `sink` and `model` are test seams, exactly as `handleAiRequest`'s `model` and
 * `geocoder` are: an injected model is used as-is and the flag is never
 * consulted, and an injected sink lets a test read the analytics record instead
 * of the console.
 */
export async function handleAskRequest(
  request: Request,
  tripId: string,
  model?: LanguageModel,
  sink?: AskAnalyticsSink,
): Promise<Response> {
  const g = await guard(tripId, ASK_MINIMUM_ROLE);
  if ("error" in g) return g.error;
  const { userId, detail } = g;

  // Measured on the RAW body, before parsing: a 10 MB thread must be refused
  // without ever being deserialized, and `request.json()` would deserialize it
  // first. `Blob` counts bytes, not UTF-16 code units, which is what a limit
  // named in KB has to mean.
  const raw = await request.text().catch(() => null);
  if (raw === null) return badRequest("could not read the request body");
  if (new Blob([raw]).size > MAX_ASK_BODY_BYTES) {
    return badRequest(`the request body must be ${MAX_ASK_BODY_BYTES} bytes or fewer`);
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return badRequest("malformed request");
  }

  const parsed = AskRequest.safeParse(body);
  if (!parsed.success) {
    // Same reasoning as handleAiRequest's: the caps are the rejections a
    // legitimate caller can hit by accident, so the response says which rule
    // broke rather than returning a generic envelope.
    return badRequest(parsed.error.issues[0]?.message ?? "malformed request");
  }
  const { messages, scope } = parsed.data;

  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUser) return badRequest("the thread must end with a question from the user");
  if (textOf(lastUser).length > MAX_PROMPT_CHARS) {
    return badRequest(`your message must be ${MAX_PROMPT_CHARS} characters or fewer`);
  }

  // A scope pointing past the end of the trip is a client bug, not a question:
  // answering it "about the whole trip" would silently widen a narrowing the
  // caller asked for.
  if (scope.kind === "day" && !detail.days[scope.dayIndex]) {
    return badRequest(`this trip has ${detail.days.length} days, so day ${scope.dayIndex + 1} is out of range`);
  }

  // Injected model => that exact model, flag never consulted; `simulated` is
  // derived from its identity, not from whether one was injected (the same
  // rule handleAiRequest documents, so a test that injects `simulatedModel()`
  // is still reported as simulated).
  let selected: { model: LanguageModel; simulated: boolean };
  if (model) {
    selected = { model, simulated: modelIdOf(model) === SIMULATED_MODEL_ID };
  } else {
    let outcome;
    try {
      outcome = await selectAiModel({ surface: "ask", userId });
    } catch (err) {
      return Response.json(
        { error: `model selection failed: ${errorMessage(err)}`, simulated: false },
        { status: 503 },
      );
    }
    if (outcome.outcome === "denied") return deniedResponse(outcome.reason);
    selected = { model: outcome.model, simulated: outcome.outcome === "simulated" };
  }

  // Charged after validation and after model selection, for the reasons
  // handleAiRequest sets out at length: a malformed request must not cost the
  // caller their allowance, and neither must a request that never reached a
  // model.
  const quota = await consumeQuota(aiQuotas(), userId);
  if (!quota.allowed) return quotaRefusal(quota);

  const { tools } = buildReadTools();
  const recorder = createAskRecorder({
    tripId,
    userId,
    scope,
    simulated: selected.simulated,
    model: modelIdOf(selected.model),
    // What was actually handed to the agent, not what a constant says was —
    // "offered" has to be a measurement for `uncalledTools` to mean anything.
    // `readTools.test.ts` ties this set to `READ_TOOL_NAMES`, which is what
    // the guard above is computed from.
    offeredTools: Object.keys(tools),
    sink,
  });

  const agent = new ToolLoopAgent({
    model: selected.model,
    instructions: instructionsFor(scope, detail.days.length),
    tools,
    toolsContext: readToolsContext({ tripId, userId, detail, scope }),
    stopWhen: isStepCount(MAX_ASK_STEPS),
    onStepEnd: (step) => recorder.observeStep(step),
    onEnd: (end) => recorder.finish(end),
  });

  try {
    return await createAgentUIStreamResponse({
      agent,
      uiMessages: messages,
      // The client sees the real reason rather than "An error occurred.",
      // which is the SDK's default and is indistinguishable from a network
      // failure in the rail.
      onError: (error) => errorMessage(error),
    });
  } catch (err) {
    // Reachable when `validateUIMessages` rejects a part shape this handler's
    // own schema does not model (a malformed tool part, say). A 400 rather
    // than a 500: the body is what is wrong.
    return badRequest(`malformed thread: ${errorMessage(err)}`);
  }
}

/**
 * The system instruction.
 *
 * Scope narrowing is **instruction plus default, not a lie**. The day-scoped
 * turn says what the subject is and the tools default to it (readTools.ts), but
 * `read_day(4)` still works — because M16's gate is about the ANSWER not
 * wandering onto other days, and a model that genuinely needs day 4 to answer a
 * question about day 3 ("is this a long walk from yesterday's hotel?") should
 * be able to look.
 */
function instructionsFor(scope: AskScope, dayCount: number): string {
  return [
    "You are the travel-collab trip assistant. You answer questions about one trip.",
    "You can READ this trip and nothing else. You cannot add, move, remove or change anything — if you are asked to, say plainly that you can only answer questions about the trip for now.",
    "Use ONLY what the tools return. You cannot see the trip any other way, and you never guess a time, a price, a place or a date.",
    "Call read_trip for the trip's shape, read_day for what happens on a day (it is the only place stop times live), and find_free_time for open time — never work gaps out yourself from read_day's times.",
    `Day numbers are 1-based everywhere, and this trip has ${dayCount} day${dayCount === 1 ? "" : "s"}.`,
    "Every money amount is an integer in the currency's minor units (cents), never a decimal.",
    scope.kind === "day"
      ? `This question is about DAY ${scope.dayIndex + 1}. Answer about that day. Do not summarise the other days: you may read one if the user explicitly asks about it, but an answer that wanders off the day it was asked about is the wrong answer.`
      : "This question is about the trip as a whole.",
    "Answer in prose, briefly — a sentence or three. No headings, no bullet lists unless the user asks for a list.",
    askScopeLine(scope),
  ].join("\n");
}

// A LanguageModel is either a bare model-id string or a provider model object
// carrying `.modelId` — normalize to the requested id either way.
function modelIdOf(model: LanguageModel): string {
  return typeof model === "string" ? model : model.modelId;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
