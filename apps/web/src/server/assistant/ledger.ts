// **Cost is a return value** (ADR-043 decision 4, spec §6, §7a, §7b).
//
// One value per turn, and the three things that used to assemble cost at three
// points inside a callback — the analytics log, the Sentry metrics and the step
// settlement — become READERS of it.
//
// **It is M20 link 9's `ai_usage` row, field for field**, so that link is an
// `INSERT` plus a migration rather than a measurement design. Four constraints
// come with that, and each is a defect if taken the other way.
//
//   1. **Turn and classifier tokens stay SEPARATE.** The whole reason the
//      classifier has its own model id, its own `gen_ai.invoke_agent` span and
//      its own `AskIntentRecord.model` is that *"did the classifier save more
//      than it cost"* is unanswerable if its spend is folded into the turn's.
//      Recording them summed would undo that at the durable layer.
//   2. **No dollars, and never `Money`.** A live request costs **$0.0011**, and
//      `Money`'s integer minor units (ADR-008) round that to **zero** — every
//      request would store as free. This is the KI-1 / KI-14 /
//      `budgetPerPerson` defect class on its **third recorded recurrence**, so
//      there is no currency type anywhere in this file and no arithmetic that
//      multiplies a token by anything. Price is a join, performed downstream,
//      as at a point in time, against a dated append-only rate record.
//      `ledger.test.ts` asserts the absence rather than trusting it.
//   3. **Cost and capacity are two fields, never one.** M20's *"attribute
//      marginal cost only"*: model tokens are the per-account marginal cost;
//      LocationIQ is a **daily-capped free tier**, which is a capacity limit
//      rather than a per-call charge. The type keeps them apart so that nobody
//      has to remember not to sum them.
//   4. **Written on all three end paths, including failure**, *"because the
//      round-trips already made were already paid for"*. That is free rather
//      than new work: `createAskRecorder`'s single-writer latch already fires
//      exactly once per turn on `onEnd`, abort and error, so the ledger is a
//      fourth reader of that latch and not a fourth place that has to get
//      once-only right.
import type { TaskClass } from "./taskClass";

/** How a turn ended — M20 link 9's `outcome`, and `AskOutcome`'s three values. */
export type TurnOutcome = "completed" | "error" | "abort";

/** One model's contribution to a turn: an id and two token counts, nothing else. */
export interface ModelSpend {
  /**
   * The **RESOLVED** id of the model that actually ran, never a compiled
   * default. `config.ts:15` compiles `anthropic/claude-haiku-4-5` while
   * production sets `AI_MODEL` to `deepseek/deepseek-v4-flash-0731`, and M20
   * link 5 records the consequence: *"costing the compiled default instead of
   * the configured model overstates the bill by roughly an order of
   * magnitude, and this note exists because that mistake was made once already
   * while scoping this milestone."* Recording the resolved id is what makes
   * that mistake unavailable to any later analysis.
   */
  model: string;
  /** Null when the provider reported no usage — never zero, which is a measurement. */
  tokensIn: number | null;
  tokensOut: number | null;
}

/**
 * **The `ai_usage` row** (M20 link 9), one per AI request.
 *
 * No question text and no trip content: `askAnalytics` already logs the
 * question to the console deliberately, and a durable table is the wrong place
 * for it.
 */
export interface TurnCost {
  userId: string;
  endpoint: "ask" | "ask.apply";
  outcome: TurnOutcome;
  /** What this turn was for, and therefore which tier answered it. */
  taskClass: TaskClass;
  turn: ModelSpend;
  /**
   * The pre-turn classification's own round-trip — **separate from the turn's,
   * permanently** (rule 1 above).
   *
   * **Null means no model call was made**, which is the one reading that keeps
   * `billableRoundTrips` below structural: a bare affirmation ("Yes go ahead")
   * short-circuits the classifier without spending, and a page turn is not
   * classified at all. Neither has a round-trip to bill, and neither gets an
   * entry here. That replaces the `+1` the /ask sink used to add by hand.
   */
  classifier: ModelSpend | null;
  /** The agent's own round-trips. The classifier's is `classifier`, above. */
  steps: number;
  /**
   * Which plan version was in force (spec §7c-note).
   *
   * A purchase **pins** a version, so two accounts billing on the same day can
   * sit on different pinned versions and the row's date does not say which.
   * Reconstructing it from grant history afterwards is the kind of derivation
   * that goes wrong once and corrupts a series silently. Null until M20 has
   * versions to pin.
   */
  planVersionRef: string | null;
}

