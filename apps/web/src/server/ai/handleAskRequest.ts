// The /ask endpoint's logic (M16, ADR-022) — and, since ADR-033, THE AI route.
// A streaming, multi-turn, tool-using agent that answers questions about a
// trip, PROPOSES changes to it for an editor (M9), and authors one Notebook
// page (ADR-033 Decision 4).
//
// **One door, three tool sets, chosen from server-resolved facts.** The
// capability boundary a second endpoint used to buy is now a computation:
// `offeredToolNamesFor` picks the set and `minimumRoleFor` says what that set
// requires, both from the guard's answer and from a scope the server has
// VERIFIED — never from a client-supplied field (ADR-033 Decision 2). The three
// sets are disjoint where it matters: a page turn holds no planning write tool,
// and a planning turn holds no page insert tool.
//
// The turn itself changes nothing. Its write tools collect (writeTools.ts) and
// the loop ends; what goes out on the stream's last chunk is a resolved
// proposal, and the only thing that commits is `handleApplyProposalRequest`
// below, reached by a human clicking Approve. Rejecting is that handler not
// being called — there is no queued draft anywhere for a reject path to have to
// discard correctly. A composed page is the one exception and is not one: it
// rides the same final chunk, lands in the editor, and the Notebook's existing
// debounced autosave persists it. Nothing here writes a page either.
//
// Why this endpoint and not the command one it replaced: the command endpoint
// derived its user-facing message from the commands it COMMITTED — "so the
// response can never claim an edit the batch didn't make" (planSummary.ts) —
// which is exactly why it could not answer a question. A turn resolving to zero
// commands returned a fixed sentence and the model's own text was discarded
// (ADR-022 §4, amended by ADR-033 Decision 5).
//
// It lives outside app/api/**/route.ts because Next.js's route-shape validation
// only permits HTTP-method exports from a route file, so a function tests
// import directly to inject a model cannot live there.
//
// Every model call still goes through `selectAiModel()` and the `ai-live` kill
// switch — one chokepoint, now with one caller, so nothing can spend without
// the flag (ADR-019's 2026-08-25 amendment).
import { z } from "zod";
import { convertToModelMessages, isStepCount, safeValidateUIMessages, ToolLoopAgent, type LanguageModel } from "ai";
import type { Page, TripRole } from "@tc/contracts";
import { isDemoTripId } from "@/lib/demoTrip";
import { primitiveCatalog } from "@tc/pages";
import { guard } from "@/server/pages-guard";
import { hasAtLeast } from "@/server/accessPolicy";
import { aiQuotas, aiStepQuotas, consumeQuota, quotaRefusal, settleAiSteps } from "@/server/quota";
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
import {
  buildPageTools,
  PAGE_TOOL_NAMES,
  validatePageInserts,
  type PageInserts,
} from "@/server/ai/pageTools";
import { getPage } from "@/server/pages";
import type { Geocoder } from "@/server/geocoding";
import { createAskRecorder, logAskAnalytics, type AskAnalyticsSink } from "@/server/ai/askAnalytics";
import { classifyAskIntent } from "@/server/ai/askIntent";
import { recordAskMetrics, recordProposalApplyMetrics } from "@/server/ai/aiMetrics";

// Round-trips one turn may take, and the only step budget left in the app.
//
// Eight is generous for every shape it now covers. A read-only turn is "read
// what you need, then speak", 2-3 steps; a proposing turn adds one; page
// authoring is read, compose, say what you drafted, which is three — the
// command endpoint gave that same work a budget of 3 and a model that wandered
// was the only thing it was guarding against. A turn that has taken eight
// round-trips is not converging.
//
// It carries the step-budget-as-blast-radius reasoning from the endpoint ADR-033
// deleted, which sized a 32-step budget against a worst-case itinerary and gave
// operators an `AI_MAX_STEPS` override for it. Neither the number nor the
// override survived — nothing here can run 32 steps — but the argument did: the
// budget is what bounds what ONE request can spend on the operator's key, which
// is why `settleAiSteps` meters against it rather than against request count
// (KI-67).
const MAX_ASK_STEPS = 8;

