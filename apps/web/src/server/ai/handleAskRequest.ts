// The /ask endpoint's logic (M16, ADR-022): a streaming, multi-turn,
// tool-using agent that answers questions about a trip — and, for an editor,
// PROPOSES changes to it (M9).
//
// The turn itself still changes nothing. Its write tools collect (writeTools.ts)
// and the loop ends; what goes out on the stream's last chunk is a resolved
// proposal, and the only thing that commits is `handleApplyProposalRequest`
// below, reached by a human clicking Approve. Rejecting is that handler not
// being called — there is no queued draft anywhere for a reject path to have to
// discard correctly.
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
import { convertToModelMessages, isStepCount, safeValidateUIMessages, ToolLoopAgent, type LanguageModel } from "ai";
import type { TripRole } from "@tc/contracts";
import { isDemoTripId } from "@/lib/demoTrip";
import { guard } from "@/server/pages-guard";
import { hasAtLeast } from "@/server/accessPolicy";
import { aiQuotas, consumeQuota, quotaRefusal } from "@/server/quota";
import { deniedResponse, selectAiModel } from "@/server/ai/modelSelection";
import { SIMULATED_MODEL_ID } from "@/server/ai/simulatedModel";
import { askScopeLine, type AskScope } from "@/server/ai/context";
import { MAX_ASK_BODY_BYTES, MAX_ASK_MESSAGES, MAX_PROMPT_CHARS } from "@/server/ai/limits";
import { buildReadTools, MAX_READ_DAYS, readToolsContext, READ_TOOL_NAMES } from "@/server/ai/readTools";
import {
  buildProposal,
  buildWriteTools,
  commitProposal,
  droppedWriteCalls,
  parseApprovedCommands,
  WRITE_TOOL_NAMES,
} from "@/server/ai/writeTools";
import type { Geocoder } from "@/server/geocoding";
import { createAskRecorder, type AskAnalyticsSink } from "@/server/ai/askAnalytics";

// Round-trips one question may take. Eight is generous for a read-only turn —
// three tools, and the shape of a real answer is "read what you need, then
// speak", which is 2-3 steps — while staying far below the command endpoint's
// 32, because a question that has taken eight round-trips is not converging.
const MAX_ASK_STEPS = 8;

// The tool names this endpoint can offer, by what the turn's actor may do.
// M9's write tools are the DERIVED planning tools (writeTools.ts) — the same
// family the command endpoint runs — so this list grows with
// `BatchableCommand` and never with a hand-written manifest.
export function offeredToolNamesFor(canWrite: boolean): readonly string[] {
  return canWrite ? [...READ_TOOL_NAMES, ...WRITE_TOOL_NAMES] : READ_TOOL_NAMES;
}

// **The guard follows the tool set, not the endpoint.**
//
// `/ai` asks for `editor` because every surface it serves writes. A read-only
// turn is different: a viewer may ask about a trip they can already see, and
// refusing them would be a permission rule that exists only because the
// assistant happens to share a route prefix with one that writes.
//
// Written as a computation rather than a constant so the rule is executable.
// M9 is the case it was written for: the moment a tool that is not in
// `READ_TOOL_NAMES` is offered — `AddActivity`, say — this answers `editor`
// without anyone having to remember. It is not consulted only at the door: the
// handler asks it what the set it is ABOUT to hand the agent requires, and
// refuses to build an agent the actor's role does not cover. Both branches are
// asserted in the /ask route's integration suite (a unit test cannot import
// this module: `guard()` pulls in next-auth).
export function minimumRoleFor(toolNames: readonly string[]): TripRole {
  const readOnly = (READ_TOOL_NAMES as readonly string[]).slice();
  return toolNames.every((name) => readOnly.includes(name)) ? "viewer" : "editor";
}

// The minimum to get through the door. A viewer's turn is read-only and always
// was; whether THIS turn also gets write tools is decided below, from the role
// the guard resolved, not from the route.
export const ASK_MINIMUM_ROLE = minimumRoleFor(offeredToolNamesFor(false));

// The minimum an approval needs — the same computation, asked about the set a
// proposal can only have come from.
export const APPLY_MINIMUM_ROLE = minimumRoleFor(offeredToolNamesFor(true));