/**
 * A vendor **capacity** line — NOT a cost (rule 3 above).
 *
 * LocationIQ's free tier is 5,000 lookups a day, so a lookup consumes an
 * allowance rather than incurring a charge. This is what KI-93 settles against
 * `geocodeQuota()`, by the same post-hoc, never-refusing mechanism KI-67 built
 * for steps. The mid-batch policy question KI-93 raises is a product call and
 * is still not answered here; what this does is make the count available at the
 * one place that settles.
 *
 * **Empty on every /ask turn today**, and that is a measurement rather than a
 * gap: no tool declares `spend: "vendor"` (defineTool.ts), so there is no
 * vendor door inside a turn to count. When one arrives it is a tag on its
 * definition and a line here, with no new mechanism.
 */
export interface CapacityLine {
  vendor: "locationiq";
  calls: number;
}

/** One tool execution: what it was, how long it took, and whether it worked. */
export interface LedgerToolCall {
  name: string;
  ms: number;
  ok: boolean;
}

/**
 * What one turn cost, could have cost, and spent its time on.
 *
 * Three fields, three different questions, and **the type is what stops the
 * first two being added together**:
 *
 *   * `cost`     — billable. Model tokens, and only model tokens.
 *   * `capacity` — not billable. A daily-capped free tier's allowance.
 *   * `toolCalls`— neither. Efficiency: which tools earn their schema.
 *
 * There is no field here holding a total, and there is deliberately nothing to
 * compute one from: `cost` carries token counts against model ids and
 * `capacity` carries call counts against a vendor, and the two have no common
 * unit to sum in. A reader that wanted a single number would have to write the
 * join itself, downstream, against a dated rate record — which is exactly where
 * that decision belongs.
 */
export interface TurnLedger {
  cost: TurnCost;
  capacity: readonly CapacityLine[];
  toolCalls: readonly LedgerToolCall[];
}

/**
 * The round-trips a turn actually made, which is what `settleAiSteps` charges.
 *
 * **This is the only arithmetic in this file, and it is a count of calls rather
 * than a price.** It replaces the hand-written `record.steps + classifierSteps`
 * in the /ask sink, which had to warn in a comment that forgetting it
 * under-meters every classified turn by exactly one — the same shape as KI-67
 * itself, reintroduced inside the fix for it. Here the `+ 1` is not a term
 * anybody can forget: it is the presence of `cost.classifier`, which exists if
 * and only if a classification round-trip was made.
 *
 * `capacity` is not in this sum and never can be — a geocode lookup is not a
 * model round-trip, and the step ceiling is not the vendor's.
 */
export function billableRoundTrips(ledger: TurnLedger): number {
  return ledger.cost.steps + (ledger.cost.classifier === null ? 0 : 1);
}

/**
 * The per-turn collector for the two halves the recorder cannot observe.
 *
 * `createAskRecorder` sees the agent's steps, because the SDK hands it each
 * one. It cannot see how long an individual tool took or whether it threw —
 * those happen inside `execute`, one level down — and it cannot see a vendor
 * lookup at all. So the meter is minted by the turn, handed to `aiToolsFor`
 * (registry.ts) and read by the recorder at the latch.
 *
 * Deliberately total and non-throwing, for the same reason the recorder is:
 * this hangs off a streaming response that has already started reaching the
 * user, and a telemetry fault must never be the reason an answer stops
 * mid-sentence.
 */
export interface TurnMeter {
  /** One tool execution, recorded whether it returned or threw. */
  toolCall(name: string, ms: number, ok: boolean): void;
  /** One vendor lookup — capacity, never cost. */
  vendorCall(vendor: CapacityLine["vendor"], calls?: number): void;
  toolCalls(): readonly LedgerToolCall[];
  /** Collapsed to one line per vendor, so a reader never has to group. */
  capacity(): readonly CapacityLine[];
}

/**
 * One turn's meter. Never shared between turns.
 *
 * Vendor calls are summed as they arrive and read back as one `CapacityLine`
 * per vendor, so nothing downstream has to group them.
 */
export function newTurnMeter(): TurnMeter {
  const tools: LedgerToolCall[] = [];
  const vendors = new Map<CapacityLine["vendor"], number>();
  return {
    toolCall(name, ms, ok) {
      tools.push({ name, ms, ok });
    },
    vendorCall(vendor, calls = 1) {
      vendors.set(vendor, (vendors.get(vendor) ?? 0) + calls);
    },
    toolCalls: () => tools,
    capacity: () => [...vendors].map(([vendor, calls]) => ({ vendor, calls })),
  };
}

/** A meter for a turn nobody is measuring — the default, so a caller may omit one. */
export const NO_METER: TurnMeter = {
  toolCall: () => {},
  vendorCall: () => {},
  toolCalls: () => [],
  capacity: () => [],
};