/**
 * What one turn may be offered, by what the turn is FOR.
 *
 * Three answers, not two, and the third is a real narrowing rather than a move
 * (ADR-033 Decision 4). A page-authoring turn gets the page insert tools and NO
 * planning write tools; a planning turn gets the write tools and NO page insert
 * tools. One door is not the widest door: a turn writing into a Notebook
 * page has no business holding `RemoveActivity`, and the separate endpoint it
 * came from existed largely to say so.
 *
 * Both write halves are DERIVED — the planning tools from `@tc/contracts`
 * command schemas (writeTools.ts), the page tools from the `@tc/pages` macro
 * registry (pageTools.ts) — so each grows with its own registry and never with
 * a hand-written manifest (ADR-015 invariant 5).
 */
export type AskToolSet = "read-only" | "planning" | "page";

export function offeredToolNamesFor(kind: AskToolSet): readonly string[] {
  switch (kind) {
    case "read-only":
      return READ_TOOL_NAMES;
    case "planning":
      return [...READ_TOOL_NAMES, ...WRITE_TOOL_NAMES];
    case "page":
      return [...READ_TOOL_NAMES, ...PAGE_TOOL_NAMES];
  }
}

// **The guard follows the tool set, not the endpoint.**
//
// The endpoint this merged in asked for `editor` unconditionally, because every
// surface it served wrote. A read-only turn is different: a viewer may ask about
// a trip they can already see, and refusing them would be a permission rule that
// exists only because the assistant shares a route with one that writes. Now
// that there is one route, this computation is the whole difference.
//
// Written as a computation rather than a constant so the rule is executable. The
// moment a tool that is not in `READ_TOOL_NAMES` is offered — `AddActivity`, or
// `insert_widget` — this answers `editor` without anyone having to remember.
// Page authoring writes a page, so it lands on the same answer as a planning
// write, by the same rule and not by a second one. It is not consulted only at
// the door: the handler asks it what the set it is ABOUT to hand the agent
// requires, and refuses to build an agent the actor's role does not cover. Every
// branch is asserted in the /ask route's integration suite (a unit test cannot
// import this module: `guard()` pulls in next-auth).
export function minimumRoleFor(toolNames: readonly string[]): TripRole {
  const readOnly = (READ_TOOL_NAMES as readonly string[]).slice();
  return toolNames.every((name) => readOnly.includes(name)) ? "viewer" : "editor";
}

// The minimum to get through the door. A viewer's turn is read-only and always
// was; whether THIS turn also gets a write half is decided below, from the role
// the guard resolved and the scope the server verified, not from the route.
export const ASK_MINIMUM_ROLE = minimumRoleFor(offeredToolNamesFor("read-only"));

// The minimum an approval needs — the same computation, asked about the set a
// proposal can only have come from.
export const APPLY_MINIMUM_ROLE = minimumRoleFor(offeredToolNamesFor("planning"));

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
// matching `ai-not-entitled` (modelSelection.ts) — a client can branch on it
// without matching prose.
export const DEMO_TRIP_UNSUPPORTED_CODE = "demo-trip-unsupported";

// The refusal code for a page scope the server could not resolve to a page on
// THIS trip. Same reasoning as above, and it exists because "that page is not
// on this trip" is a refusal a legitimate client can reach by racing a delete.
export const PAGE_NOT_ON_TRIP_CODE = "page-not-on-trip";

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
  // Shape only. `pageId` is a CLAIM the handler VERIFIES below — this schema
  // says it could be a page id, not that it is one. `uuid()` rather than a bare
  // string because `pages.id` is a uuid column: a malformed id would otherwise
  // reach Postgres as a query it cannot run.
  z.object({ kind: z.literal("page"), pageId: z.string().uuid() }),
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

/**
 * The messages the classifier is shown besides the latest one, oldest first.
 *
 * Two, which in a normal thread is the previous question and the answer to
 * it — enough for "Yes go ahead" to resolve to what was offered. They are
 * truncated by `askIntentPrompt`, not here: how much of a message a model
 * needs is that module's decision, and this one's job is only to say which
 * messages.
 */
