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
import { RETRACT_CHUNK } from "@/server/ai/finalStepText";

/** One turn, as the runner observed it. */
export interface EvalTurn {
  record: AskAnalyticsRecord;
  /** The assistant's answer: the text left on screen once retractions applied (`visibleText`). */
  text: string;
  /**
   * Changes the turn put up for review, wherever they went: the card's
   * commands, or the stored suggestion's change count for a turn ADR-067 put
   * on the board. 0 when it proposed nothing. See `reviewedChanges`.
   */
  proposalCommands: number;
  /** The stream left text on screen ahead of a tool call (`textBeforeToolCall`). */
  textBeforeToolCall: boolean;
  /**
   * Text that streamed and was taken back (`retractedText`). Reported, never
   * failed: Mitchell accepted the flicker on 2026-10-12, and this is the
   * number a holistic fix moves (KI-20261012-h).
   */
  retracted: { parts: number; chars: number };
}

/**
 * How many changes a turn's final chunk put up for review: a card's commands,
 * or a stored suggestion's `changeCount` (ADR-067 — a multi-change turn is a
 * suggestion on the board, not a card, and is no less a proposal for that).
 * Read from the stream's chunks so the runner and this file agree on it.
 */
export function reviewedChanges(chunks: readonly Record<string, unknown>[]): number {
  for (const chunk of chunks) {
    const meta = (chunk as { messageMetadata?: { proposal?: { commands?: unknown[] }; suggested?: { changeCount?: number } } })
      .messageMetadata;
    if (meta?.proposal !== undefined) return meta.proposal.commands?.length ?? 0;
    if (meta?.suggested !== undefined) return meta.suggested.changeCount ?? 0;
  }
  return 0;
}

interface TextPart {
  text: string;
  retracted: boolean;
  /** A tool call followed it in the stream. */
  beforeToolCall: boolean;
}

/**
 * The stream's text parts, in order, as the client sees them: a `data-retract`
 * chunk (`finalStepText.ts`) takes back the parts it names. Read in order
 * because a provider numbers text blocks per step, so a later step can reuse
 * an id; the retraction means the latest part by that id.
 */
function textParts(chunks: readonly Record<string, unknown>[]): TextPart[] {
  const parts: (TextPart & { id: unknown })[] = [];
  const latest = (id: unknown) => {
    for (let i = parts.length - 1; i >= 0; i -= 1) if (parts[i]!.id === id && !parts[i]!.retracted) return parts[i];
    return undefined;
  };
  for (const chunk of chunks) {
    if (chunk.type === "text-start") parts.push({ id: chunk.id, text: "", retracted: false, beforeToolCall: false });
    else if (chunk.type === "text-delta") {
      const part = latest(chunk.id) ?? parts[parts.push({ id: chunk.id, text: "", retracted: false, beforeToolCall: false }) - 1]!;
      part.text += String(chunk.delta);
    } else if (chunk.type === RETRACT_CHUNK) {
      for (const id of (chunk.data as { ids?: unknown[] } | undefined)?.ids ?? []) {
        const part = latest(id);
        if (part) part.retracted = true;
      }
    } else if (chunk.type === "tool-input-start" || chunk.type === "tool-input-available") {
      for (const part of parts) part.beforeToolCall = true;
    }
  }
  return parts;
}

/** The reply as the person reads it: every text part not taken back, joined. */
export function visibleText(chunks: readonly Record<string, unknown>[]): string {
  return textParts(chunks)
    .filter((part) => !part.retracted)
    .map((part) => part.text)
    .join("");
}

/**
 * Whether text left on screen came ahead of a tool call: a model's note to
 * itself between reads, which the server is meant to take back
 * (KI-20261012-e, `finalStepText.ts`). Structural, not a phrase list. Any
 * call, not the first: a note is usually written once a read has returned,
 * beside the second call.
 */
export function textBeforeToolCall(chunks: readonly Record<string, unknown>[]): boolean {
  return textParts(chunks).some((part) => !part.retracted && part.beforeToolCall && part.text !== "");
}

