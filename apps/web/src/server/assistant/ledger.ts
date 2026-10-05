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
  /**
   * **The turn's own id, minted once on the server** (M31 Phase 1). It is the
   * `ai_usage` row's primary key and the parent key of every step and tool-call
   * row, so writing the same ledger twice leaves one turn rather than two — the
   * property a replayed durable step will need (ADR-062 §5). Null only for a
   * ledger nobody minted an id for, which `recordTurnLedger` then mints.
   */
  turnId: string | null;
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
  /** Wall-clock milliseconds from the request arriving to the latch firing. Null when nobody timed it. */
  latencyMs: number | null;
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

/**
 * How one tool call ended, from the ledger's point of view (ADR-062 §5).
 *
 *   * `ok`               — it ran and returned.
 *   * `failed`           — it threw, or its input was malformed past repair and
 *                          it never ran at all.
 *   * `repaired`         — its input was malformed, `repairToolInput` fixed it,
 *                          and it then ran. Counted with `failed` by the
 *                          failure rate: the model got it wrong.
 *   * `refused-by-grant` — the model called a tool this step did not hold. The
 *                          SDK refuses it before any code runs.
 *
 *   * `unfinished`       — it was still running when the turn ended (a user
 *                          leaving, the deadline, an error elsewhere). Not a
 *                          failure of the tool, so the failure rate leaves it
 *                          out; a tool with many is a tool users wait on.
 *
 * A tool that RETURNS a refusal value (escalate's "already escalated") is
 * `ok`: this describes execution, and refusal values are on the `ai.ask` line.
 */
export type ToolCallOutcome = "ok" | "failed" | "repaired" | "refused-by-grant" | "unfinished";

/** One tool call: what it was, how long it took, and whether it worked. */
export interface LedgerToolCall {
  /** The SDK's `toolCallId`. Null only from a caller that did not pass one. */
  callId: string | null;
  name: string;
  /** Null for a call that never executed (refused, or invalid past repair). */
  ms: number | null;
  /** Whether it executed and returned. Kept beside `outcome` for the existing metric. */
  ok: boolean;
  outcome: ToolCallOutcome;
  /** Which agent step emitted it, joined at the latch; null when no step reported it. */
  stepIndex: number | null;
  /** Sizes of its input and result as JSON, in bytes — never the content itself. */
  inputBytes: number | null;
  outputBytes: number | null;
  /**
   * Whether something this call collected reached the proposal the user saw.
   * Null for a tool that cannot propose (every read tool); false for a write
   * call on a turn that never produced a proposal.
   */
  reachedProposal: boolean | null;
}

/**
 * **One agent step's spend** — the per-step row (ADR-062 §5).
 *
 * A turn that escalates runs its later steps on a different model, and one
 * `turn.model` for the whole turn bills all of them at the first model's rate
 * (KI-2026-09-17-c). The step is the grain a price can be right at.
 */