function recentContext(messages: readonly AskUiMessage[]): { role: "user" | "assistant"; text: string }[] {
  let lastUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === "user") {
      lastUserIndex = i;
      break;
    }
  }
  return messages
    .slice(0, Math.max(lastUserIndex, 0))
    .filter((message) => message.role !== "system")
    .slice(-2)
    .map((message) => ({ role: message.role as "user" | "assistant", text: textOf(message) }))
    .filter((message) => message.text.trim().length > 0);
}

function badRequest(error: string): Response {
  return Response.json({ error }, { status: 400 });
}

/**
 * `sink` and `model` are test seams: an injected model is used as-is and the
 * flag is never consulted, and an injected sink lets a test read the analytics
 * record instead of the console. `handleApplyProposalRequest` below takes a
 * `geocoder` on the same terms.
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
  // way for every other route. `docs/known-issues/` (KI-79) records what
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
    // The caps are the rejections a legitimate caller can hit by accident (a
    // pasted document, a long thread), so the response says which rule broke
    // rather than returning a generic envelope.
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

  // **The page scope is VERIFIED here, and this is the load-bearing rule of the
  // one-door design (ADR-033 Decision 2).**
  //
  // `scope` comes off the request body, so `pageId` is something the client
  // says. Three facts have to hold before a page tool is offered, and all three
  // are established server-side: the page EXISTS, it belongs to THIS trip — the
  // tripId in the URL, which `guard()` has already checked this actor against —
  // and the actor may EDIT it, which for a Notebook page is `editor` (the pages
  // CRUD routes pass the same minimum). Trusting the field instead would be the
  // same class of mistake as trusting a `tripId` parameter on a read tool, which
  // ADR-022 §3 already forbids.
  //
  // A claim that does not resolve is REFUSED, and never widened: falling back
  // to the trip-wide set would answer a page request with a planning turn,
  // which is the widest tool set in the app. "If the surface cannot be resolved
  // server-side, the narrowest tool set applies, not the widest."
  //
  // Missing and not-on-this-trip share one 404 deliberately. `getPage` is keyed
  // by id alone, so answering them differently would confirm the existence of a
  // page on a trip this actor cannot see.
  //
  // It runs BEFORE model selection and before the quota, so a bad page id costs
  // the caller nothing — the same ordering the demo refusal and the caps above
  // have, for the same reason.
  let page: Page | null = null;
  if (scope.kind === "page") {
    const found = await getPage(scope.pageId);
    if (found === null || found.tripId !== tripId) {
      return Response.json(
        { error: "That page is not on this trip.", code: PAGE_NOT_ON_TRIP_CODE },
        { status: 404 },
      );
    }
    if (!canWrite) return Response.json({ error: "forbidden" }, { status: 403 });
    page = found;
  }

  // Injected model => that exact model, flag never consulted; `simulated` is
  // derived from its IDENTITY, not from whether one was injected — so a test
  // that injects `simulatedModel()` to exercise the switched-off path is still
  // reported, and badged, as simulated.
  //
  // An injected model classifies as well as answers: one seam, so a test can
  // never end up exercising a classifier the turn itself did not use.
  let selected: { model: LanguageModel; classifierModel: LanguageModel; simulated: boolean };
  if (model) {
    selected = { model, classifierModel: model, simulated: modelIdOf(model) === SIMULATED_MODEL_ID };
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
    selected = {
      model: outcome.model,
      classifierModel: outcome.classifierModel,
      simulated: outcome.outcome === "simulated",
    };
  }

  // **Charged after validation and after model selection**, and that ordering is
  // a recorded incident, not a preference. Charging before selection meant a
  // missing AI_GATEWAY_API_KEY (the 503 above) burned the caller's whole hourly
  // and daily allowance on retries against an outage that produced zero provider
  // calls — the incident outlived its own fix by a day. A malformed request must
  // not cost the caller their allowance either. Nothing between selection and
  // here reads the counters, so the placement is order-safe. It applies in
  // simulated mode too: the limiter's job is to bound requests, not to guess
  // which ones reached a provider.
  //
  // **Two layers, both charged here (KI-67).** `aiQuotas` bounds how many times
  // an actor may ask; `aiStepQuotas` bounds what asking COSTS, in model
  // round-trips. KI-67 measured that metering requests alone turned a nominal
  // ceiling of 30 into a real one of 960, and its fix was wired into the command
  // endpoint only — so this endpoint, built afterwards and the door users
  // actually reach, was metered the way KI-67 had already proved wrong, for its
  // whole life. One door means one quota path; that is the point of the merge
  // rather than a bonus from it.
  //
  // Only one round-trip can be pre-authorised, because the real step count does
  // not exist until the run ends; `settleAiSteps` charges the rest from the
  // recorder's sink below. An actor already over either ceiling is refused here,
  // before a provider is touched. The in-flight overshoot this admission shape
  // permits is KI-94, unchanged by the move.
  const quota = await consumeQuota([...aiQuotas(), ...aiStepQuotas()], userId);
  if (!quota.allowed) return quotaRefusal(quota);

  // **What this turn is for, decided before the agent is built.**
  //
  // ~85% of a step's fixed input cost is tool schemas, and 12 of the 15 tools
  // are write tools that a question never calls — see the measurement in
  // askIntent.ts. One extra, tool-less round-trip buys back most of it.
  //
  // It is handed the two messages before this one, because the turn that
  // writes is often the one that says least: the 2026-08-29 thread ended a
  // long request with "Yes go ahead", and those three words did all ten
  // writes. In isolation they classify as a question — reasonably — and the
  // user would have got an assistant that could not act on the one turn that
  // mattered. Fail-open does not cover that: nothing fails.
  //
  // Two properties this call site is responsible for, not the classifier:
  //
  //   * **It can only narrow.** `canWrite` gates it, so a viewer is never
  //     classified at all — there is no write half to withhold, and paying for
  //     the call would be waste. `minimumRoleFor` below still has the final
  //     word on whatever comes out.
  //   * **It runs after the quota.** A turn refused before it reached a model
  //     must not have paid for a classification either.
  //
  // It goes to `classifierModel`, which is the answer model unless
  // AI_CLASSIFIER_MODEL says otherwise — a separate id, still built at
  // `selectAiModel`'s one chokepoint, so the kill switch covers both.
  //
  // `classifyAskIntent` is total — it fails open to `write` rather than
  // throwing — so there is deliberately no try/catch here to suggest otherwise.
  //
  // Sentry sees this call as its own `gen_ai.invoke_agent` run, separate from
  // the turn's — `askIntent.ts` names it through `telemetry.functionId`. That
  // separation is the point rather than an accident of where the call sits:
  // `AI_CLASSIFIER_MODEL` can put the classifier on a cheaper model than the
  // one answering, and "did the classifier save more than it cost" is
  // unanswerable if its spend is folded into the turn's — the same argument
  // `AskIntentRecord.model` makes for the log record.
  //   * **A page turn is not classified at all.** Its tool set is decided by a
  //     scope the server verified, not by what the sentence sounds like, so
  //     there is no write half to withhold and the call would be spend with
  //     nothing to buy.
  const classification =
    canWrite && page === null
      ? await classifyAskIntent(selected.classifierModel, question, recentContext(messages), request.signal)
      : null;
  const offerWrites = canWrite && page === null && classification?.intent !== "question";

  // The tool set for THIS turn, and the three sets are mutually exclusive by
  // construction: `page` is non-null only for a verified page scope, and
  // `offerWrites` is false whenever it is. A viewer reaches neither.
  //
  // The rule is enforced rather than commented: `minimumRoleFor` is asked what
  // the set about to be handed to the agent requires, and the actor must
  // already satisfy it. Unreachable while the lines above decide the set —
  // which is why it is here, because the next person to add a branch to them is
  // who this catches.
  const writeTools = offerWrites ? buildWriteTools() : null;
  const pageTools = page !== null ? buildPageTools() : null;
  const tools = { ...buildReadTools().tools, ...(writeTools?.tools ?? {}), ...(pageTools?.tools ?? {}) };
  const offeredNames = Object.keys(tools);
  if (!hasAtLeast(userId, detail.members, minimumRoleFor(offeredNames))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  // The step settlement's promise, so the end-of-turn path below can AWAIT it.
  //
  // The sink is synchronous — it is the AI SDK's own callback dispatch — but a
  // counter write is not, and a `void`ed one races the response: the serverless
  // function is free to stop once the stream closes, which would silently drop
  // the settlement and put this endpoint back where KI-67 found it. `onEnd` is
  // awaited by the SDK (`notify`, ai/dist), so awaiting there keeps the write
  // inside the request's own lifetime.
  //
  // The abort and error paths still settle, and still do not await: the
  // response is already gone or already failing, and best-effort is the honest
  // guarantee there. `settleAiSteps` never throws, so an unawaited one cannot
  // become an unhandled rejection.
  let settled: Promise<void> = Promise.resolve();

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
    // Beside `question` and `offeredTools`, which is what makes a
    // misclassification diagnosable after the fact rather than only visible as
    // an assistant that would not act.
    classification,
    // **One writer, two consumers.** `createAskRecorder`'s single-writer latch
    // already guarantees this fires exactly once per turn, on all three end
    // paths (`onEnd`, abort, error) — which makes it the right place to emit
    // the metrics too, rather than repeating that once-only logic at each of
    // the three call sites and getting it subtly wrong at one of them.
    //
    // The injected `sink` stays a pure test seam: a test that passes one reads
    // the record instead of the console, exactly as before, and
    // `recordAskMetrics` is a no-op without a Sentry client.
    sink: (record) => {
      (sink ?? logAskAnalytics)(record);
      recordAskMetrics(record);
      // The other half of KI-67: admission pre-authorised ONE round-trip, and
      // this settles what the turn actually cost. A third consumer of the same
      // single-writer latch, for the same reason the metrics are — the provider
      // was paid for those steps on all three end paths (`onEnd`, abort,
      // error), and repeating once-only logic at each of them is how one gets
      // it subtly wrong at one.
      //
      // Not awaited, and it cannot be: this fires from inside the agent's own
      // callback dispatch, long after the Response was returned. `settleAiSteps`
      // never refuses and never throws (see its comment) — a counter write must
      // not turn an answer the user already has into an error.
      //
      // **The classifier's own round-trip is counted here, not by the agent.**
      // `record.steps` is observed from `agent.onStepEnd`, so it can only ever
      // see steps the agent took; `classifyAskIntent` runs BEFORE the agent
      // exists and spends `selected.classifierModel` on the same key. Settling
      // `record.steps` alone therefore under-meters every classified turn by
      // exactly one — an editor turn can cost nine round-trips and settle
      // eight. That is the same shape as KI-67 itself (a control that does not
      // bound the thing it exists to bound), reintroduced inside the fix for
      // it, which is why it is spelled out rather than left to the arithmetic.
      //
      // `source` distinguishes the two paths: `"model"` means the call was
      // made, `"affirmation"` means the classifier short-circuited on a bare
      // "yes" and spent nothing. A page turn is not classified at all
      // (`classification` is null), so it adds nothing.
      const classifierSteps = record.classification?.source === "model" ? 1 : 0;
      settled = settleAiSteps(aiStepQuotas(), userId, record.steps + classifierSteps);
    },
  });

  const agent = new ToolLoopAgent({
    model: selected.model,
    // Three-way, not `offerWrites` alone: the instruction has to describe the
    // tools the model was actually handed AND stay true about what the user
    // may do. An editor whose turn classified as a question is told the turn
    // is retryable; a viewer is told what is actually true of them.
    instructions: instructionsFor(scope, detail.days.length, postureFor(canWrite, offerWrites), briefFor(page)),
    tools,
    toolsContext: readToolsContext({ tripId, userId, detail, scope }),
    stopWhen: isStepCount(MAX_ASK_STEPS),
    // **This is the whole of our AI-agent tracing, and it is one line.**
    //
    // Sentry's `VercelAI` integration (on by default) subscribes to the AI
    // SDK's own `ai:telemetry` diagnostics channel and emits the
    // `gen_ai.invoke_agent` / `gen_ai.generate_content` / `gen_ai.execute_tool`
    // spans for this run, with token usage, finish reasons and provider,
    // without any wiring here. `functionId` is the one thing it cannot infer:
    // without it the run's span is named the bare `invoke_agent`, and this
    // endpoint's turn is indistinguishable from the classifier's call and from
    // `/ai`'s planning run in the AI Agents view.
    //
    // See ADR-032 — including the version note, since the channel this rides
    // on is `ai` >= 7 only.
    telemetry: { functionId: "ask" },
    onStepEnd: (step) => recorder.observeStep(step),
    // `writeTools` is the SAME collection `messageMetadata`'s `buildProposal`
    // reads below — `onEnd` just runs first, before the stream's `finish`
    // part exists to build the actual proposal from. A second, cheap
    // `resolveBatch` dry run (`droppedWriteCalls`) is how the drop reaches
    // THIS record instead of only the client-facing proposal — see the
    // comment on `droppedWriteCalls` in writeTools.ts for why it isn't
    // shared with the call below instead.
    onEnd: async (end) => {
      recorder.finish(
        end,
        writeTools ? droppedWriteCalls(writeTools.getCollected(), detail, { tripId, actorId: userId }) : [],
      );
      // `finish` ran the sink, which started the settlement. See `settled`.
      await settled;
    },
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
        if (part.type !== "finish") return undefined;
        // At most one of these is non-null — the tool sets are disjoint above —
        // so the final chunk carries a proposal or a page, never both.
        if (pageTools !== null) return pageInsertsMetadata(pageTools.getInserts());
        if (writeTools === null) return undefined;
        const proposal = buildProposal(writeTools.getCollected(), detail, { tripId, actorId: userId });
        return proposal === null ? undefined : { proposal };
      },
      onError: (error) => {
        // The turn failed. Record it — WITH the error — before the message
        // goes out: `onEnd` will not fire, and the tool-call trace of a failed
        // turn is the whole reason to keep one.
        //
        // Passing `error` rather than only the reason is the 2026-08-29 fix. A
        // live turn failed here, this line recorded `finishReason: "error"`,
        // and the only thing that ever saw the actual cause was the client —
        // the message went out on the stream and nothing wrote it down. The
        // whole diagnosis was "step 1 finished, step 2 did not".
        recorder.abandon("error", error);
        // The client sees the real reason rather than "An error occurred.",
        // which is the SDK's default and is indistinguishable from a network
        // failure in the rail.
        return errorMessage(error);
      },
    });
  } catch (err) {
    // Nothing in the body is left to be wrong — the messages validated above
    // and the caps passed. What remains is the agent failing to start, which
    // is a model that could not be reached: 503, the same shape model SELECTION
    // failing returns above, so a client sees one code for "no model answered".
    recorder.abandon("error", err);
    return Response.json(
      { error: `model call failed: ${errorMessage(err)}`, simulated: selected.simulated },
      { status: 503 },
    );
  }
}

/**
 * What the model is told about the page it is writing: its own title, read from
 * the row the server just verified rather than from the request body — the same
 * rule the pageId is under.
 *
 * It used to carry the page's day binding too. A page has no day (SPEC §18,
 * ADR-035 decision 1): a day is a widget's own param, so there is nothing at
 * page level left to resolve.
 */
