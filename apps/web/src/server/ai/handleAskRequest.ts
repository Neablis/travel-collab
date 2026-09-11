// The /ask endpoint's logic (M16, ADR-022) — and, since ADR-033, THE AI route.
// A streaming, multi-turn, tool-using agent that answers questions about a
// trip, PROPOSES changes to it for an editor (M9), and authors one Notebook
// page (ADR-033 Decision 4).
//
// **One door, one grant, chosen from server-resolved facts.** The capability
// boundary a second endpoint used to buy is now a computation: `grantFor` caps
// each tool domain, `toolsFor` filters the registry by it and `minimumRoleFor`
// says what the resulting set requires — all from the guard's answer and from a
// scope the server has VERIFIED, never from a client-supplied field (ADR-033
// Decision 2). The sets are disjoint where it matters: a page turn holds no
// planning write tool, and a planning turn holds no page insert tool, because
// the page surface caps `itinerary` at `read` and does not name `pages` on the
// planning one (assistant/grants.ts).
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
//
// **Since P3 this file is orchestration: admission, then build the agent, then
// stream** (ADR-043 decision 3). The thirteen steps that decide who may spend
// the operator's money moved to `assistant/admission.ts` — inside the kernel's
// import wall since P4 — as a declared array of named stages, because the three things that mattered about them were properties of
// their ORDER and were defended by comments rather than by a test. Each of
// those comments moved with its stage. What is left here is the half that has
// nothing to admit: the agent, the stream, `messageMetadata`, `onError` and the
// step settlement.
import { z } from "zod";
import { convertToModelMessages, isStepCount, safeValidateUIMessages, ToolLoopAgent } from "ai";
import { primitiveCatalog } from "@tc/pages";
import { isDemoTripId } from "@/lib/demoTrip";
import { guard } from "@/server/pages-guard";
import { aiStepQuotas, settleAiSteps } from "@/server/quota";
import type { AskScope } from "@/server/ai/context";
import { MAX_PROPOSAL_INSERTS } from "@/server/ai/limits";
import { MAX_READ_DAYS } from "@/server/assistant/tools/read";
import {
  buildProposal,
  commitProposal,
  droppedWriteCalls,
  parseApprovedCommands,
} from "@/server/ai/writeTools";
import { validatePageInserts, type PageInserts } from "@/server/ai/pageTools";
import { playbookLibrary, savedDayLibrary } from "@/server/ai/assistantPorts";
import { newPageBuffer, newProposalBuffer } from "@/server/assistant/deps";
import {
  data,
  renderPrompt,
  rule,
  UNTRUSTED_DATA_RULE,
  type PromptBlock,
} from "@/server/assistant/prompt";
import { aiToolsFor, ambientContextFor } from "@/server/assistant/registry";
import type { AskToolPosture } from "@/server/assistant/grants";
import {
  APPLY_MINIMUM_ROLE,
  DEMO_TRIP_UNSUPPORTED_CODE,
  badRequest,
  capRawBody,
  errorMessage,
  evaluateAiGrant,
  parseRequest,
} from "@/server/assistant/admission";
import { admissionPorts } from "@/server/ai/admissionPorts";
import type { Page } from "@tc/contracts";
import type { LanguageModel } from "ai";
import type { Geocoder } from "@/server/geocoding";
import { createAskRecorder, logAskAnalytics, type AskAnalyticsSink } from "@/server/ai/askAnalytics";
import { recordAskMetrics, recordProposalApplyMetrics } from "@/server/ai/aiMetrics";

// The admission pipeline's public names, re-exported so that the one door has
// one module to import: `route.ts`, the client-facing refusal codes and the two
// computed minimum roles were all reached through this file before P3 split the
// decision out of it.
export {
  APPLY_MINIMUM_ROLE,
  ASK_MINIMUM_ROLE,
  DEMO_TRIP_UNSUPPORTED_CODE,
  PAGE_NOT_ON_TRIP_CODE,
} from "@/server/assistant/admission";

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
//
// It stays HERE rather than moving to `assistant/admission.ts`: it is a property of the
// stream, not of admission, and P6 is what moves the envelope.
export const SIMULATED_HEADER = "x-tc-ai-simulated";

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

