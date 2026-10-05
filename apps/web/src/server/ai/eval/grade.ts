// **What the eval checks, as pure functions** (M33). The runner
// (`live.eval.ts`) collects one turn's record, answer text and proposal; this
// file decides whether the turn met its prompt's expectations. Nothing here
// calls a model, a database or a clock, so every check is unit-tested against
// hand-built turns (`grade.test.ts`) and seen red there, not discovered wrong
// on a paid run.
//
// **Checks are about behaviour we can state, never about wording.** Which tools
// were called and how often, whether a change proposed anything, whether the
// turn finished, how long it took and what it spent, and, where the trip
// determines a fact (which day is most free), whether the answer names it. A
// model's prose is not reproducible; asserting it would make the eval fail on
// a rephrase and teach everyone to ignore it.
import type { AskAnalyticsRecord } from "@/server/assistant/askAnalytics";

/** One turn, as the runner observed it. */
export interface EvalTurn {
  record: AskAnalyticsRecord;
  /** The assistant's answer: the stream's text, concatenated. */
  text: string;
  /** Commands in the proposal the turn ended with; empty when it proposed nothing. */
  proposalCommands: number;
}

/** What one prompt expects. Every field is optional; an absent field is not checked. */
export interface EvalExpectation {
  /** The turn ends `completed` with an answer. Default true. */
  completes?: boolean;
  maxToolCalls?: number;
  /** A ceiling per tool name, e.g. `{ find_free_time: 1 }`. */
  maxCallsOf?: Record<string, number>;
  mustCall?: readonly string[];
  mustNotCall?: readonly string[];
  /** A change prompt proposes at least one command; a question proposes none. */
  proposes?: boolean;
  maxLatencyMs?: number;
  /** Agent input tokens across the turn, classifier excluded. */
  maxInputTokens?: number;
  /**
   * The answer names one of these days ("day 7", "Day 7"). Computed from the
   * seeded trip by the runner, never typed in: a list, because days that tie
   * are equally right answers.
   */
  namesOneOfDays?: readonly number[];
  /** The answer names one of these minor-unit amounts. Computed from the seeded trip, like the days. */
  namesOneOfAmounts?: readonly number[];
}

export interface EvalCheck {
  name: string;
  pass: boolean;
  /** What was observed, for the report. */
  detail: string;
}

function countCalls(record: AskAnalyticsRecord): Map<string, number> {
  const counts = new Map<string, number>();
  for (const call of record.toolCalls) counts.set(call.name, (counts.get(call.name) ?? 0) + 1);
  return counts;
}

/** "day 7" as a word, so "day 17" does not pass for day 1 and "today 7" does not pass at all. */
export function namesDayNumber(text: string, day: number): boolean {
  return new RegExp(`\\bday\\s+${day}\\b`, "i").test(text);
}

/**
 * A minor-unit amount, as any number in the text: "$990", "990.00 USD" and
 * "$1,980" all name theirs. Every currency the app offers is two-decimal
 * (`formatMoney`), so the major unit is `/ 100`. The symbol is not checked —
 * the trip has one currency, and the number is what a wrong headcount moves.
 */
export function namesAmount(text: string, amountMinor: number): boolean {
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).some(
    (number) => Math.round(Number(number.replaceAll(",", "")) * 100) === amountMinor,
  );
}

/**
 * Every check one prompt's expectation asks for, run against one turn. Returns
 * one entry per check, passed or not, in a fixed order, so a report reads the
 * same from run to run; an expectation field left out adds no check.
 */
export function grade(turn: EvalTurn, expect: EvalExpectation): EvalCheck[] {
  const { record } = turn;
  const checks: EvalCheck[] = [];
  const counts = countCalls(record);
  const trace = record.toolCalls.map((call) => call.name).join(", ") || "none";

  if (expect.completes ?? true) {
    checks.push({
      name: "completes",
      pass: record.outcome === "completed" && record.answered,
      detail: `outcome ${record.outcome}, answered ${record.answered}${record.cause ? `, ${record.cause.name}: ${record.cause.message}` : ""}`,
    });
  }
  if (expect.maxToolCalls !== undefined) {
    checks.push({
      name: `≤ ${expect.maxToolCalls} tool calls`,
      pass: record.toolCalls.length <= expect.maxToolCalls,
      detail: `${record.toolCalls.length}: ${trace}`,
    });
  }
  for (const [tool, max] of Object.entries(expect.maxCallsOf ?? {})) {
    const n = counts.get(tool) ?? 0;
    checks.push({ name: `≤ ${max} × ${tool}`, pass: n <= max, detail: `${n}` });
  }
  for (const tool of expect.mustCall ?? []) {
    checks.push({ name: `calls ${tool}`, pass: counts.has(tool), detail: trace });
  }
  for (const tool of expect.mustNotCall ?? []) {
    checks.push({ name: `never calls ${tool}`, pass: !counts.has(tool), detail: trace });
  }
  if (expect.proposes !== undefined) {
    checks.push({
      name: expect.proposes ? "proposes a change" : "proposes nothing",
      pass: expect.proposes ? turn.proposalCommands > 0 : turn.proposalCommands === 0,
      detail: `${turn.proposalCommands} command${turn.proposalCommands === 1 ? "" : "s"}`,
    });
  }
  if (expect.maxLatencyMs !== undefined) {
    checks.push({
      name: `≤ ${expect.maxLatencyMs / 1000}s`,
      pass: record.latencyMs <= expect.maxLatencyMs,
      detail: `${(record.latencyMs / 1000).toFixed(1)}s`,
    });
  }
  if (expect.maxInputTokens !== undefined) {
    const tokens = record.usage.inputTokens;
    checks.push({
      name: `≤ ${expect.maxInputTokens} input tokens`,
      pass: tokens !== null && tokens <= expect.maxInputTokens,
      detail: tokens === null ? "unreported" : `${tokens}`,
    });
  }
  if (expect.namesOneOfDays !== undefined) {
    checks.push({
      name: `names day ${expect.namesOneOfDays.join(" or ")}`,
      pass: expect.namesOneOfDays.some((day) => namesDayNumber(turn.text, day)),
      detail: turn.text.length > 160 ? `${turn.text.slice(0, 157)}…` : turn.text,
    });
  }
  if (expect.namesOneOfAmounts !== undefined) {
    checks.push({
      name: `names ${expect.namesOneOfAmounts.map((amount) => (amount / 100).toFixed(2)).join(" or ")}`,
      pass: expect.namesOneOfAmounts.some((amount) => namesAmount(turn.text, amount)),
      detail: turn.text.length > 160 ? `${turn.text.slice(0, 157)}…` : turn.text,
    });
  }
  return checks;
}
