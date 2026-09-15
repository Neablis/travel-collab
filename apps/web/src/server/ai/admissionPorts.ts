// The app's side of the admission pipeline's ports (ADR-043 decision 3, P3).
//
// Same shape and same reason as `assistantPorts.ts` one level down: the
// pipeline decides, and everything it decides ABOUT arrives here. Two of these
// have no alternative — `guard()` imports next-auth, which the unit lane
// cannot load at all, and `getPage` reaches Postgres — so a pipeline that
// imported them directly would be a pipeline whose order could only ever be
// asserted through the integration suite. The other three follow, because a
// stage order is only testable if every stage's effect is observable.
//
// Each adapter is deliberately thin. One that computed anything would be
// admission logic outside the pipeline, and the `ai.grant` record's claim to
// name everything a turn was allowed would stop being a measurement.
import * as Sentry from "@sentry/nextjs";
import { guard } from "@/server/pages-guard";
import { getPage } from "@/server/pages";
import { AI_NOT_ENTITLED_CODE, deniedResponse, selectAiModel } from "@/server/ai/modelSelection";
import { aiQuotas, aiStepQuotas, consumeQuota, quotaRefusal, reserveAiSteps } from "@/server/quota";
import { classifyAskIntent } from "@/server/ai/askIntent";
import { SIMULATED_MODEL_ID } from "@/server/ai/simulatedModel";
import type { AdmissionPorts, AiGrantRecord, AiGrantSink } from "@/server/assistant/admission";

/**
 * The `ai.grant` line — `console.info`, matching `ai.ask` (askAnalytics.ts) and
 * `ai.proposal.apply`: no table and no migration, and Vercel captures it as a
 * queryable line.
 *
 * **`withIsolationScope` is what keeps the actor out of Sentry, and it is not
 * optional.** Sentry's `Console` integration is on by default and copies every
 * `console.info` into a breadcrumb on the current isolation scope; this record
 * names the actor by `userId`, so without the fork the next event or
 * transaction of the same request carries that id — and the whole record,
 * kilobytes of it — to a destination `sendDefaultPii: false` and `aiMetrics.ts`
 * (whose attributes are deliberately id-free) exist to keep it out of. Forking
 * the isolation scope for the write puts the breadcrumb on a scope that is
 * discarded when the callback returns.
 *
 * Measured, not reasoned: `ask/telemetry.int.test.ts` — *"sends no question
 * text and no unbounded identifier anywhere in the payload"* — fails without
 * it, naming `ask-telemetry-owner` inside the transaction envelope. That suite
 * initialises Sentry with DEFAULT options on purpose, so a `beforeBreadcrumb`
 * in `sentry.shared.ts` would not have satisfied it; the leak has to be closed
 * where the line is written.
 *
 * `ai.ask` and `ai.proposal.apply` have the same shape and are not wrapped:
 * both are written after the request's transaction is captured, or through a
 * sink a test replaced. That is timing, not a rule — see the report filed with
 * this change.
 */
export const logAiGrant: AiGrantSink = (record: AiGrantRecord) => {
  Sentry.withIsolationScope(() => {
    console.info("ai.grant", JSON.stringify(record));
  });
};

export const admissionPorts: AdmissionPorts = {
  identifyActor: (tripId, minimum) => guard(tripId, minimum),
  loadPage: (pageId) => getPage(pageId),
  // `surface: "ask"` is fixed here rather than passed in: there is one door
  // (ADR-033), and a second surface reaching this pipeline would be a new
  // adapter rather than a parameter on an existing one.
  //
  // A `denied` outcome is RENDERED here. `deniedResponse` and
  // `AI_NOT_ENTITLED_CODE` are the HTTP contract for it, defined once in
  // modelSelection.ts *"so /ask's two halves render the same refusal rather
  // than each inventing its own shape"* — so the pipeline is handed the
  // Response rather than a code string it would rebuild the 403 from. Live and
  // simulated pass straight through: `ModelChoice` is `ModelSelection` with
  // exactly this one branch re-spelled.
  selectModel: async (userId) => {
    const outcome = await selectAiModel({ surface: "ask", userId });
    return outcome.outcome === "denied"
      ? { ...outcome, code: AI_NOT_ENTITLED_CODE, response: deniedResponse(outcome.reason) }
      : outcome;
  },
  // **Both layers, but SPLIT rather than one call (KI-67, KI-94).** `aiQuotas`
  // bounds how many times an actor may ask and still charges exactly 1 per
  // request through `consumeQuota` — it meters calls, not cost, so that
  // charge is correct as-is. `aiStepQuotas` bounds what asking COSTS in
  // round-trips, and used to ride the same `consumeQuota` call charging 1 up
  // front and settling the rest afterwards — which bounded a single actor's
  // overshoot to one budget but bounded nothing under concurrency: N requests
  // in flight had each charged 1, so they could jointly pass the global step
  // ceiling before any of them settled. `reserveAiSteps` now charges the full
  // step budget at admission instead, so in-flight exposure is exactly the
  // reservation (`quota.ts`'s own comment has the rest).
  //
  // Refused if EITHER layer refuses — unchanged from the combined call, and
  // still checked in this order: an actor already over their request ceiling
  // is refused before a step reservation is ever charged.
  //
  // The refusal is rendered here for `selectModel`'s reason: `quotaRefusal`
  // owns the 429/503 split and the `Retry-After` header, and a second copy of
  // either inside the kernel is a second thing to keep in step.
  //
  // **The ceilings arrive from `selectModel`, not from a default** (spec §3b,
  // §7d). That is the whole of link 5's wiring: per-user numbers come from the
  // account's pinned plan version, global ones stay in the environment, and the
  // bucket names do not move. Today the default resolver names no ceiling, so
  // both calls return exactly the policies they always did.
  // `budget` is the caller's real per-request step budget (`AdmissionInput.stepBudget`,
  // `handleAskRequest.ts`'s `MAX_ASK_STEPS`) — passed straight through to
  // `reserveAiSteps`, which falls back to its own defensive default when this
  // is `undefined`. Reserving `AI_MAX_STEPS_PER_REQUEST` against a caller
  // whose real budget is a fraction of it made in-flight exposure larger than
  // any turn could ever use (final review finding, P4 ruling).
  admitQuota: async (userId, ceilings, budget) => {
    const requestDecision = await consumeQuota(aiQuotas(ceilings), userId);
    if (!requestDecision.allowed) return { ...requestDecision, response: quotaRefusal(requestDecision) };

    const { decision, reservation } = await reserveAiSteps(aiStepQuotas(ceilings), userId, undefined, undefined, budget);
    if (!decision.allowed) return { ...decision, response: quotaRefusal(decision) };

    return { allowed: true, reservation };
  },
  // The one identity the kernel cannot compare for itself: `simulatedModel.ts`
  // reaches the write tools and the read readouts, so it is behind the wall,
  // and the pipeline derives `grant.simulated` from an INJECTED model's id
  // (a test seam) as well as from a live selection.
  isSimulated: (modelId) => modelId === SIMULATED_MODEL_ID,
  classify: (model, question, context, signal) => classifyAskIntent(model, question, context, signal),
  audit: logAiGrant,
};