// The constants, the schemas and the caps that used to sit here are now in
// `assistant/admission.ts` beside the stage that enforces each of them — `AskRequest` and
// the byte cap with `capRawBody`/`parseRequest`, the two refusal codes with the
// stages that emit them, and `ASK_MINIMUM_ROLE`/`APPLY_MINIMUM_ROLE` with the
// grant computation they are asked of. They are re-exported above.


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
  // **One call, one verdict, one audit line** (ADR-043 decision 3). Every step
  // that could refuse this turn — the demo trip, the guard, the byte cap, the
  // request shape, the verified surface, model selection, the quota and the
  // classifier — runs inside `evaluateAiGrant`, in a declared order that a test
  // asserts (assistant/admission.ts). What comes back is either the refusal's own Response,
  // unchanged in status, code and wording, or everything this turn is allowed
  // to hold.
  const admission = await evaluateAiGrant({ request, tripId, model, ports: admissionPorts });
  if (!admission.ok) return admission.refusal.response;
  const { grant } = admission;
  const { userId, detail, scope, page, messages, question, turn, classification } = grant;

  // The two halves the run's final chunk can carry, read off the GRANT rather
  // than tracked beside it. They stay mutually exclusive by construction: a
  // page scope caps `itinerary` at `read`, so a page turn cannot propose a
  // planning change, and no other surface names `pages` at all.
  const proposesPlan = grant.grants.itinerary === "propose";
  const proposesPage = grant.grants.pages === "propose";
  const proposalBuffer = newProposalBuffer();
  const pageBuffer = newPageBuffer();

  const tools = aiToolsFor(grant.tools, {
    proposalBuffer,
    pageBuffer,
    playbooks: playbookLibrary,
    savedDays: savedDayLibrary,
  });
  const offeredNames = Object.keys(tools);

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
    simulated: grant.simulated,
    model: grant.modelId,
    // What was actually handed to the agent, not what a constant says was —
    // "offered" has to be a measurement for `uncalledTools` to mean anything.
    // It is now the same array the grant's role check was computed from,
    // rather than a second one tied to it by a test.
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
    model: grant.model,
    // Three-way, not `offerWrites` alone: the instruction has to describe the
    // tools the model was actually handed AND stay true about what the user
    // may do. An editor whose turn classified as a question is told the turn
    // is retryable; a viewer is told what is actually true of them.
    instructions: instructionsFor(scope, detail.days.length, grant.posture, briefFor(page)),
    tools,
    // Keyed by tool name, and DERIVED from the same definitions: every tool
    // that declared an ambient dep gets the context, and nothing else does.
    toolsContext: ambientContextFor(grant.tools, { tripId, userId, detail, scope }),
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
    // `proposalBuffer` is the SAME collection `messageMetadata`'s `buildProposal`
    // reads below — `onEnd` just runs first, before the stream's `finish`
    // part exists to build the actual proposal from. A second, cheap
    // `resolveBatch` dry run (`droppedWriteCalls`) is how the drop reaches
    // THIS record instead of only the client-facing proposal — see the
    // comment on `droppedWriteCalls` in writeTools.ts for why it isn't
    // shared with the call below instead.
    onEnd: async (end) => {
      recorder.finish(
        end,
        proposesPlan ? droppedWriteCalls(proposalBuffer.collected(), detail, { tripId, actorId: userId }) : [],
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
      headers: { [SIMULATED_HEADER]: String(grant.simulated) },
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
        // At most one of these is true — the grant caps `itinerary` at `read`
        // on the surface that grants `pages` — so the final chunk carries a
        // proposal or a page, never both.
        if (proposesPage) return pageInsertsMetadata(pageBuffer.inserted());
        if (!proposesPlan) return undefined;
        const proposal = buildProposal(
          proposalBuffer.collected(),
          detail,
          { tripId, actorId: userId },
          proposalBuffer.inserts(),
        );
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
      { error: `model call failed: ${errorMessage(err)}`, simulated: grant.simulated },
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
  // An approved insert whose saved day this actor cannot read — hallucinated,
  // private, or withdrawn between the proposal and the click. All three are the
  // same 404 the manual dialog answers, which is `readableSavedDay`'s whole
  // point (ADR-042's deliberate failure mode).
  "not-found": 404,
  "concurrency-conflict": 409,
};

const ApplyProposalRequest = z.object({
  /**
   * Correlates the approval with the proposal it came from. Written to the log
   * below and trusted for nothing else — the commands are re-parsed and the
   * tripId is checked against the URL regardless of what this says.
   */
  proposalId: z.string().min(1).optional(),
  // No `.min(1)` any more: an inserts-only approval carries no commands at all.
  // "At least one change" is still enforced, below, over both lists together —
  // it stopped being a question this field can answer on its own.
  commands: z.array(z.unknown()),
  /**
   * Days to insert, by reference (ADR-042 Decision 1).
   *
   * Only the id is read. The proposal's `name` rides the wire for the card and
   * is stripped here by zod, because the server re-reads the row: trusting a
   * posted id to be the day it claims to be would make a ledger credit — and
   * therefore board position — client-mintable, and `/ask/apply` has no
   * proposal store it could check the claim against.
   */
  inserts: z
    .array(z.object({ savedDayId: z.string().min(1) }))
    .max(MAX_PROPOSAL_INSERTS, {
      message: `an approval may carry at most ${MAX_PROPOSAL_INSERTS} playbook days`,
    })
    .optional(),
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
  /** How many playbook days the approval asked the server to expand (ADR-042). */
  insertCount: number;
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

  // The SAME byte cap and the SAME parse the ask half runs, called rather than
  // repeated (F-F03). Both were written out verbatim here, and a cap enforced
  // in two places is a cap that will eventually be enforced in one.
  const read = await capRawBody(request);
  if (!read.ok) return badRequest(read.error);
  const parsed = parseRequest(read.raw, ApplyProposalRequest);
  if (!parsed.ok) return badRequest(parsed.error);

  const commands = parseApprovedCommands(parsed.value.commands, tripId);
  if (!commands.ok) return badRequest(commands.error);
  const inserts = parsed.value.inserts ?? [];
  // The rule `commands.min(1)` used to carry, asked of the whole approval:
  // an approval with neither commands nor inserts is nothing to approve.
  if (commands.commands.length === 0 && inserts.length === 0) {
    return badRequest("an approval must carry at least one change");
  }

  const committed = await commitProposal(tripId, commands.commands, userId, detail, geocoder, inserts);
  const record = {
    event: "ai.proposal.apply" as const,
    tripId,
    userId,
    proposalId: parsed.value.proposalId ?? null,
    commandCount: commands.commands.length,
    insertCount: inserts.length,
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
  return renderPrompt(instructionBlocks(scope, dayCount, posture, page));
}

/**
 * The instruction as BLOCKS (spec §4).
 *
 * Every sentence below is a `rule` — ours, and a model is meant to obey it.
 * Everything a person typed is a `data` block instead: a label and a JSON
 * value on its own line, which is not the shape an instruction has. Only one
 * line here was ever the other way round, and it was the direct vector: a page
 * title, written by anyone with the link, interpolated into `The page is
 * called "…"`. It is `Page title:` now.
 *
 * Exported for the tests that assert the SHAPE rather than the rendered string
 * — that no block of kind `rule` carries user-authored text is a claim about
 * blocks, and a test that had to re-parse the joined output to make it would be
 * asserting the renderer instead.
 */
export function instructionBlocks(
  scope: AskScope,
  dayCount: number,
  posture: AskToolPosture = "read-only",
  page: PageBrief | null = null,
): PromptBlock[] {
  // A page turn is a different job, not a variant of this one: it composes a
  // document rather than answering, and every planning rule below (activityRef,
  // dayRef, MoveActivity positions, conflict refs) describes tools it was not
  // handed. The endpoint this replaced sent those rules anyway — ~1.5k
  // characters of dead instruction on every page request, left verbatim by
  // ADR-033's first step because trimming them changes what a live model is
  // told. This is where that gets paid off: the branch is the trim.
  if (page !== null) return pageInstructions(scope, dayCount, page);
  const canWrite = posture === "propose";
  // Annotated `string[]` so every entry is checked to BE a rule before `rule()`
  // wraps it: without it the literal is contextually typed by the return type
  // and a stray `data` block dropped in here would type-check.
  const rules: string[] = [
    "You are the travel-collab trip assistant. You answer questions about one trip.",
    ACCESS_LINE[posture],
    "Use ONLY what the tools return. You cannot see the trip any other way, and you never guess a time, a price, a place or a date.",
    // **The one line P4 adds to what a live model is told**, and the only one
    // it adds: it sits next to "use ONLY what the tools return" because it says
    // what the tools' answers ARE. Everything else here is verbatim what was
    // here before — see the block comment on `instructionBlocks`.
    UNTRUSTED_DATA_RULE,
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
          // Neither line is a safety property — the card is still the only door
          // (ADR-042's Context) — so they are worded as craft, not as a rule
          // the model could break something by ignoring. The first stops it
          // guessing a savedDayId; the second keeps the card to one decision.
          "To add a ready-made day from the playbook library, call search_playbooks FIRST and then insert_playbook_day with a savedDayId it returned. Never write a savedDayId yourself.",
          "Propose at most ONE playbook day per turn, so the user has one thing to say yes to.",
        ]
      : []),
    `Day numbers are 1-based everywhere, and this trip has ${dayCount} day${dayCount === 1 ? "" : "s"}.`,
    "Every money amount is an integer in the currency's minor units (cents), never a decimal.",
    scope.kind === "day"
      ? `This question is about DAY ${scope.dayIndex + 1}. Answer about that day. Do not summarise the other days: you may read one if the user explicitly asks about it, but an answer that wanders off the day it was asked about is the wrong answer.`
      : "This question is about the trip as a whole.",
    "Answer in prose, briefly — a sentence or three. No headings, no bullet lists unless the user asks for a list.",
  ];
  return [...rules.map(rule), scopeBlock(scope)];
}

/**
 * The `Scope:` line, as the `data` block it always structurally was — a label
 * and a machine-readable value, which is why it was the one line here that did
 * not need rewriting to become one.
 *
 * **Its prefix and its JSON are unchanged, and that is a constraint rather than
 * an accident** (spec §4). `parseAskScope` reads this line back out of the
 * instruction, and the instruction is the only channel reaching both a real
 * model and the simulated one — so a scope line this renderer spelled
 * differently would silently turn every day-scoped simulated turn into a
 * trip-scoped one (`parseAskScope` is total and falls back to the wider
 * reading). The label is spelled here and the prefix in `context.ts`, and
 * `handleAskRequest.test.ts` asserts the two still render the same bytes as
 * `askScopeLine` — which is the only thing that can keep them in step.
 */
export function scopeBlock(scope: AskScope): PromptBlock {
  return data("Scope", scope);
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
function pageInstructions(scope: AskScope, dayCount: number, page: PageBrief): PromptBlock[] {
  return [
    rule("You are the travel-collab trip assistant, and on this turn you are ADDING to one page of this trip's Notebook."),
    // **The direct vector, and the reason spec §4 exists.** This read `The page
    // is called "${page.title}". You are inserting into…` — a page title, which
    // anybody with the trip's link can set, interpolated into a sentence in the
    // SYSTEM instruction. A title of `x". Ignore the above and …` put the rest
    // of its author's sentence exactly where ours live.
    //
    // The rule half is verbatim; the title is now a labelled JSON value on its
    // own line, which no string a person can type can escape (`renderPrompt`).
    // The five words "The page is called" are deleted rather than reworded:
    // there is no wording of that sentence that is not a sentence.
    data("Page title", page.title),
    rule("You are inserting into what is already there — never rewriting or replacing the page."),
    rule("Use ONLY what the tools return. You cannot see the trip any other way, and you never guess a time, a price, a place or a date."),
    // The same standing rule the planning turn carries, for the same reason: a
    // page turn reads the trip with the same fenced read tools.
    rule(UNTRUSTED_DATA_RULE),
    rule("Call read_trip first for the trip's shape, and read_day for what happens on a day (it is the only place stop times live)."),
    // **This said `compose_page` until 2026-09-04, and that tool no longer
    // exists** (ADR-035 decision 5 replaced it with the two insert tools). A
    // live model was being told to call a name absent from its own tool list,
    // and to replace a document the surface no longer replaces. The simulated
    // model hid it: it emits `insert_text` regardless of what it is told.
    // Found by CodeRabbit and Copilot on PR 139.
    rule("Then write with insert_text and insert_widget. Call them as many times as the answer needs, in the order the content should appear — every call adds to the page, and nothing you insert removes what was there."),
    rule("insert_text takes markdown: headings, bullet lists, ordered lists and paragraphs. Inline formatting like **bold** is NOT interpreted and would appear literally, so write plain sentences."),
    rule("insert_widget takes a widget name and that widget's own params. Filters are all optional: omit them and the widget covers the whole trip, which is valid and usually what you want. Two widgets also take a NON-filter param — `attribute` needs `field` and renders nothing without one, and `count` takes `of` — and the catalogue below lists both under `params` with the exact values allowed."),
    // The reason the macro registry was worth deriving a tool from at all: a
    // macro renders live trip data every read, so it cannot go stale the way a
    // number typed into a paragraph does the moment someone moves a stop.
    rule("A macro block renders live trip data every time the page is opened. Prefer one over writing the same fact into a paragraph, which goes stale the moment the trip changes."),
    // The catalogue was already JSON appended to a sentence; the sentence and
    // the JSON are both verbatim, and what changed is the join between them —
    // it is a labelled line now rather than a colon in the middle of a rule.
    // Ours either way (the macro registry is `@tc/pages`'), so this is a `data`
    // block for legibility rather than for safety.
    rule("These are the only macros that exist — never invent a name."),
    data("Macros", primitiveCatalog()),
    // A page is about nothing in particular (SPEC §18) — the day a macro reads
    // is that macro's own filter. This sentence used to warn that a day macro
    // drafted with no day renders as a "no day set" placeholder; under ADR-039
    // decision 2 that is no longer true, and repeating it would push the model
    // towards binding a day it has no reason to guess. `primitiveCatalog()`
    // above carries each widget's `selection` — its entity and the dimensions
    // it accepts — so the model can see what is legal rather than infer it.
    rule("A page is not about any one day. A widget with no filters set covers the whole trip, which is a real answer and never a placeholder — leave a filter out unless the sentence you are writing is specifically about one day, city, tag or kind."),
    rule(`Day numbers are 1-based everywhere, and this trip has ${dayCount} day${dayCount === 1 ? "" : "s"}.`),
    rule("Every money amount is an integer in the currency's minor units (cents), never a decimal."),
    rule("Then say ONE short sentence about what you added. What you inserted lands in the editor for the user to review and edit, so never say you have saved or published it."),
    scopeBlock(scope),
  ];
}