// Names the `simulated` verdict on the wire, so the client stops deriving it
// from the model's own prose.
//
// Task 5's client matched the sentence "AI is switched off on this deployment"
// to decide whether to show the Simulated badge, because the stream carried no
// flag. That is a display concern derived from generated text — the same
// anti-pattern `docs/milestones/M18-stop-kind.md` rejects for parsing `kind`
// out of note text — and it breaks silently the first time the sentence is
// reworded. A header is honest, is set on the same three lines that already
// know the answer, and survives a turn that fails before it says anything.
export const SIMULATED_HEADER = "x-tc-ai-simulated";

// The refusal code for the demo trip. Kebab-case and named after the reason,
// matching `ai-not-entitled` (modelSelection.ts) and the `STATUS` codes on the
// command endpoint — a client can branch on it without matching prose.
export const DEMO_TRIP_UNSUPPORTED_CODE = "demo-trip-unsupported";

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
  // The demo trip is refused, and it is refused FIRST — before the guard,
  // before model selection, before the quota.
  //
  // `requireTripAccess` answers `isDemoTripId` as a **viewer with no session**
  // (ADR-031), which is what makes /demo public. Combined with this endpoint's
  // (correct) `viewer` minimum, that would have made /ask an internet-facing,
  // unauthenticated LLM proxy on the operator's key the moment `ai-live` is
  // switched on — up to 30 attacker-authored turns an hour, all of them
  // sharing the single `demo-visitor` quota bucket, so one visitor exhausting
  // it denies every other visitor. It would also have put a Postgres write
  // (the quota counter) on a path `demoTrip.ts` deliberately keeps free of the
  // database, which is an architecture regression rather than a missing
  // feature.
  //
  // Refusing here rather than inside `guard()` keeps the rule where its
  // reasoning is, and keeps `requireTripAccess` answering the demo the same
  // way for every other route. `docs/known-issues.md` (KI-79) records what
  // would have to be decided to open it up.
  if (isDemoTripId(tripId)) {
    return Response.json(
      { error: "The assistant isn't available on the demo trip.", code: DEMO_TRIP_UNSUPPORTED_CODE },
      { status: 403 },
    );
  }

  const g = await guard(tripId, ASK_MINIMUM_ROLE);
  if ("error" in g) return g.error;
  const { userId, detail } = g;

  // **Write tools are offered only when the turn's guard resolved editor.**
  //
  // Asked through the AccessPolicy seam (`hasAtLeast`), which is the one place
  // that knows a viewer ranks below an editor (AGENTS.md invariant 6c) — not a
  // second rank table here. `guard()` has already resolved the effective
  // members, so this is a read of what it decided, not a second access check.
  const canWrite = hasAtLeast(userId, detail.members, "editor");

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
  const question = textOf(lastUser);
  if (question.length > MAX_PROMPT_CHARS) {
    return badRequest(`your message must be ${MAX_PROMPT_CHARS} characters or fewer`);
  }
  // A thread of length 1 is just this question — nothing has been answered
  // yet. Any longer thread already holds at least one prior turn, so this
  // question is a follow-up: it reads back over answers already given, and
  // (Design note in askAnalytics.ts) its tool-call shape is genuinely
  // different from an opening question's.
  const turn: "opening" | "follow-up" = messages.length > 1 ? "follow-up" : "opening";

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

  // The tool set for THIS turn. A viewer gets the read half and nothing else,
  // and the rule is enforced rather than commented: `minimumRoleFor` is asked
  // what the set about to be handed to the agent requires, and the actor must
  // already satisfy it. Unreachable while `canWrite` decides the set — which
  // is why it is here, because the next person to add a branch to that line is
  // who this catches.
  const writeTools = canWrite ? buildWriteTools() : null;
  const tools = { ...buildReadTools().tools, ...(writeTools?.tools ?? {}) };
  const offeredNames = Object.keys(tools);
  if (!hasAtLeast(userId, detail.members, minimumRoleFor(offeredNames))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const recorder = createAskRecorder({
    tripId,
    userId,
    scope,
    question,
    turn,
    simulated: selected.simulated,
    model: modelIdOf(selected.model),
    // What was actually handed to the agent, not what a constant says was —
    // "offered" has to be a measurement for `uncalledTools` to mean anything.
    // `readTools.test.ts` ties this set to `READ_TOOL_NAMES`, which is what
    // the guard above is computed from.
    offeredTools: offeredNames,
    sink,
  });

  const agent = new ToolLoopAgent({
    model: selected.model,
    instructions: instructionsFor(scope, detail.days.length, canWrite),
    tools,
    toolsContext: readToolsContext({ tripId, userId, detail, scope }),
    stopWhen: isStepCount(MAX_ASK_STEPS),
    onStepEnd: (step) => recorder.observeStep(step),
    // `writeTools` is the SAME collection `messageMetadata`'s `buildProposal`
    // reads below — `onEnd` just runs first, before the stream's `finish`
    // part exists to build the actual proposal from. A second, cheap
    // `resolveBatch` dry run (`droppedWriteCalls`) is how the drop reaches
    // THIS record instead of only the client-facing proposal — see the
    // comment on `droppedWriteCalls` in writeTools.ts for why it isn't
    // shared with the call below instead.
    onEnd: (end) =>
      recorder.finish(
        end,
        writeTools ? droppedWriteCalls(writeTools.getCollected(), detail, { tripId, actorId: userId }) : [],
      ),
  });

  // Validated HERE rather than left to throw inside
  // `createAgentUIStreamResponse`, which validates it again: this is the one
  // failure the caller's BODY is responsible for, and it has to be
  // distinguishable from a model failure. Catching both at one `catch` meant
  // reporting a broken provider as "malformed thread", 400, caller's fault.
  const validated = await safeValidateUIMessages({
    messages,
    // The same cast the SDK makes at its own `validateUIMessages` call site
    // (`createAgentUIStream`, ai/dist/index.js): "tools are compatible; the
    // casting is required because the context param is not available in ui
    // messages". Our tool set is context-typed, UI messages are not.
    tools: tools as unknown as Parameters<typeof safeValidateUIMessages>[0]["tools"],
  });
  if (!validated.success) return badRequest(`malformed thread: ${validated.error.message}`);

  try {
    // `createAgentUIStreamResponse` would do these three steps for us, and it
    // is what this used to call — but it forwards only `onStepEnd` to
    // `agent.stream`, so there is no way to reach `onAbort` or to hand the
    // agent the request's own `AbortSignal` through it. Both matter: without
    // the signal a client that disconnects mid-answer leaves the loop running
    // to completion on the operator's key, and without the callback that turn
    // is never measured. The three lines are the SDK's own, in the same order.
    // A turn the user walked away from still spent steps and still made tool
    // calls, and it is one of the two turns most worth measuring. Wired to the
    // request's own signal rather than to an SDK callback: `ToolLoopAgent`
    // exposes `onStepEnd`/`onEnd` but no `onAbort` on its call parameters, and
    // the signal IS the event — no plumbing in between to be wrong about.
    const noteAbandoned = () => recorder.abandon("abort");
    if (request.signal.aborted) noteAbandoned();
    else request.signal.addEventListener("abort", noteAbandoned, { once: true });

    const modelMessages = await convertToModelMessages(validated.data, { tools });
    const result = await agent.stream({
      prompt: modelMessages,
      // Without this the loop runs to completion on the operator's key after
      // the client has already hung up.
      abortSignal: request.signal,
    });
    return result.toUIMessageStreamResponse({
      originalMessages: validated.data,
      // Ruling B. Set once, before a byte of the stream, so it is readable on
      // the failure path too — a half-written simulated answer still gets
      // badged, which sniffing the closing sentence could not manage.
      headers: { [SIMULATED_HEADER]: String(selected.simulated) },
      // **The proposal rides out on the run's final chunk.**
      //
      // `messageMetadata` is called for every stream part; `finish` is the
      // last part of the whole loop, which is the first moment
      // `getCollected()` is complete — every write tool call the model made,
      // in emission order, which is the order `resolveBatch` depends on.
      // Emitting it earlier would ship a proposal missing the calls from the
      // step still running.
      //
      // Nothing is committed here. `buildProposal` resolves and describes;
      // the only caller of `commitProposal` is the apply endpoint below, and
      // it runs after a human clicked Approve.
      messageMetadata: ({ part }) => {
        if (part.type !== "finish" || writeTools === null) return undefined;
        const proposal = buildProposal(writeTools.getCollected(), detail, { tripId, actorId: userId });
        return proposal === null ? undefined : { proposal };
      },
      onError: (error) => {
        // The turn failed. Record it before the message goes out — `onEnd`
        // will not fire, and the tool-call trace of a failed turn is the
        // whole reason to keep one.
        recorder.abandon("error");
        // The client sees the real reason rather than "An error occurred.",
        // which is the SDK's default and is indistinguishable from a network
        // failure in the rail.
        return errorMessage(error);
      },
    });
  } catch (err) {
    // Nothing in the body is left to be wrong — the messages validated above
    // and the caps passed. What remains is the agent failing to start, which
    // is the same 503 shape `handleAiRequest` returns for a model that could
    // not be reached.
    recorder.abandon("error");
    return Response.json(
      { error: `model call failed: ${errorMessage(err)}`, simulated: selected.simulated },
      { status: 503 },
    );
  }
}