/** How much text streamed and was taken back: the flicker, counted. */
export function retractedText(chunks: readonly Record<string, unknown>[]): { parts: number; chars: number } {
  const gone = textParts(chunks).filter((part) => part.retracted && part.text.trim() !== "");
  return { parts: gone.length, chars: gone.reduce((n, part) => n + part.text.length, 0) };
}

/**
 * Two steps' text run together: a sentence end with the next sentence's
 * capital straight after it ("in Shibuya.I'd add"), which is what a leaked
 * step looks like once the client joins every text chunk. A backstop read
 * from the text alone. Two letters before the stop, so an abbreviation
 * ("e.g.Kyoto", "7 a.m.Breakfast") is not one.
 */
const STEP_SEAM = /[a-z]{2}[.!?][A-Z]/;

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
  /**
   * The off-topic gate (2026-10-10): `true` — the classifier refused the turn
   * as unrelated to the trip or travel; `false` — it did NOT, which is what a
   * borderline travel question ("do I need a visa?") must get.
   */
  offTopic?: boolean;
  /** Text the answer must not contain — a line of the system instruction, for an extraction attempt. */
  mustNotSay?: readonly string[];
  /**
   * The answer names one of these, in any case — a fact the seeded trips
   * determine that is neither a day nor an amount (the city visited most, M45).
   * Computed from the trips by the runner, like the days.
   */
  mentionsOneOf?: readonly string[];
  /**
   * The answer names one of these as a whole word, in any case: a place name,
   * where a substring would let "romantic" name Oman and "scuba" Cuba.
   */
  namesOneOf?: readonly string[];
}

export interface EvalCheck {
  name: string;
  pass: boolean;
  /** What was observed, for the report. */
  detail: string;
}

/** `name` in `text`, in any case, with no letter on either side of it. */
function namesWholeWord(text: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<!\\p{L})${escaped}(?!\\p{L})`, "iu").test(text);
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
  const seam = turn.text.match(STEP_SEAM);
  checks.push({
    name: "no text before a tool call",
    pass: !turn.textBeforeToolCall && seam === null,
    detail: turn.textBeforeToolCall ? "text left on screen before a tool call" : seam !== null ? `step seam "${seam[0]}"` : "none",
  });
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
  if (expect.offTopic !== undefined) {
    const refused = record.classification?.offTopic === true;
    checks.push({
      name: expect.offTopic ? "refused as off-topic" : "not refused as off-topic",
      pass: refused === expect.offTopic,
      detail: `classification: ${record.classification?.verdict ?? "none"}`,
    });
    // A refusal saves money only by never running the agent.
    if (expect.offTopic) {
      checks.push({ name: "ran no agent step", pass: record.steps === 0, detail: `${record.steps} steps` });
    }
  }
  for (const phrase of expect.mustNotSay ?? []) {
    checks.push({
      name: `does not say "${phrase}"`,
      pass: !turn.text.includes(phrase),
      detail: turn.text.length > 160 ? `${turn.text.slice(0, 157)}…` : turn.text,
    });
  }
  if (expect.mentionsOneOf !== undefined) {
    const said = turn.text.toLowerCase();
    checks.push({
      name: `mentions ${expect.mentionsOneOf.map((phrase) => `"${phrase}"`).join(" or ")}`,
      pass: expect.mentionsOneOf.some((phrase) => said.includes(phrase.toLowerCase())),
      detail: turn.text.length > 160 ? `${turn.text.slice(0, 157)}…` : turn.text,
    });
  }
  if (expect.namesOneOf !== undefined) {
    checks.push({
      name: `names ${expect.namesOneOf.length > 6 ? `one of ${expect.namesOneOf.length} places` : expect.namesOneOf.map((name) => `"${name}"`).join(" or ")}`,
      pass: expect.namesOneOf.some((name) => namesWholeWord(turn.text, name)),
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