export interface StepSpend {
  /** 0-based, in the order the agent ran them. */
  index: number;
  /** The RESOLVED id of the model this step ran on, as `prepareStep` chose it. */
  model: string;
  tier: string | null;
  /** Null means unreported, never zero — the `ModelSpend` rule. */
  tokensIn: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  tokensOut: number | null;
  finishReason: string | null;
  /** This step ran on the escalation model. */
  escalated: boolean;
  /** This step ran on a page pivot's model (ADR-058). */
  pivoted: boolean;
  /**
   * Wall-clock milliseconds from the previous step's end (step 0: from the
   * agent starting, after admission and the classifier) to this step's end,
   * its tool calls included (M32). Model time is this less the step's tool
   * durations. Null when nobody timed it. Added because a 162-second turn
   * (2026-10-04) had three steps and no way to say which was slow.
   */
  durationMs: number | null;
  /**
   * The provider that served this step, as AI Gateway reports it
   * (`providerMetadata.gateway.routing.finalProvider`, e.g. `"zai"`,
   * `"deepinfra"`). The Gateway sells one model through many providers at
   * different prices, so `model` alone does not say what a step was billed at.
   * Null off the Gateway (the simulated model) or when it did not say.
   */
  provider: string | null;
  /**
   * AI Gateway's id for this generation (`gen_…`). Not a price: the billed
   * cost is looked up from the Gateway by this id, never stored here (rule 2).
   */
  gatewayGenerationId: string | null;
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
  /** One entry per agent step the recorder observed, in order. */
  stepSpend: readonly StepSpend[];
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
/** What `measured()` knows about one execution beyond its name and timing. */
export interface ToolCallDetail {
  callId?: string | null;
  inputBytes?: number | null;
  outputBytes?: number | null;
  /** The tool collects into the proposal buffer, so `reachedProposal` applies to it. */
  proposes?: boolean;
}

/** What the SDK's repair hook saw about a call before it could run. */
export type ToolCallIssue = "repaired" | "refused-by-grant" | "invalid";

export interface TurnMeter {
  /**
   * A call has started executing. Recorded so that a call still running when
   * the turn is abandoned — the latch fires at once on abort, while the call
   * is mid-await — still has a row (Copilot on #301).
   */
  callStarted(callId: string, name: string, proposes?: boolean): void;
  /** One tool execution, recorded whether it returned or threw. */
  toolCall(name: string, ms: number, ok: boolean, detail?: ToolCallDetail): void;
  /**
   * The repair hook's verdict on a call, keyed by `callId`. A `repaired` call
   * then executes and its outcome becomes `repaired`; a `refused-by-grant` or
   * `invalid` one never executes, so it is reported here or not at all.
   */
  callIssue(callId: string, name: string, issue: ToolCallIssue, proposes?: boolean): void;
  /** One vendor lookup — capacity, never cost. */
  vendorCall(vendor: CapacityLine["vendor"], calls?: number): void;
  /**
   * A COPY of what this turn has recorded so far — the array AND each record
   * in it, never the live ones —
   * the same guarantee `ProposalBuffer.collected()` (deps.ts) states and
   * preserves: a caller that mutates what it reads must not be able to
   * rewrite what the turn collected.
   *
   * Executed calls first, in order, then calls that never executed. Nothing
   * here is joined to steps or to the proposal; the recorder does that at the
   * latch, because only it knows both.
   */
  toolCalls(): readonly LedgerToolCall[];
  /** Whether a call collected into the proposal buffer, by `callId`. */
  proposes(callId: string): boolean;
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
  const proposing = new Set<string>();
  const issues = new Map<string, { name: string; issue: ToolCallIssue }>();
  const running = new Map<string, string>();
  const vendors = new Map<CapacityLine["vendor"], number>();
  return {
    callStarted(callId, name, proposes = false) {
      running.set(callId, name);
      if (proposes) proposing.add(callId);
    },
    toolCall(name, ms, ok, detail = {}) {
      const callId = detail.callId ?? null;
      if (callId !== null) running.delete(callId);
      const repaired = callId !== null && issues.get(callId)?.issue === "repaired";
      if (callId !== null && detail.proposes === true) proposing.add(callId);
      tools.push({
        callId,
        name,
        ms,
        ok,
        outcome: !ok ? "failed" : repaired ? "repaired" : "ok",
        stepIndex: null,
        inputBytes: detail.inputBytes ?? null,
        outputBytes: detail.outputBytes ?? null,
        reachedProposal: null,
      });
    },
    callIssue(callId, name, issue, proposes = false) {
      issues.set(callId, { name, issue });
      // A refused or invalid WRITE call is still a write call: its reach is
      // `false`, never the `null` that means "cannot propose".
      if (proposes) proposing.add(callId);
    },
    vendorCall(vendor, calls = 1) {
      vendors.set(vendor, (vendors.get(vendor) ?? 0) + calls);
    },
    toolCalls: () => {
      const executed = new Set(tools.map((tool) => tool.callId));
      // Every call the repair hook saw that never executed and is not still
      // running — a `repaired` one included: repair can fix the JSON and the
      // re-parse can still reject it, and that call never ran either.
      const neverRan: LedgerToolCall[] = [...issues]
        .filter(([callId]) => !executed.has(callId) && !running.has(callId))
        .map(([callId, entry]) => ({
          callId,
          name: entry.name,
          ms: null,
          ok: false,
          outcome: entry.issue === "refused-by-grant" ? "refused-by-grant" : "failed",
          stepIndex: null,
          inputBytes: null,
          outputBytes: null,
          reachedProposal: null,
        }));
      // Started and not finished: the turn ended around it. No duration to
      // report, and not the tool's failure — `unfinished` (see its outcome).
      const unfinished: LedgerToolCall[] = [...running].map(([callId, name]) => ({
        callId,
        name,
        ms: null,
        ok: false,
        outcome: "unfinished",
        stepIndex: null,
        inputBytes: null,
        outputBytes: null,
        reachedProposal: null,
      }));
      return [...tools.map((tool) => ({ ...tool })), ...neverRan, ...unfinished];
    },
    proposes: (callId) => proposing.has(callId),
    capacity: () => [...vendors].map(([vendor, calls]) => ({ vendor, calls })),
  };
}

/** A meter for a turn nobody is measuring — the default, so a caller may omit one. */
export const NO_METER: TurnMeter = {
  callStarted: () => {},
  toolCall: () => {},
  callIssue: () => {},
  vendorCall: () => {},
  toolCalls: () => [],
  proposes: () => false,
  capacity: () => [],
};