// Status codes for a batch the executor refused. The same table the command
// endpoint uses, for the same codes — an approval that loses a race with
// another editor is a 409 there and must be a 409 here.
const APPLY_STATUS: Record<string, number> = {
  "invalid-command": 400,
  forbidden: 403,
  "trip-not-found": 404,
  "concurrency-conflict": 409,
};

const ApplyProposalRequest = z.object({
  /**
   * Correlates the approval with the proposal it came from. Written to the log
   * below and trusted for nothing else — the commands are re-parsed and the
   * tripId is checked against the URL regardless of what this says.
   */
  proposalId: z.string().min(1).optional(),
  commands: z.array(z.unknown()).min(1, "an approval must carry at least one change"),
});

/**
 * What one approval records. `console.info`, matching `ai.ask`'s shape
 * (askAnalytics.ts) and `trip-access.ts`'s — no table, no migration (plan
 * Constraint 6), and Vercel captures it as a queryable line.
 *
 * It exists because `proposalId` is otherwise a field the request carries and
 * nothing reads, and because "how many proposals were approved vs drafted" is
 * the first number anyone evaluating M9 will ask for. `outcome` is the whole
 * point: a refused batch is as interesting as an applied one.
 */
export interface ProposalApplyRecord {
  event: "ai.proposal.apply";
  tripId: string;
  userId: string;
  proposalId: string | null;
  commandCount: number;
  outcome: "applied" | "refused";
  /** The domain rejection code when refused, else null. */
  code: string | null;
  latencyMs: number;
}