export interface PageBrief {
  title: string;
}

function briefFor(page: Page | null): PageBrief | null {
  return page === null ? null : { title: page.title };
}

/**
 * What the turn wants inserted, on the run's final chunk — or the reason there
 * is nothing.
 *
 * **Validation runs HERE, before a byte leaves the server.** `insert_widget`'s
 * schema closes the widget NAME against the registry and `insertWidget` checks
 * its params, so this is the second look rather than the only one — but it is
 * the one that sees the assembled result, including whatever `insert_text`
 * produced. The endpoint this replaced answered a bad doc with a 422; a stream
 * has already sent its 200, so the refusal rides out as data the client renders
 * — the nodes themselves still never reach it.
 *
 * **There is no approval step, and that is deliberate.** The nodes land in the
 * editor and the Notebook's existing debounced autosave persists them — which
 * is what `onApply` has always expected. A proposal exists because a planning
 * batch commits events; inserted prose is text in an editor the user is looking
 * at, and interposing an Approve button between asking and seeing it would be a
 * new step this move did not ask for.
 *
 * **Nothing inserted is not an error the way no page composed was.** A turn can
 * legitimately answer a question about the page without editing it — that is
 * most of what a conversation does — so an empty insert list is silence, not a
 * failure. Only a turn that produced nodes which fail validation reports one.
 */