export type ProposalApplySink = (record: ProposalApplyRecord) => void;

const defaultApplySink: ProposalApplySink = (record) => console.info(record.event, record);

/**
 * `POST /api/trips/:id/ask/apply` — the approval half of propose → review →
 * approve.
 *
 * **This is the only place an assistant turn can change a trip**, and it is
 * reached only by a human clicking Approve. The turn that proposed committed
 * nothing: its write tools collect (writeTools.ts), the loop ends, and the
 * proposal goes out on the stream's final chunk as data. Rejection is
 * therefore not an operation at all — it is this endpoint not being called —
 * which is why "reject leaves the trip byte-identical" is a property of the
 * shape rather than of a code path that has to get it right.
 *
 * No model is called and no AI quota is consumed. Approving is a write, not a
 * generation; charging the caller's hourly model allowance for pressing a
 * button would refuse them the next question for something no provider saw.
 *
 * `geocoder` is the same test seam `handleAiRequest` takes, for the same
 * reason: `getGeocoder()` throws without LOCATIONIQ_API_KEY, so it is resolved
 * lazily and only when a command actually carries a location.
 */
export async function handleApplyProposalRequest(
  request: Request,
  tripId: string,
  geocoder?: Geocoder,
  sink: ProposalApplySink = defaultApplySink,
): Promise<Response> {
  const startedAt = Date.now();
  // Refused first, exactly as the ask half is, and for a stronger reason: the
  // demo trip has no event log to write to (ADR-031).
  if (isDemoTripId(tripId)) {
    return Response.json(
      { error: "The assistant isn't available on the demo trip.", code: DEMO_TRIP_UNSUPPORTED_CODE },
      { status: 403 },
    );
  }

  // `editor`, computed rather than typed: `minimumRoleFor` answering "editor"
  // for the write tool set is the SAME rule that decided whether this actor's
  // turn was offered those tools at all. A viewer whose client somehow held a
  // proposal is refused here by the same computation that refused them the
  // tools.
  const g = await guard(tripId, APPLY_MINIMUM_ROLE);
  if ("error" in g) return g.error;
  const { userId, detail } = g;

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
  const parsed = ApplyProposalRequest.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "malformed request");

  const commands = parseApprovedCommands(parsed.data.commands, tripId);
  if (!commands.ok) return badRequest(commands.error);

  const committed = await commitProposal(tripId, commands.commands, userId, detail, geocoder);
  const record = {
    event: "ai.proposal.apply" as const,
    tripId,
    userId,
    proposalId: parsed.data.proposalId ?? null,
    commandCount: commands.commands.length,
    latencyMs: Date.now() - startedAt,
  };
  if (!committed.ok) {
    sink({ ...record, outcome: "refused", code: committed.error.code });
    return Response.json(
      { error: committed.error.message, code: committed.error.code },
      { status: APPLY_STATUS[committed.error.code] ?? 400 },
    );
  }
  sink({ ...record, outcome: "applied", code: null });
  // The same `{ detail, history }` every command endpoint answers with, so the
  // board reconciles an approved plan through `applyOutcome` rather than
  // through a second, assistant-shaped path.
  return Response.json(committed.value);
}

/**
 * The system instruction.
 *
 * Scope narrowing is **instruction plus default, not a lie**. The day-scoped
 * turn says what the subject is and the tools default to it (readTools.ts), but
 * `read_day({ days: 4 })` still works — because M16's gate is about the ANSWER
 * not wandering onto other days, and a model that genuinely needs day 4 to
 * answer a question about day 3 ("is this a long walk from yesterday's
 * hotel?") should be able to look.
 *
 * The batching line below is the other half of the 2026-08-29 live-run fix:
 * `read_trip`'s `cities` field is what makes "which days are near Nara"
 * answerable at all, and telling the model to batch is what stops it re-paying
 * for that answer with a `read_day` per candidate day — a schema that permits
 * a list but a prompt that only ever shows a single day does not change
 * behaviour on its own.
 */
export function instructionsFor(scope: AskScope, dayCount: number, canWrite = false): string {
  return [
    "You are the travel-collab trip assistant. You answer questions about one trip.",
    canWrite
      ? // The propose→review→approve contract, said to the model in the terms
        // it can act on. It is not the mechanism — the write tools collect and
        // commit nothing, so a model that ignored every word of this still
        // could not change the trip (writeTools.ts) — it is what stops the
        // answer CLAIMING an edit that has not happened yet.
        "You can read this trip, and you can PROPOSE changes to it. A change tool call is not applied: every call you make this turn is collected into one proposal the user reviews and approves or rejects. So never say you have added, moved or removed anything — say what you would change, and that it is waiting for them."
      : "You can READ this trip and nothing else. You cannot add, move, remove or change anything — if you are asked to, say plainly that you can only answer questions about the trip for now.",
    "Use ONLY what the tools return. You cannot see the trip any other way, and you never guess a time, a price, a place or a date.",
    "Call read_trip first for the trip's shape, INCLUDING which city or cities each day touches — use that to find candidate days before reading any of them in full.",
    `Call read_day for what happens on a day (it is the only place stop times live) — pass a LIST of day numbers (up to ${MAX_READ_DAYS}) when a question needs more than one, in ONE call, rather than calling it once per day.`,
    "Call find_free_time for open time — never work gaps out yourself from read_day's times.",
    ...(canWrite
      ? [
          "Read before you propose. A change that names a day or a stop you have not read is a guess.",
          "Emit every change the request needs in ONE message. They are applied together as a single atomic change, so no call depends on seeing an earlier call's result.",
          'You never write, copy or invent an id. Name an existing stop by its exact title via activityRef, and a day via dayRef: "day N" (1-based), or "backlog"/null for the backlog.',
          // M9's honest unknowns. The 2026-08-02 dogfood run wrote
          // `amountMinor: 0` on all nine activities it planned, which the board
          // renders as FREE — a confident wrong number where the truth was
          // "nobody knows yet". `cost` is optional in the contract precisely so
          // this can be left out.
          "NEVER invent a price. `cost` is optional: if you do not know what something costs, leave `cost` out entirely. A cost of 0 means free — writing 0 for something whose price you do not know is a wrong number, not a blank.",
        ]
      : []),
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