function pageInsertsMetadata(inserts: PageInserts): Record<string, unknown> {
  if (inserts.nodes.length === 0) return {};
  const validated = validatePageInserts(inserts.nodes);
  if ("error" in validated) return { composeError: validated.error };
  return { pageInserts: { content: validated } };
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

// The log line and the counters, from the one record. Same shape, and the same
// reasoning, as the `/ask` sink above: one writer, two consumers, and an
// injected sink in a test still reads the record instead of the console.
const defaultApplySink: ProposalApplySink = (record) => {
  console.info(record.event, record);
  recordProposalApplyMetrics(record);
};

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
 * `geocoder` is a test seam, and it is resolved LAZILY for a recorded reason:
 * `getGeocoder()` throws without LOCATIONIQ_API_KEY, so a default-parameter
 * form would break every approval on a deployment that has no key, including
 * batches carrying no location at all. `commitProposal` documents the incident.
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
 * What this turn may do, which is not the same question as what the ACTOR may
 * do. Three answers, and the middle one is the reason this is not a boolean.
 *
 *   * `propose`   — an editor, holding the write tools.
 *   * `withheld`  — an editor whose turn the classifier read as a question, so
 *     the write tools were not handed over (askIntent.ts).
 *   * `read-only` — a viewer. They cannot edit at all.
 */
export type AskToolPosture = "propose" | "withheld" | "read-only";

// The one line that tells the model what it can do this turn.
//
// `withheld` and `read-only` are different sentences, and that difference is
// load-bearing. A viewer genuinely cannot edit, so "I can only answer
// questions about the trip for now" is true for them. Telling an EDITOR the
// same thing is a lie — they can edit; this turn simply was not given the
// tools — and it is a lie with no way out of it: there is no mid-turn
// escalation and no client retry, so a model that misclassified the turn
// would produce a dead end rather than an extra turn.
//
// The classifier is a live model and will be wrong sometimes; that is priced
// in (askIntent.ts biases every uncertainty toward `propose`). A dead end is
// not. So the withheld copy names the recovery: say what is missing, and the
// user asks again.
const ACCESS_LINE: Record<AskToolPosture, string> = {
  // The propose→review→approve contract, said to the model in the terms it can
  // act on. It is not the mechanism — the write tools collect and commit
  // nothing, so a model that ignored every word of this still could not change
  // the trip (writeTools.ts) — it is what stops the answer CLAIMING an edit
  // that has not happened yet.
  propose:
    "You can read this trip, and you can PROPOSE changes to it. A change tool call is not applied: every call you make this turn is collected into one proposal the user reviews and approves or rejects. So never say you have added, moved or removed anything — say what you would change, and that it is waiting for them.",
  withheld:
    "You can read this trip, but on THIS turn you have no tool to change it. You are not refusing them — they can change this trip. If what they asked for was a change rather than a question, answer what you can, then tell them plainly that you cannot draft that change on this turn and to ask again saying what they want changed. Never tell them the assistant cannot make changes.",
  "read-only":
    "You can READ this trip and nothing else. You cannot add, move, remove or change anything — if you are asked to, say plainly that you can only answer questions about the trip for now.",
};

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
export function instructionsFor(
  scope: AskScope,
  dayCount: number,
  posture: AskToolPosture = "read-only",
  page: PageBrief | null = null,
): string {
  // A page turn is a different job, not a variant of this one: it composes a
  // document rather than answering, and every planning rule below (activityRef,
  // dayRef, MoveActivity positions, conflict refs) describes tools it was not
  // handed. The endpoint this replaced sent those rules anyway — ~1.5k
  // characters of dead instruction on every page request, left verbatim by
  // ADR-033's first step because trimming them changes what a live model is
  // told. This is where that gets paid off: the branch is the trim.
  if (page !== null) return pageInstructions(scope, dayCount, page);
  const canWrite = posture === "propose";
  return [
    "You are the travel-collab trip assistant. You answer questions about one trip.",
    ACCESS_LINE[posture],
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

/**
 * The system instruction for a page-authoring turn.
 *
 * It carries the macro catalog because that is the one thing no tool returns:
 * `insert_widget`'s schema closes the widget NAME set (pageTools.ts derives it
 * from the registry), but a model that has never seen the descriptions emits
 * widgets with the wrong params, and `insertWidget` refuses each one. The old
 * envelope shipped this same catalog alongside a full trip summary; the summary
 * is gone because the read tools answer for the trip, and a turn that needs day
 * 3 now asks for day 3 instead of paying for all fourteen.
 */
function pageInstructions(scope: AskScope, dayCount: number, page: PageBrief): string {
  return [
    "You are the travel-collab trip assistant, and on this turn you are ADDING to one page of this trip's Notebook.",
    `The page is called "${page.title}". You are inserting into what is already there — never rewriting or replacing the page.`,
    "Use ONLY what the tools return. You cannot see the trip any other way, and you never guess a time, a price, a place or a date.",
    "Call read_trip first for the trip's shape, and read_day for what happens on a day (it is the only place stop times live).",
    // **This said `compose_page` until 2026-09-04, and that tool no longer
    // exists** (ADR-035 decision 5 replaced it with the two insert tools). A
    // live model was being told to call a name absent from its own tool list,
    // and to replace a document the surface no longer replaces. The simulated
    // model hid it: it emits `insert_text` regardless of what it is told.
    // Found by CodeRabbit and Copilot on PR 139.
    "Then write with insert_text and insert_widget. Call them as many times as the answer needs, in the order the content should appear — every call adds to the page, and nothing you insert removes what was there.",
    "insert_text takes markdown: headings, bullet lists, ordered lists and paragraphs. Inline formatting like **bold** is NOT interpreted and would appear literally, so write plain sentences.",
    "insert_widget takes a widget name and that widget's own params. Every param is a filter and every one is optional: omit them all and the widget covers the whole trip, which is valid and usually what you want.",
    // The reason the macro registry was worth deriving a tool from at all: a
    // macro renders live trip data every read, so it cannot go stale the way a
    // number typed into a paragraph does the moment someone moves a stop.
    "A macro block renders live trip data every time the page is opened. Prefer one over writing the same fact into a paragraph, which goes stale the moment the trip changes.",
    `These are the only macros that exist — never invent a name: ${JSON.stringify(primitiveCatalog())}`,
    // A page is about nothing in particular (SPEC §18) — the day a macro reads
    // is that macro's own filter. This sentence used to warn that a day macro
    // drafted with no day renders as a "no day set" placeholder; under ADR-039
    // decision 2 that is no longer true, and repeating it would push the model
    // towards binding a day it has no reason to guess. `primitiveCatalog()`
    // above carries each widget's `selection` — its entity and the dimensions
    // it accepts — so the model can see what is legal rather than infer it.
    "A page is not about any one day. A widget with no filters set covers the whole trip, which is a real answer and never a placeholder — leave a filter out unless the sentence you are writing is specifically about one day, city, tag or kind.",
    `Day numbers are 1-based everywhere, and this trip has ${dayCount} day${dayCount === 1 ? "" : "s"}.`,
    "Every money amount is an integer in the currency's minor units (cents), never a decimal.",
    "Then say ONE short sentence about what you added. What you inserted lands in the editor for the user to review and edit, so never say you have saved or published it.",
    askScopeLine(scope),
  ].join("\n");
}

// A LanguageModel is either a bare model-id string or a provider model object
// carrying `.modelId` — normalize to the requested id either way.
/** What the turn may do, from what the actor may do and what this turn was given. */
export function postureFor(canWrite: boolean, offerWrites: boolean): AskToolPosture {
  if (offerWrites) return "propose";
  return canWrite ? "withheld" : "read-only";
}

function modelIdOf(model: LanguageModel): string {
  return typeof model === "string" ? model : model.modelId;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
