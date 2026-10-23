// The "AI is switched off" model (see docs/specs/2026-08-19-feature-flags-and-
// ai-kill-switch-design.md). It is a real LanguageModelV4 that contacts
// nothing: the agent loop calls it, gets canned tool calls back, and the rest of
// /ask proceeds exactly as it would for a real model. That is the point — a
// shared deployment stays exercisable at zero token cost, and `ai-live` is off
// in EVERY Vercel environment today, so this file is what the deployed
// assistant actually is.
//
// It has one surface, because /ask is the one AI route (ADR-033). Everything
// here is a shape of one ask turn, and there is no canned-sentence branch left:
// /ask has no server-derived answer to fall back on the way an applied batch's
// `summarizeBatch` receipt did, so whatever this model says IS the answer. It
// runs the real agent loop — calls the real tools, waits for their real
// results, and writes its prose from them. A trip with no free time left says
// so.
//
// Four shapes, in the order `askTurn` decides them:
//
//   * the pre-turn intent classification (`classifyStep`),
//   * PAGE authoring — one `insert_text`, then a sentence; or, for a request
//     to ADD something, `search_widgets` → `insert_widget` with the top match
//     → a sentence (ADR-057). It moved here from
//     the command endpoint with ADR-033 Decision 4, and it is the branch with
//     the least slack: without it no deployed environment can author a Notebook
//     page at all.
//   * a PROPOSAL (M9) — read, then propose, then say what it WOULD do. It never
//     claims to have applied anything, because nothing has: the write tools
//     collect and the human approves (writeTools.ts).
//   * an ANSWER — read, then speak.
//
// Hand-rolled rather than `MockLanguageModelV4` from `ai/test`, so no test
// utility ships in the server bundle. Typed as `LanguageModel` (from `ai`, a
// direct dependency) rather than `LanguageModelV4` (from `@ai-sdk/provider`,
// which is not) — structural typing checks the literal either way. The prompt
// and stream-part shapes below are structural for the same reason.
import { randomUUID } from "node:crypto";
import type { LanguageModel } from "ai";
import type { ActivityTag } from "@tc/contracts";
import { formatMoney } from "@/lib/formatMoney";
import { needsBooking } from "@/lib/needsBooking";
import { parseAskScope, type AskScope } from "@/server/assistant/context";
import { askIntentVerdictText, isAskIntentCall, isPageIntentCall } from "@/server/ai/askIntent";
import type {
  DayReadout,
  FreeTimeReadout,
  PlaybookSearchReadout,
  ReadToolProblem,
  TripReadout,
} from "@/server/assistant/tools/read";
import type {
  PlacesVisitedReadout,
  SpendByCategoryReadout,
  SuggestNextCountryReadout,
  VisitCountsReadout,
} from "@/server/assistant/tools/acrossTrips";
import { INSERT_PLAYBOOK_DAY } from "@/server/ai/writeTools";
import { plain } from "@/server/assistant/prompt";
import { ASSISTANT_TOOLS } from "@/server/assistant/registry";
import { GO_TO_TOOL_NAME, OPEN_TRIP_TOOL_NAME, PROPOSE_NOTEBOOK_EDITING_TOOL_NAME } from "@/server/assistant/tools/navigate";
import { READ_CHAT_TOOL_NAME } from "@/server/assistant/tools/chat";
import { FIND_PLACES_NEAR_NOW_TOOL_NAME, type PlaceSearchReadout } from "@/server/assistant/tools/places";
import {
  ADD_PLAYBOOK_TO_TRIP_TOOL_NAME,
  READ_PLAYBOOK_TOOL_NAME,
  SEARCH_THIS_PAGE_TOOL_NAME,
  START_TRIP_WITH_PLAYBOOK_TOOL_NAME,
  type PlaybookReadout,
} from "@/server/assistant/tools/playbook";
import { TAG_LABEL, type WidgetMatch } from "@tc/pages";

export const SIMULATED_MODEL_ID = "simulated/no-op";

// Zero, honestly: nothing was spent. Shape matches AI SDK v7's
// LanguageModelV4Usage (nested objects, not v4's flat promptTokens pair).
const NO_USAGE = {
  inputTokens: { total: 0, noCache: 0, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 0, text: undefined, reasoning: undefined },
};

type ToolCall = { type: "tool-call"; toolCallId: string; toolName: string; input: string };
type TextContent = { type: "text"; text: string };
type Content = ToolCall | TextContent;
type FinishReason = { unified: "stop" | "tool-calls"; raw: undefined };

// One step's output. `textDeltas` is the SAME text as the single text part in
// `content`, cut into the chunks `doStream` emits — so the answer arrives
// sentence by sentence while still being one message part. Splitting it into
// several parts instead would leave a client that concatenates them (and every
// client does, somewhere) reading "5 stops.They are:".
interface SimulatedStep {
  content: Content[];
  finishReason: FinishReason;
  textDeltas?: string[];
}

// `input` is a JSON STRING, not an object — LanguageModelV4ToolCall's contract.
function call(toolName: string, input: Record<string, unknown>): ToolCall {
  return { type: "tool-call", toolCallId: randomUUID(), toolName, input: JSON.stringify(input) };
}

// Prose only — no `insert_widget`, so this stays decoupled from the @tc/pages
// macro registry and validates unconditionally.
//
// What it inserts is real: it lands in the editor and the Notebook's debounced
// autosave persists it like any other edit. Only its authorship is not a model,
// and it says so in its own body rather than leaving the reader to infer it
// from the Simulated badge alone.
//
// One markdown string where there used to be a title and a block list, because
// `insert_text` takes markdown (ADR-035 decision 5). The `##` line exercises the
// heading branch of `markdownToPageNodes`, so the simulated path covers the same
// reader the live path uses rather than a straighter one.
function pageCalls(): ToolCall[] {
  return [
    call("insert_text", {
      markdown: [
        "## This section is simulated",
        "",
        "AI is switched off on this deployment, so this text was written by the server rather than by a model. Everything else about it is real — it saves, versions, and edits like any other page content.",
      ].join("\n"),
    }),
  ];
}

// ---------------------------------------------------------------------------
// The ask turn
// ---------------------------------------------------------------------------

// The slice of LanguageModelV4CallOptions this model reads. Everything else
// (tools, temperature, provider options) is genuinely irrelevant to a model
// that contacts nothing.
interface CallOptionsLike {
  prompt?: readonly {
    role?: string;
    content?: unknown;
  }[];
  // The tool set the harness handed this call. Read for exactly one decision:
  // whether write tools are on the table this turn (M9). Structural, like
  // everything else this model reads — LanguageModelV4CallOptions lives in a
  // package apps/web does not depend on.
  tools?: readonly { name?: string }[];
}

interface ToolResultLike {
  toolName: string;
  output: unknown;
}

/**
 * The system instruction, which is where the turn's scope is encoded
 * (`askScopeLine` in context.ts). Joined rather than "first match" because
 * `allowSystemInMessages` can put more than one system message in a prompt.
 */
function systemTextOf(options: CallOptionsLike): string {
  return (options.prompt ?? [])
    .filter((m) => m.role === "system" && typeof m.content === "string")
    .map((m) => m.content as string)
    .join("\n");
}

/**
 * The tool results for THIS TURN — everything after the newest user message.
 *
 * State lives in the conversation rather than in a counter on the instance,
 * because streamText re-calls `doStream` once per step with the accumulated
 * prompt; reading it is correct across retries, where a counter is not.
 *
 * The window matters as much as the reading. Conversation state is client-held
 * (plan Ruling R1), so turn 2 arrives carrying turn 1's assistant message —
 * tool parts included — and `convertToModelMessages` turns those back into
 * tool-result messages. Scanning the WHOLE prompt therefore made every turn
 * after the first answer immediately from the PREVIOUS turn's readouts: no
 * tool call at all, the wrong day after a scope change, stale numbers after an
 * edit. Slicing at the last user message is what makes "have I asked my
 * questions about the question I was just asked?" the actual question.
 *
 * Deliberately not "trust the client to drop tool parts": Task 5 writes that
 * client, and a server whose correctness depends on what a client chooses to
 * resend has no correctness at all.
 */
function toolResultsOf(options: CallOptionsLike): ToolResultLike[] {
  const prompt = options.prompt ?? [];
  // `findLastIndex` over roles, written as a loop so this file keeps no
  // assumptions about the target's lib level. -1 (no user message at all)
  // starts the scan at 0, which is the same "nothing asked yet" answer.
  let turnStart = 0;
  for (let i = prompt.length - 1; i >= 0; i--) {
    if (prompt[i]!.role === "user") {
      turnStart = i + 1;
      break;
    }
  }

  const results: ToolResultLike[] = [];
  for (const message of prompt.slice(turnStart)) {
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content as { type?: string; toolName?: string; output?: unknown }[]) {
      if (part.type !== "tool-result" || typeof part.toolName !== "string") continue;
      results.push({ toolName: part.toolName, output: unwrapToolOutput(part.output) });
    }
  }
  return results;
}

// A tool result's `output` is `{ type: 'json' | 'text', value }`. Both shapes
// are handled because which one appears depends on the tool's `toModelOutput`,
// which is a decision readTools.ts is free to change later.
function unwrapToolOutput(output: unknown): unknown {
  if (typeof output !== "object" || output === null) return output;
  const wrapper = output as { type?: string; value?: unknown };
  if (wrapper.type === "json") return wrapper.value;
  if (wrapper.type === "text" && typeof wrapper.value === "string") {
    try {
      return JSON.parse(wrapper.value);
    } catch {
      return wrapper.value;
    }
  }
  return output;
}

// Keyed by name from the same registry the real path builds its tool set
// from (registry.ts), so a tool's `output` schema is read once here rather
// than re-declared. `ASSISTANT_TOOLS` never changes at runtime, so building
// this once at module load costs nothing per call.
const OUTPUT_SCHEMA_BY_TOOL_NAME = new Map(ASSISTANT_TOOLS.map((tool) => [tool.name, tool.output]));

/**
 * A prior tool result, `safeParse`d against the SAME `output` schema
 * `defineTool`'s `invoke` already required of the real path (KI-9) — not cast.
 *
 * The message history this reads is untyped: it is JSON that came back over
 * the wire, round-tripped through a client that is free to resend a stale
 * turn (see `toolResultsOf`), and — before this fix — a plain cast over it, so
 * a readout missing a field the caller expects surfaced as a runtime throw
 * three call frames away (`askAnswer`'s `trip.conflicts.length`) rather than
 * here, at the one place that actually knows the tool's contract.
 *
 * A shape that fails to parse is treated as "this tool has no result yet" —
 * `undefined` — which is the same graceful-degradation path every caller
 * already has for a tool the model has not called at all. That is weaker than
 * throwing, but throwing here would just move the crash from three frames
 * away to one frame away; the honest fallback ("I couldn't read anything
 * about this trip") is what every other missing-tool-result path already
 * does, and a shape mismatch is not distinguishable from "not called" from
 * where `resultFor` sits.
 */
function resultFor<T>(results: readonly ToolResultLike[], toolName: string): T | undefined {
  const found = results.find((r) => r.toolName === toolName);
  if (found === undefined) return undefined;
  const schema = OUTPUT_SCHEMA_BY_TOOL_NAME.get(toolName);
  // No registered schema (a tool name the registry does not know) is not this
  // function's problem to diagnose — fall back to the pre-existing cast so
  // that case behaves exactly as it always has.
  if (schema === undefined) return found.output as T | undefined;
  const parsed = schema.safeParse(found.output);
  return parsed.success ? (parsed.data as T) : undefined;
}

// The hours a free-time answer is actually about. Since M32 they are the
// tool's own default (`DAYTIME_*` in `@tc/domain`); they are still passed here
// so the simulated path exercises `find_free_time`'s after/before translation
// rather than calling it bare.
const WAKING_HOURS = { after: "08:00", before: "22:00" };

/**
 * Step 1 of an ask turn: the questions.
 *
 * `read_trip` always — every answer wants the trip's name and shape.
 * `read_day` only when the turn is scoped to a day, which is the one thing the
 * instruction's scope line exists to tell this model.
 * `find_free_time` always. It defaults to the turn's scope — the whole trip for
 * a trip-scoped turn, that day for a day-scoped one — so no day number is
 * passed; it is the question ADR-022 was written about, so the switched-off
 * deployment should be able to answer it.
 */
function askQuestions(scope: AskScope, options: CallOptionsLike): ToolCall[] {
  const calls = [call("read_trip", {})];
  if (scope.kind === "day") calls.push(call("read_day", { days: scope.dayIndex + 1 }));
  // Only when it was handed over: a viewer's turn holds `read_trip` and
  // `read_day` alone (ADR-058 decision 9), and calling a tool the turn was
  // not offered ends it with `NoSuchToolError`.
  if (offered(options, "find_free_time")) calls.push(call("find_free_time", { ...WAKING_HOURS }));
  // A turn the trip chat started (M52): what was said before the ask is read
  // with the trip, as a model asked to "fix this" has to.
  if (offered(options, READ_CHAT_TOOL_NAME)) calls.push(call(READ_CHAT_TOOL_NAME, {}));
  // An under-way trip (M52 decision 13): "near here" is the plan's here, which
  // only the near-now search knows, and it is offered only then.
  const question = latestUserText(options);
  if (offered(options, FIND_PLACES_NEAR_NOW_TOOL_NAME) && NEARBY.test(question)) {
    calls.push(call(FIND_PLACES_NEAR_NOW_TOOL_NAME, { queries: [question.replace(new RegExp(NEARBY, "gi"), "").replace(FIND_WORDS, "").trim() || "places"] }));
  }
  return calls;
}

const NEARBY = /\b(?:near (?:here|us|me|by)|nearby|around (?:here|us)|close by)\b/i;
const FIND_WORDS = /\b(?:find|me|some|is there|are there|any)\b|\?/gi;

/** Whether the harness handed this call a tool of that name. */
function offered(options: CallOptionsLike, name: string): boolean {
  return (options.tools ?? []).some((tool) => tool?.name === name);
}

const SIMULATED_ASK_NOTICE =
  "AI is switched off on this deployment, so I answered from your trip data rather than from a model.";

// A noun phrase, and only that — the caller owns any verb that has to agree
// with it. Stated because forgetting is exactly what happened: `toBookSentences`
// read "1 stop still need booking" until the re-review caught it, while the
// sentence two lines below had inflected its verb correctly all along.
function pluralStops(n: number): string {
  return `${n} stop${n === 1 ? "" : "s"}`;
}

// How many days to name before an answer stops being a sentence. Same "first
// three, then a count" shape the retired command endpoint's `locationNotice`
// used — a
// 14-day trip should not produce a fourteen-clause list.
const MAX_NAMED_DAYS = 3;

/**
 * The trip-wide booking answer, from `read_trip`'s per-day `toBook` counts.
 *
 * Empty when nothing is outstanding, rather than a cheerful "all booked!" on
 * every unrelated question — and the rail only offers the booking chip when
 * something IS outstanding, so the chip is never left unanswered by the silence.
 */
function toBookSentences(trip: TripReadout): string[] {
  const days = trip.days.filter((day) => day.toBook > 0);
  if (days.length === 0) return [];
  const total = days.reduce((sum, day) => sum + day.toBook, 0);
  const shown = days
    .slice(0, MAX_NAMED_DAYS)
    .map((day) => `day ${day.day} (${day.toBook})`)
    .join(", ");
  const rest = days.length - Math.min(MAX_NAMED_DAYS, days.length);
  const tail = rest > 0 ? `, and ${rest} more day${rest === 1 ? "" : "s"}` : "";
  return [`${pluralStops(total)} still ${total === 1 ? "needs" : "need"} booking: ${shown}${tail}.`];
}

/**
 * Step 2: the answer, written from what the tools actually returned.
 *
 * Sentence-per-fact, and every fact traceable to one tool result — which is
 * what makes this assertable in an e2e spec and what stops it drifting into a
 * canned paragraph that would survive the tools returning nothing.
 *
 * A day-scoped answer names no day but its own. M16's gate asserts that, and
 * it holds here because the only day numbers in scope are the one `read_day`
 * was asked for and the ones `find_free_time` returned — which, for a
 * day-scoped turn, is the same day.
 */
function askAnswer(scope: AskScope, results: readonly ToolResultLike[]): string[] {
  const trip = resultFor<TripReadout>(results, "read_trip");
  const day = resultFor<DayReadout | ReadToolProblem>(results, "read_day");
  const free = resultFor<FreeTimeReadout | ReadToolProblem>(results, "find_free_time");
  const sentences: string[] = [];

  const dayScoped = scope.kind === "day";

  if (dayScoped && day && !("error" in day)) {
    const dated = day.date ? ` (${day.date})` : "";
    const named = trip ? ` of ${plain(trip.name)}` : "";
    sentences.push(`Day ${day.day}${dated}${named} has ${pluralStops(day.stops.length)}.`);
    if (day.stops.length > 0) {
      sentences.push(
        `They are: ${day.stops
          .map((stop) =>
            stop.timeWindow
              ? `${plain(stop.title)} at ${stop.timeWindow.start}`
              : `${plain(stop.title)} (no set time)`,
          )
          .join("; ")}.`,
      );
      // "What on day N still needs booking?" is a chip the rail offers whenever
      // this day has one (suggestedQuestions.ts), so it has to be a question
      // this model answers. `needsBooking` is the shared rule both halves read.
      const unbooked = day.stops.filter((stop) => needsBooking({ kind: stop.kind }));
      sentences.push(
        unbooked.length === 0
          ? "Nothing on it is still pending."
          : `Still to book: ${unbooked.map((stop) => plain(stop.title)).join(", ")}.`,
      );
    }
    // Day-scoped, from `read_day`'s own conflict list — NOT from the trip's,
    // which spans every day. `conflictsOnDay` already filtered to this one, and
    // the domain's descriptions say "on the same day" rather than naming a
    // number, so this cannot wander onto another day (M16's gate).
    if (day.conflicts.length > 0) {
      sentences.push(
        `${day.conflicts.length} conflict${day.conflicts.length === 1 ? "" : "s"} on this day: ${day.conflicts
          .map((conflict) => plain(conflict.description))
          .join(" ")}`,
      );
    }
  } else if (trip) {
    const started = trip.startDate ? `, starting ${trip.startDate}` : "";
    sentences.push(`${plain(trip.name)} runs to ${trip.dayCount} day${trip.dayCount === 1 ? "" : "s"}${started}.`);
    const stops = trip.days.reduce((total, d) => total + d.stopCount, 0);
    sentences.push(`There ${stops === 1 ? "is" : "are"} ${pluralStops(stops)} scheduled across it.`);
    sentences.push(...toBookSentences(trip));
  }

  if (free && !("error" in free)) {
    const longest = [...free.gaps].sort((a, b) => b.durationMinutes - a.durationMinutes)[0];
    const window = `between ${free.window.after} and ${free.window.before}`;
    // "Most free" is the ranking's first day (most free minutes), which need
    // not be the day holding the single longest gap: say both, so a "which
    // day is most free?" answer names the ranked day.
    const mostFree = free.days.length > 1 ? free.days[0] : undefined;
    if (mostFree && mostFree.freeMinutes > 0) {
      sentences.push(`Day ${mostFree.day} has the most free time ${window}: ${mostFree.freeMinutes} minutes.`);
    }
    sentences.push(
      longest
        ? `The biggest open stretch ${window} is on day ${longest.day}, ${longest.start} to ${longest.end} — ${longest.durationMinutes} minutes.`
        : `I found no open time on ${free.searched} ${window}.`,
    );
  }

  // Trip-scoped only. The conflict list spans the whole trip, and naming a
  // clash on day 9 inside an answer about day 3 is precisely the wandering
  // M16's gate refuses.
  if (!dayScoped && trip && trip.conflicts.length > 0) {
    sentences.push(
      `${trip.conflicts.length} conflict${trip.conflicts.length === 1 ? "" : "s"} ${trip.conflicts.length === 1 ? "is" : "are"} still open: ${plain(trip.conflicts[0]!.description)}`,
    );
  }

  // Never an empty answer. A turn whose tools all failed still says something
  // true, because an assistant that streams nothing is indistinguishable from
  // one that is broken.
  if (sentences.length === 0) sentences.push("I couldn't read anything about this trip.");

  const chat = resultFor<{ messages: unknown[] }>(results, READ_CHAT_TOOL_NAME);
  if (chat) sentences.push(`I read the last ${chat.messages.length} message${chat.messages.length === 1 ? "" : "s"} in the chat.`);

  // The answer says where it searched, as decision 13 asks of a real model.
  const near = resultFor<PlaceSearchReadout & { near: { name: string } | null }>(results, FIND_PLACES_NEAR_NOW_TOOL_NAME);
  if (near) {
    const names = near.results.flatMap((result) => result.candidates.map((candidate) => plain(candidate.name)));
    const where = near.near === null ? "around the trip" : `near ${plain(near.near.name)}`;
    sentences.push(names.length === 0 ? `I found nothing ${where}.` : `I searched ${where}: ${names.join(", ")}.`);
  }

  sentences.push(SIMULATED_ASK_NOTICE);
  return sentences;
}

// ---------------------------------------------------------------------------
// The write half of an ask turn (M9)
// ---------------------------------------------------------------------------

// Verbs that mean "change this trip" rather than "tell me about it".
//
// This is the ONE judgement a real model makes from the question that this
// model has to stand in for, so it is deliberately small, deliberately
// imperative-only, and deliberately excludes "plan" — "What's the plan for day
// 2?" is a question, and the derived suggestion chips ask it verbatim
// (suggestedQuestions.ts). Word boundaries matter for the same reason: "What
// still needs booking?" must not match `book`.
//
// `insert` is here because it is a write tool's own name — `insert_playbook_day`
// — and the system instruction tells the model to "insert" in those words
// (handleAskRequest.ts). "Insert a coffee stop on day 2" reading as a question
// was the feature failing to recognise its own verb.
const CHANGE_VERBS = /\b(add|insert|move|remove|delete|rename|reschedule|schedule|book|put|change|swap)\b/i;

// The other half of "asked for a change": a question that asks for IDEAS rather
// than for a fact. `CHANGE_VERBS` is imperative-only by design, which left the
// two chips that most need a proposal — "There are no days yet — how should I
// start planning this trip?" and "Day 3 is empty — what could I do with it?" —
// answered with "it runs to 0 days… no open time." The empty-trip chip is
// literally the start of "plan a trip from start to finish" (final branch
// review, 2026-08-29, finding 1).
//
// Anchored on the OBJECT, not just the verb, because the near miss is real: the
// trip-scoped conflict chip asks "what should I do about them?" and must stay a
// question. "…do with" is the day chip, "…do about" is the conflict chip.
// `askChipCoverage.test.ts` is what keeps that boundary honest as either chip is
// reworded.
const PLANNING_PROMPTS = /\bhow should i start\b|\bwhat (?:could|should) i do with\b/i;

function asksForAChange(text: string): boolean {
  return CHANGE_VERBS.test(text) || PLANNING_PROMPTS.test(text);
}

/** The newest user message's text — the question this turn is answering. */
function latestUserText(options: CallOptionsLike): string {
  const prompt = options.prompt ?? [];
  for (let i = prompt.length - 1; i >= 0; i--) {
    const message = prompt[i]!;
    if (message.role !== "user") continue;
    if (typeof message.content === "string") return message.content;
    if (!Array.isArray(message.content)) return "";
    return (message.content as { type?: string; text?: unknown }[])
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text as string)
      .join(" ");
  }
  return "";
}

/**
 * Whether write tools are on the table this turn.
 *
 * Read from the tool set the harness actually handed this call, never from the
 * prompt: a viewer's turn is offered read tools only (handleAskRequest), and a
 * simulated model that proposed anyway would make the switched-off deployment
 * appear to break a permission rule the live one keeps.
 */
function canPropose(options: CallOptionsLike): boolean {
  return (options.tools ?? []).some((t) => t?.name === "AddActivity");
}

// What the user has to say for this model to reach for the library rather than
// invent two sample stops. Deliberately narrow — the words a person uses when
// they mean "find me a ready-made day", and nothing that overlaps
// `CHANGE_VERBS`' ordinary "add a coffee stop".
//
// It matters that this branch exists at all: `ai-live` is off in every Vercel
// environment, so without it ADR-042's whole flow is unreachable anywhere
// Mitchell can click it.
const PLAYBOOK_PROMPTS = /\bplaybook|\blibrary\b|\bsaved day|\bready-made\b|\bsomeone else's day\b/i;

function asksForAPlaybookDay(text: string): boolean {
  return PLAYBOOK_PROMPTS.test(text);
}

/**
 * The playbook half of a proposing turn, in two steps.
 *
 * **Search, then insert — never insert alone**, which is the shape the
 * instruction asks a real model for and the shape the flow only works in: the
 * `savedDayId` has to come from the library, because `insert_playbook_day`
 * resolves it through `readableSavedDay` and refuses anything invented.
 *
 * The cities come from `read_trip`'s own readout rather than from the question,
 * so the day this proposes is one that touches somewhere the trip actually
 * goes. On an empty or unlocated trip that list is empty, which
 * `search_playbooks` reads as "browse the most-added days" — still a real
 * answer.
 *
 * `null` means there was nothing to insert: the library had no matching day, so
 * the turn falls through and SAYS so instead of proposing something else.
 */
function playbookCalls(results: readonly ToolResultLike[]): ToolCall[] | null {
  const found = resultFor<PlaybookSearchReadout>(results, "search_playbooks");
  if (found === undefined) {
    const trip = resultFor<TripReadout>(results, "read_trip");
    // Unfenced before it goes back IN as a search argument. `search_playbooks`
    // also unfences what it receives, so either spelling works — but a model
    // told never to repeat the marks would not send them, and this model is a
    // stand-in for that model.
    // `trip?.days ?? []` because `trip` itself can be `undefined` — no
    // `read_trip` result yet, or one that failed `resultFor`'s `safeParse`.
    // `day.cities ?? []` is now belt-and-braces rather than load-bearing:
    // `resultFor` parses through `TripReadoutSchema`, which requires `cities`
    // on every day, so a `trip` that parsed at all already has it on each of
    // its days. Kept anyway — a day without `cities` is still meant to read
    // as "nothing to offer here", never a crash, however it got past the
    // schema.
    const cities = [...new Set((trip?.days ?? []).flatMap((day) => (day.cities ?? []).map(plain)))].slice(0, 3);
    return [call("search_playbooks", cities.length > 0 ? { cities } : {})];
  }
  // The first result that is not the searcher's own (KI-2026-09-08-d).
  // `addCounts` (savedDayAdds.ts) excludes an author adding their own day, so
  // proposing one is an add that could never count — and it is never the
  // more useful answer anyway, since the searcher already has that day. A
  // trip's own days already in the trip are a separate exclusion this turn
  // cannot make: nothing in scope here (or in `TripReadout`) records which
  // `savedDayId` a trip's own days came from, so that dedup would need new
  // state and stays out of this fix.
  const first = found.days.find((day) => !day.mine);
  // One day per turn, exactly as the instruction asks of a real model.
  return first === undefined ? null : [call(INSERT_PLAYBOOK_DAY, { savedDayId: first.savedDayId })];
}

/** A write tool's result — planningTools' `execute` returns `{ queued: true }`. */
function isQueued(result: ToolResultLike): boolean {
  const output = result.output;
  return typeof output === "object" && output !== null && (output as { queued?: unknown }).queued === true;
}

/**
 * The proposal, drawn from what the read tools just returned.
 *
 * Deterministic on purpose — the e2e asserts this exact content — and shaped by
 * two rules that are load-bearing rather than lazy:
 *
 *   * **No `cost`.** M9's honest unknowns: `Money` is optional, and a stop
 *     whose price nobody knows must carry no cost at all. The 2026-08-02
 *     dogfood run wrote `amountMinor: 0` on all nine activities it planned,
 *     which the board renders as *free* when the truth was *unknown*.
 *   * **No `location`.** `enrichCommandLocations` no-ops when there is nothing
 *     to look up, so the simulated path still cannot reach LocationIQ. This is
 *     now the only place that guarantee is kept: the command endpoint's own
 *     canned plan retired with the `board` surface (ADR-033), and the page it
 *     composes never carried a location at all.
 */
function proposeCalls(scope: AskScope, results: readonly ToolResultLike[], question: string): ToolCall[] {
  const trip = resultFor<TripReadout>(results, "read_trip");
  const coffee = (dayRef: string, timed = false) =>
    call("AddActivity", { title: "Sample: coffee stop", dayRef, ...(timed && { timeWindow: COFFEE_TIME }) });
  const stroll = (dayRef: string, timed = false) =>
    call("AddActivity", { title: "Sample: evening stroll", dayRef, ...(timed && { timeWindow: STROLL_TIME }) });
  // An empty trip, or a request for a new day, gets a day to put them on, in
  // the SAME batch — which is exactly the within-batch ref resolution
  // `resolveBatch` exists for.
  if (trip && (trip.dayCount === 0 || ADD_A_DAY.test(question))) {
    const dayRef = `day ${trip.dayCount + 1}`;
    // Timed only for a requested day: a suggested day draws a stop only on
    // its river, and an untimed one has no place there and falls into the
    // chip (`placeGhosts`) — so untimed, m40-big-change.spec.ts could not see
    // the new day hold anything. An empty trip's first day keeps them
    // untimed: m16-assistant.spec.ts walks them from the Unscheduled rack.
    const timed = trip.dayCount > 0;
    return [call("AddDay", {}), coffee(dayRef, timed), stroll(dayRef, timed)];
  }
  const dayRef = `day ${scope.kind === "day" ? scope.dayIndex + 1 : 1}`;
  // **One stop for an ordinary change, two for a request to plan** (ADR-067).
  // A turn of more than one change is stored as suggestions on the board and
  // a single change keeps ADR-022's card, so this model has to be able to
  // reach both on the deployment it is the whole assistant of.
  return PLANNING_PROMPTS.test(question) || asksForAnItinerary(question)
    ? [coffee(dayRef), stroll(dayRef)]
    : [coffee(dayRef)];
}

// The times a requested day's two stops are given (see `proposeCalls`).
const COFFEE_TIME = { start: "09:00", end: "09:30" };
const STROLL_TIME = { start: "18:00", end: "19:00" };

// "add a day in Kyoto", "plan another day": the ADR-067 request a new day
// filled with stops answers. One optional word between, so "add a full day"
// matches and "add a coffee stop to day 1" — a stop, not a day — does not.
const ADD_A_DAY = /\b(?:add|plan)\s+(?:a|an|another|one more)\s+(?:\w+\s+)?day\b/i;

const SIMULATED_PROPOSAL_NOTICE =
  "AI is switched off on this deployment, so I drafted this from your trip data rather than from a model.";

// The honest fallback for a library with nothing to offer: a proposal is not
// drafted, so this turn ends as prose with no card under it.
const SIMULATED_NO_PLAYBOOK_ANSWER = [
  "I couldn't find a day in the playbook library to suggest for this trip.",
  SIMULATED_PROPOSAL_NOTICE,
];

/**
 * What the model says about a proposal it has just drafted.
 *
 * Never "I added" — the tools collected, nothing committed, and the whole
 * point of propose→review→approve is that the sentence on screen and the state
 * of the trip agree. The card underneath carries the changes themselves.
 */
function proposalAnswer(scope: AskScope, results: readonly ToolResultLike[]): string[] {
  // One `insert_playbook_day` is one queued change here and one line on the
  // card, which is the honest count: the stops it becomes are minted by the
  // server on approval, and nothing in this turn knows how many there will be.
  const queued = results.filter(isQueued).length;
  const where = scope.kind === "day" ? `day ${scope.dayIndex + 1}` : "this trip";
  // More than one change usually goes on the board as suggestions (ADR-067);
  // a refused store falls back to the card, which this model cannot know, so
  // the sentence says "usually" rather than promising either.
  return [
    `I've drafted ${queued} change${queued === 1 ? "" : "s"} for ${where}. Nothing is applied yet.`,
    queued > 1
      ? "They usually go on the board as suggestions, or below when they cannot — accept the ones you want, or dismiss them to leave the trip exactly as it is."
      : "Review them below — approve to put them on the board, or reject to leave the trip exactly as it is.",
    SIMULATED_PROPOSAL_NOTICE,
  ];
}

/**
 * The pre-turn classification call (askIntent.ts), answered from the same
 * judgement that decides whether this model proposes.
 *
 * Reusing that predicate is the point, not a shortcut: the switched-off
 * deployment is the one every Vercel environment runs, so a classifier that
 * said "question" for a turn this model then wants to propose on would hand
 * itself a tool set it cannot use, and the proposal card would stop appearing
 * on the only path anyone deploys. The end-to-end cover for that is
 * `e2e/m16-assistant.spec.ts` ("the chips that used to be dead ends are
 * clickable and answered"), whose planning chip must still produce a proposal
 * card — it goes through the real endpoint and therefore through the real
 * classification call.
 * `askChipCoverage.test.ts` does NOT cover it — it hands the model a
 * hardcoded `EDITOR_TOOLS` and never issues a classification call at all.
 *
 * **`asksForAPlaybookDay` belongs in that judgement too, and its absence made
 * most of `PLAYBOOK_PROMPTS` dead code** (browser walk of the preview,
 * 2026-09-08). `askTurn` reaches the library branch on `asksForAPlaybookDay`
 * alone, but the classifier consulted only `asksForAChange` — so "find me a
 * ready-made day for Kyoto" was called a question, was offered no write tools,
 * and could never reach the branch written for it. `\bready-made\b`,
 * `\bsaved day` and `\bsomeone else's day\b` only ever fired when the user also
 * happened to say a change verb, in which case `CHANGE_VERBS` had already
 * matched. One predicate, so the two answers cannot disagree.
 */
function asksToWrite(text: string): boolean {
  // **`asksForAnItinerary` belongs in this judgement for the same reason
  // `asksForAPlaybookDay` does**, and its absence would have the same
  // consequence the browser walk of 2026-09-08 measured for that one: a
  // classifier and a turn-shape predicate that disagree, so a request reaches
  // the branch written for it holding no tool it can use. "One predicate, so
  // the two answers cannot disagree" is the rule, and this is the third half of
  // it.
  return asksForAChange(text) || asksForAPlaybookDay(text) || asksForAnItinerary(text);
}

// **A request for a whole itinerary** — the `plan` class, and the phrase the
// deployed path could not recognise at all.
//
// Two things are wrong with the old predicate and this fixes both (M9 design
// §1, *"the deployed symptom and the architectural gap have different causes.
// Both are fixed here"*):
//
//   1. **`edit` was unreachable** — KI-2026-09-12-a. Two verdicts where the
//      real classifier has four, so every write turn in the integration suite
//      was really a `plan` turn.
//   2. **`plan` was unreachable by its own name.** `CHANGE_VERBS` deliberately
//      excludes the word, on the sound ground that *"What's the plan for day
//      2"* is a question — so on every Vercel environment, where `ai-live` is
//      off and this IS the classifier, *"plan me a six day trip"* classified as
//      a question and was offered no write tools. That is M9's headline flow
//      and KI-12's gate box, dark on the only path anyone can click.
//
// **The lookbehind is what makes the word usable again.** `plan` preceded by an
// article or a possessive is a NOUN — "the plan", "my plan", "that plan" — and
// a noun is what the question uses. `plan` on its own is the verb. That is a
// narrower rule than dropping the word, and it is checkable: both phrasings are
// asserted in `simulatedModel.test.ts`.
//
// `\d+[-\s]day` catches "Create a 7 day itinerary for Rochester NY" — KI-15's
// verbatim dogfood prompt, whose verb is in no list. It will also match "is
// there a 2 day gap?", which is a question given the write tools: that is rule
// 1's direction (a question wrongly given write tools costs tokens; a change
// request denied them cannot act), so it is the side to be wrong on.
const ITINERARY_REQUEST =
  /(?<!\b(?:the|a|your|my|our|this|that)\s)\b(?:plan|itinerary)\b[^?]{0,40}?\b(?:trip|days?|week|weekend|itinerary)\b|\bhow should i start\b|\b\d+[-\s]day\b/i;

/** True for a request to generate a whole itinerary — see `ITINERARY_REQUEST`. */
function asksForAnItinerary(text: string): boolean {
  return ITINERARY_REQUEST.test(text);
}

/**
 * The simulated classifier's task class.
 *
 * Three verdicts where there used to be two — **KI-2026-09-12-a, closed.** That
 * entry's point stands: every "write turn" assertion in the integration suite
 * was really an assertion about a `plan` turn, because `edit` was unreachable.
 * It also said why nobody fixed it in passing: the split is a product judgement
 * about the real classifier's prompt, not a test-fixture detail. M9's design
 * makes that judgement, and it is the same one the live instruction already
 * states — `plan` is *"a whole itinerary or several days"*, and one imperative
 * about one stop is not that.
 *
 * Still deterministic and still a predicate. It is the flag-off path's
 * stand-in, not a model, and a stand-in that guessed would make the integration
 * suite's verdicts unreproducible.
 */
function simulatedTaskClass(text: string): "question" | "edit" | "plan" {
  if (asksForAnItinerary(text)) return "plan";
  return asksToWrite(text) ? "edit" : "question";
}

/**
 * The page classifier's stand-in (ADR-058): a question is a sentence that asks
 * something and asks for nothing to be made. "how much am I spending on food?"
 * is a question; "make a notebook about meals" and "add a cost chart" compose.
 * Anything it cannot place composes — the page surface's default.
 */
const PAGE_COMPOSE_VERBS = /\b(add|insert|put|make|build|create|write|draft|notebook|section)\b/i;

function simulatedPageIntent(text: string): "compose" | "question" {
  return text.trim().endsWith("?") && !PAGE_COMPOSE_VERBS.test(text) ? "question" : "compose";
}

function classifyStep(options: CallOptionsLike): SimulatedStep {
  // The STRUCTURED verdict, via askIntent.ts's own writer — not the bare word
  // this used to emit. `classifyAskIntent` asks for a typed field, and the SDK
  // parses this text as JSON against that schema before returning: a bare
  // `write` would fail to parse and fail open on every turn of the only path
  // anyone deploys. The shape moved when `certainty` arrived (M9) and this
  // function needed no edit, which is the whole value of writer and reader
  // living in one module.
  //
  // **`certainty: "sure"`, always, and that is honest rather than convenient.**
  // This is a deterministic predicate over a regex; it is not hesitating. A
  // stand-in that reported `unsure` would route every simulated write turn to a
  // stronger tier for a doubt nothing actually has, and would make the
  // integration suite's tier assertions measure a fiction.
  const text = latestUserText(options);
  const verdict = askIntentVerdictText(
    isPageIntentCall(systemTextOf(options)) ? simulatedPageIntent(text) : simulatedTaskClass(text),
    "sure",
  );
  return {
    content: [{ type: "text", text: verdict }],
    finishReason: { unified: "stop", raw: undefined },
    textDeltas: [verdict],
  };
}

// ---------------------------------------------------------------------------
// The page half of an ask turn (ADR-033 Decision 4)
// ---------------------------------------------------------------------------

const SIMULATED_PAGE_ANSWER = "I've drafted this page and put it in the editor for you to review and edit.";

const SIMULATED_PAGE_NOTICE =
  "AI is switched off on this deployment, so the server composed it rather than a model.";

/**
 * A page-scoped turn: compose, then say so.
 *
 * **This is the branch with the least slack in the file.** `ai-live` is off in
 * every Vercel environment, so a deployed app that cannot reach here cannot
 * author a Notebook page at all (ADR-033's consequences). It used to be reached
 * through `generateText` on the command endpoint, which is why `doStream`
 * carried a loud throw for it; that throw is gone because the command path is,
 * and this is now streamed like every other turn.
 *
 * Two steps, and no latch — the same reason the answer half needs none: the
 * second step is text, which ends the loop by itself. `toolResultsOf` reads the
 * conversation rather than a counter, so "have I composed yet?" survives a
 * retry the way a flag on the instance would not.
 *
 * It does NOT read the trip first, though the instruction asks a real model to.
 * `pageCalls` inserts prose only, deliberately — no `insert_widget`, so it is
 * decoupled from the registry and validates unconditionally — and there is
 * nothing in a readout for it to put in it. A
 * read it does not use would be a step charged to the actor's quota for nothing
 * (KI-67).
 */
function pageTurn(results: readonly ToolResultLike[], question: string, options: CallOptionsLike): SimulatedStep {
  const going = navigationTurn(results, question, options, true);
  if (going !== null) return going;
  // **A page question** (ADR-058): no insert tool was handed over, so this is
  // answered like any other question — read, then speak.
  if (!(options.tools ?? []).some((tool) => tool?.name === "insert_text")) {
    if (results.length === 0) {
      return { content: askQuestions({ kind: "trip" }, options), finishReason: { unified: "tool-calls", raw: undefined } };
    }
    return speak(askAnswer({ kind: "trip" }, results));
  }
  const topic = notebookTopic(question);
  if (topic !== null) return notebookTurn(results, topic);
  if (asksForAWidget(question)) {
    const widget = widgetTurn(results, question);
    if (widget !== null) return widget;
  }
  if (!results.some((result) => result.toolName === "insert_text")) {
    return { content: pageCalls(), finishReason: { unified: "tool-calls", raw: undefined } };
  }
  return speak([SIMULATED_PAGE_ANSWER, SIMULATED_PAGE_NOTICE]);
}

// **A notebook about a topic** (ADR-058) — "make a notebook about meals". The
// topic is a TAG, because that is what a notebook's widgets filter by: the
// page is built once and reads the trip live, so nothing here reads a day.
// First match wins, so a narrower phrase comes before a word it contains
// ("night markets" is nightlife, not shopping) and food before drink. Typed against the contract, so
// a key that is not a tag fails to compile; a tag with no row is simply never a
// topic.
const TOPIC_TAGS: readonly [RegExp, ActivityTag][] = [
  [/\b(nightlife|night ?out|clubs?|clubbing|night markets?)\b/i, "nightlife"],
  [/\b(meals?|food|eat|eating|restaurants?|dining|dinners?|lunch(es)?)\b/i, "meal"],
  [/\b(drinks?|bars?|cafés?|cafes?|coffee|wine|winer(y|ies)|tastings?|cocktails?|beers?)\b/i, "drinks"],
  [/\b(lodging|hotels?|stays?|accommodation)\b/i, "lodging"],
  [/\b(tickets?|ticketed|bookings?)\b/i, "ticketed"],
  [/\b(museums?|galler(y|ies)|art)\b/i, "museum"],
  [/\b(sights?|sightseeing|landmarks?|temples?|monuments?|viewpoints?)\b/i, "sight"],
  [/\b(beach(es)?|swimming|coast)\b/i, "beach"],
  [/\b(shopping|shops?|markets?)\b/i, "shopping"],
  [/\b(shows?|concerts?|theat(er|re)|performances?|gigs?)\b/i, "show"],
  [/\b(tours?|guided|classes|workshops?)\b/i, "tour"],
  [/\b(wellness|spas?|onsen|yoga|massages?)\b/i, "wellness"],
  [/\b(outdoors?|hikes?|hiking|nature|parks?)\b/i, "outdoors"],
];

const NOTEBOOK_REQUEST = /\b(notebook|page|section)\b.*\babout\b|\babout\b.*\bnotebook\b/i;

function notebookTopic(text: string): ActivityTag | null {
  if (!NOTEBOOK_REQUEST.test(text)) return null;
  // The topic follows "about": read the whole request and "show me a notebook
  // about hiking" is a `show` notebook, because the verb comes first.
  const about = text.split(/\babout\b/i).slice(1).join(" ") || text;
  return TOPIC_TAGS.find(([pattern]) => pattern.test(about))?.[1] ?? null;
}

/**
 * What a topic notebook searches for: the topic's spend and its stops. Not the
 * topic word itself — "meals" matches no widget, because widgets are named for
 * what they SHOW, and the topic is the filter, not the widget.
 */
const NOTEBOOK_QUERY = "what it costs and every stop";

/** How many tag-filtered widgets a simulated notebook carries. */
const NOTEBOOK_WIDGETS = 3;

/**
 * **Search, then insert tag-filtered widgets, then say so** — the shape the
 * compose instruction asks for, and the one the 2026-09-26 turn did not take:
 * one search for widgets that take a tag, a heading that says what the section
 * is FOR (never what it holds), and the top matches each filtered to the
 * topic's tag. No `read_trip`, no `read_day`.
 */
function notebookTurn(results: readonly ToolResultLike[], tag: ActivityTag): SimulatedStep {
  const searched = results.find((result) => result.toolName === "search_widgets");
  if (searched === undefined) {
    return {
      content: [call("search_widgets", { query: NOTEBOOK_QUERY, acceptsFilter: "tag" })],
      finishReason: { unified: "tool-calls", raw: undefined },
    };
  }
  if (!results.some((result) => result.toolName === "insert_widget")) {
    const seen = new Set<string>();
    const matches = ((searched.output as { matches?: WidgetMatch[] } | null)?.matches ?? [])
      .filter((match) => {
        // One of each widget, none that withholds the tag, and not the bare
        // `field` primitive, which names one field only `get_widget` can choose.
        if (match.withheld !== undefined || match.insert.name === "field" || seen.has(match.insert.name)) return false;
        seen.add(match.insert.name);
        return match.selects?.filters.includes("tag") === true;
      })
      .slice(0, NOTEBOOK_WIDGETS);
    return {
      content: [
        call("insert_text", { markdown: `## ${TAG_LABEL[tag]}\n\nEverything on this trip tagged ${tag}, read live.` }),
        ...matches.map((match) => call("insert_widget", { name: match.insert.name, params: { ...match.insert.params, tag } })),
      ],
      finishReason: { unified: "tool-calls", raw: undefined },
    };
  }
  const added = results.filter((result) => result.toolName === "insert_widget" && (result.output as { ok?: boolean } | null)?.ok === true).length;
  return speak([`I've started a ${tag} notebook with ${added} live widget${added === 1 ? "" : "s"}, in the editor for you to review.`, SIMULATED_PAGE_NOTICE]);
}

// What a page request has to say for this model to look for a widget rather
// than write a paragraph: a verb of adding. "Draft this page" and "write a
// welcome" stay prose; "add a spend by tag chart" searches.
const WIDGET_REQUEST = /\b(add|insert|put)\b/i;

function asksForAWidget(text: string): boolean {
  return WIDGET_REQUEST.test(text);
}

/**
 * The widget half of a page turn (ADR-057): **search, then insert the top
 * match, then say so** — the shape the instruction asks a real model for, and
 * the only one that works now the catalogue is not in the prompt: the model
 * learns a widget's name and params from `search_widgets`, and `insert_widget`
 * is handed the match's own `insert` untouched.
 *
 * The query is the user's sentence as typed. That is deliberate rather than
 * lazy: the ranking drops the words of asking ("add", "a", "to") itself, so
 * what this proves is that a person's request, not a curated keyword, finds
 * the widget they meant.
 *
 * `null` when the search found nothing, so the turn falls back to prose rather
 * than inserting a widget nobody asked for.
 */
function widgetTurn(results: readonly ToolResultLike[], question: string): SimulatedStep | null {
  const searched = results.find((result) => result.toolName === "search_widgets");
  if (searched === undefined) {
    return { content: [call("search_widgets", { query: question })], finishReason: { unified: "tool-calls", raw: undefined } };
  }
  const top = (searched.output as { matches?: WidgetMatch[] } | null)?.matches?.[0];
  if (top === undefined) return null;
  const inserted = results.find((result) => result.toolName === "insert_widget");
  if (inserted === undefined) {
    return { content: [call("insert_widget", top.insert)], finishReason: { unified: "tool-calls", raw: undefined } };
  }
  const output = inserted.output as { ok?: boolean; refused?: string; error?: { message?: string } } | null;
  if (output?.ok !== true) {
    return speak([
      `I couldn't add ${top.title}: ${output?.refused ?? output?.error?.message ?? "the page refused it"}.`,
      SIMULATED_PAGE_NOTICE,
    ]);
  }
  return speak([`I've added ${top.title} to this page, in the editor for you to review.`, SIMULATED_PAGE_NOTICE]);
}

/**
 * One ask step. Three shapes, in order — plus the classification call, which
 * is answered above them all because it is not a turn at all:
 *
 *   1. Nothing read yet → read.
 *   2. Read, the user asked for a CHANGE or for IDEAS (`asksForAChange`), write
 *      tools are offered, and nothing has been queued yet → propose.
 *   3. Otherwise → speak.
 *
 * Step 2 is skipped entirely for a question, and unreachable for a viewer.
 */
function askTurn(options: CallOptionsLike): SimulatedStep {
  const system = systemTextOf(options);
  // Answered before anything else reads the prompt: a classification call
  // carries no scope line and no tools, so every branch below would misread it
  // as an opening turn and reply with `read_trip`.
  if (isAskIntentCall(system)) return classifyStep(options);
  const scope = parseAskScope(system);
  const results = toolResultsOf(options);
  // A page turn is a different job, not a variant of the answer: `pageTurn`
  // composes, or — when no insert tool was handed over, the page's `question`
  // intent (ADR-058) — reads and answers.
  if (scope.kind === "page") return pageTurn(results, latestUserText(options), options);
  if (scope.kind === "account") return accountTurn(results, latestUserText(options), options);
  if (scope.kind === "playbook") return playbookTurn(results, latestUserText(options), options);
  const going = navigationTurn(results, latestUserText(options), options, false);
  if (going !== null) return going;
  if (results.length === 0) {
    return { content: askQuestions(scope, options), finishReason: { unified: "tool-calls", raw: undefined } };
  }
  const proposed = results.some(isQueued);
  const question = latestUserText(options);
  // The library branch is checked BEFORE the sample-stops one: "add a day from
  // the playbook library" satisfies `asksForAChange` too, and the more specific
  // reading of the same sentence is the right one.
  if (!proposed && canPropose(options) && asksForAPlaybookDay(question)) {
    const calls = playbookCalls(results);
    if (calls !== null) return { content: calls, finishReason: { unified: "tool-calls", raw: undefined } };
    return speak(SIMULATED_NO_PLAYBOOK_ANSWER);
  }
  // **`asksToWrite`, not `asksForAChange`** — the shared predicate, so the
  // classifier and the turn shape cannot disagree.
  //
  // This line said `asksForAChange` and was wrong the moment
  // `asksForAnItinerary` joined `asksToWrite`: "plan me a six day trip"
  // classified as a write, was handed the write tools, did its reads, and then
  // fell through to `askAnswer` without drafting anything. That is the exact
  // failure the browser walk of 2026-09-08 measured for `asksForAPlaybookDay`
  // — and `asksToWrite`'s own comment, two functions up, states the rule this
  // line was breaking. Caught by CodeRabbit on PR #184.
  if (!proposed && canPropose(options) && asksToWrite(question)) {
    return { content: proposeCalls(scope, results, question), finishReason: { unified: "tool-calls", raw: undefined } };
  }
  return speak(proposed ? proposalAnswer(scope, results) : askAnswer(scope, results));
}

// ---------------------------------------------------------------------------
// Taking you somewhere (ADR-072): one call, then a sentence
// ---------------------------------------------------------------------------

// A verb of going, and then where. "What's the plan for day 2?" names a day
// and goes nowhere; "show me day 2 on the map" goes. `open` only as a verb
// with its object, since "the biggest open stretch on day 3" is a question.
// `plan` is a view only as "the plan view", for `ITINERARY_REQUEST`'s reason.
const GO_VERBS = /\b(show|switch|go to|take me|open (?:the|my|day|people))\b/i;
const VIEW_WORDS: readonly [RegExp, string][] = [
  [/\bmap\b/i, "Map"],
  [/\bcalendar\b/i, "Calendar"],
  [/\boverview\b/i, "Overview"],
  [/\bplan view\b/i, "Plan"],
];
const EDITING_REQUEST = /\bturn (?:on |off )?editing\b|\bediting (?:on|off)\b/i;

/** Where a request asks to go, as `go_to`'s input, or null when it asks to go nowhere. */
function destinationOf(text: string): Record<string, unknown> | null {
  if (!GO_VERBS.test(text)) return null;
  const input: Record<string, unknown> = {};
  const view = VIEW_WORDS.find(([pattern]) => pattern.test(text))?.[1];
  if (view !== undefined) input.view = view;
  const day = /\bday\s+(\d+)\b/i.exec(text)?.[1];
  if (day !== undefined) input.day = Number(day);
  const notebook = /\bthe\s+(.+?)\s+notebook\b/i.exec(text)?.[1];
  if (notebook !== undefined) input.notebook = notebook;
  if (/\bpeople\b/i.test(text)) input.people = true;
  return Object.keys(input).length === 0 ? null : input;
}

/**
 * A request to go somewhere, or (on a notebook) to turn its editing on or off: the
 * one call, then what came of it. Null for anything else, or when the tool
 * was not handed over, so the turn is answered as it would have been.
 */
function navigationTurn(
  results: readonly ToolResultLike[],
  question: string,
  options: CallOptionsLike,
  onPage: boolean,
): SimulatedStep | null {
  const editing = onPage && EDITING_REQUEST.test(question) && offered(options, PROPOSE_NOTEBOOK_EDITING_TOOL_NAME);
  const toolName = editing ? PROPOSE_NOTEBOOK_EDITING_TOOL_NAME : GO_TO_TOOL_NAME;
  const input = editing ? { on: !/\boff\b/i.test(question) } : destinationOf(question);
  if (input === null || !offered(options, toolName)) return null;
  // Asked once: what came back decides the sentence, whatever its shape.
  if (!results.some((result) => result.toolName === toolName)) {
    return { content: [call(toolName, input)], finishReason: { unified: "tool-calls", raw: undefined } };
  }
  const done = resultFor<{ queued: boolean; refused?: string }>(results, toolName);
  if (done?.queued !== true) return speak([`I couldn't take you there: ${done?.refused ?? "it isn't on this trip."}`, SIMULATED_ASK_NOTICE]);
  return speak([editing ? "Approve the card below and I'll switch this notebook's editing." : "Taking you there now.", SIMULATED_ASK_NOTICE]);
}

// ---------------------------------------------------------------------------
// The account half (M45): one aggregate, then an answer from it
// ---------------------------------------------------------------------------

/**
 * Which cross-trip tool a question needs, by phrase — the four example
 * questions' shapes, and `places_visited` for anything else. Never `read_trip`:
 * an account turn is not handed it, and calling it would end the turn.
 */
function accountCall(question: string): ToolCall {
  if (/\b(spen[dt]|cost|expensive|cheap|money|price)\b/i.test(question)) {
    return call("spend_by_category", /\b(meal|food|eat|dinner|lunch|restaurant)\b/i.test(question) ? { category: "meal" } : {});
  }
  if (/\b(next|suggest|should i (go|visit))\b/i.test(question)) return call("suggest_next_country", {});
  if (/\bmost\b/i.test(question)) return call("visit_counts", { by: /\bcountr(y|ies)\b/i.test(question) ? "country" : "city" });
  return call("places_visited", {});
}

const SIMULATED_ACCOUNT_FALLBACK = "I couldn't read your trips just now.";

// "open my Kyoto trip on the map": a verb of going, then a trip by its name.
const OPEN_TRIP_REQUEST = /\b(?:open|show(?: me)?|take me to|go to)\s+(?:my\s+|the\s+)?(.+?)\s+trip\b/i;

/** Which trip a request asks to open, and on which view, as `open_trip`'s input; null for anything else. */
function openTripInput(question: string): Record<string, unknown> | null {
  const trip = OPEN_TRIP_REQUEST.exec(question)?.[1];
  if (trip === undefined) return null;
  const view = VIEW_WORDS.find(([pattern]) => pattern.test(question))?.[1];
  return view === undefined ? { trip } : { trip, view };
}

/**
 * An account step: open the trip asked for (M45 D6), or else ask the one
 * aggregate the question needs, then say what it returned.
 */
function accountTurn(results: readonly ToolResultLike[], question: string, options: CallOptionsLike): SimulatedStep {
  const opening = openTripInput(question);
  if (opening !== null && offered(options, OPEN_TRIP_TOOL_NAME)) {
    if (!results.some((result) => result.toolName === OPEN_TRIP_TOOL_NAME)) {
      return { content: [call(OPEN_TRIP_TOOL_NAME, opening)], finishReason: { unified: "tool-calls", raw: undefined } };
    }
    const done = resultFor<{ queued: boolean; refused?: string }>(results, OPEN_TRIP_TOOL_NAME);
    if (done?.queued !== true) return speak([`I couldn't take you there: ${done?.refused ?? "that trip isn't one of yours."}`, SIMULATED_ASK_NOTICE]);
    return speak(["Taking you there now.", SIMULATED_ASK_NOTICE]);
  }
  if (results.length === 0) {
    const wanted = accountCall(question);
    if (!offered(options, wanted.toolName)) return speak([SIMULATED_ACCOUNT_FALLBACK, SIMULATED_ASK_NOTICE]);
    return { content: [wanted], finishReason: { unified: "tool-calls", raw: undefined } };
  }
  return speak([...accountAnswer(results), SIMULATED_ASK_NOTICE]);
}

function accountAnswer(results: readonly ToolResultLike[]): string[] {
  const spend = resultFor<SpendByCategoryReadout>(results, "spend_by_category");
  if (spend) {
    // The priciest per currency: minor units of two currencies do not compare.
    const tops = new Map<string, (typeof spend.categories)[number]>();
    for (const row of spend.categories) {
      const top = tops.get(row.currency);
      if (top === undefined || row.mostExpensive.perPersonMinor > top.mostExpensive.perPersonMinor) tops.set(row.currency, row);
    }
    if (tops.size === 0) return [`Nothing with a price on it across your ${spend.tripsCounted} trips.`];
    return [...tops.values()].map(({ category, currency, mostExpensive: { title, tripName, perPersonMinor } }) => {
      const what = `${category === "meal" ? "meal" : "stop"}${tops.size > 1 ? ` paid in ${currency}` : ""}`;
      return `The most expensive ${what} across your trips was ${plain(title)} on ${plain(tripName)}, at ${formatMoney(perPersonMinor, currency)} per person.`;
    });
  }
  const places = resultFor<PlacesVisitedReadout>(results, "places_visited");
  if (places) {
    const names = places.countries.map((country) => country.name ?? country.code).join(", ");
    return [
      `You've been to ${places.countries.length} countr${places.countries.length === 1 ? "y" : "ies"} across ${places.tripsCounted} trip${places.tripsCounted === 1 ? "" : "s"}${names ? `: ${names}` : ""}.`,
    ];
  }
  const counts = resultFor<VisitCountsReadout>(results, "visit_counts");
  if (counts) {
    const top = counts.places[0];
    if (top === undefined) return ["None of your trips has a stop with a recorded place yet."];
    const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;
    return [`The ${counts.by} you've been to most is ${plain(top.place)}: ${count(top.trips, "trip")}, ${count(top.days, "day")}.`];
  }
  const next = resultFor<SuggestNextCountryReadout>(results, "suggest_next_country");
  const pick = next?.unvisited[0];
  if (pick !== undefined && pick.countries[0] !== undefined) {
    return [`You haven't been to ${pick.countries[0]} yet, in ${pick.region} — it could be next.`];
  }
  return [SIMULATED_ACCOUNT_FALLBACK];
}

// ---------------------------------------------------------------------------
// The playbook pages (M45 D9): read the page, or draft one of its two writes
// ---------------------------------------------------------------------------

const SIMULATED_PLAYBOOK_NOTICE =
  "AI is switched off on this deployment, so I answered from this page rather than from a model.";

// "add this to my Kyoto trip on day 3": the trip as named, then its day. A
// request naming neither is asked about rather than guessed (D9).
const ADD_TO_TRIP_REQUEST = /\badd\b/i;
const NAMED_TRIP = /\b(?:to|into)\s+(?:my\s+|the\s+)?(.+?)\s+trip\b/i;
const START_TRIP_REQUEST = /\b(?:start|make|create|begin)\b.*\btrip\b/i;
const ASK_WHICH_TRIP = "Which of your trips should I add it to, and on which day?";

/**
 * A playbook page's step: start a trip with the playbook, add it to the trip
 * and day the person named, or ask which when they named neither; else read
 * the page once and say what it shows. Each tool only when it was offered, so
 * a list page, which holds no write, is read and answered.
 */
function playbookTurn(results: readonly ToolResultLike[], question: string, options: CallOptionsLike): SimulatedStep {
  if (START_TRIP_REQUEST.test(question) && offered(options, START_TRIP_WITH_PLAYBOOK_TOOL_NAME)) {
    return draftOnce(results, call(START_TRIP_WITH_PLAYBOOK_TOOL_NAME, {}), "I've drafted a new trip with it — approve the card below to start it.");
  }
  if (ADD_TO_TRIP_REQUEST.test(question) && offered(options, ADD_PLAYBOOK_TO_TRIP_TOOL_NAME)) {
    const trip = NAMED_TRIP.exec(question)?.[1];
    const day = /\bday\s+(\d+)\b/i.exec(question)?.[1];
    if (trip === undefined || day === undefined) return speak([ASK_WHICH_TRIP, SIMULATED_PLAYBOOK_NOTICE]);
    return draftOnce(
      results,
      call(ADD_PLAYBOOK_TO_TRIP_TOOL_NAME, { trip, day: Number(day) }),
      `I've drafted adding it to your ${trip} trip on day ${day} — approve the card below to add it.`,
    );
  }
  const read = offered(options, READ_PLAYBOOK_TOOL_NAME) ? READ_PLAYBOOK_TOOL_NAME : SEARCH_THIS_PAGE_TOOL_NAME;
  if (!results.some((result) => result.toolName === read)) {
    if (!offered(options, read)) return speak(["I couldn't read this page just now.", SIMULATED_PLAYBOOK_NOTICE]);
    return { content: [call(read, {})], finishReason: { unified: "tool-calls", raw: undefined } };
  }
  return speak([...playbookAnswer(results), SIMULATED_PLAYBOOK_NOTICE]);
}

/** One write call, then what came of it: the drafted sentence, or the tool's refusal. */
function draftOnce(results: readonly ToolResultLike[], wanted: ToolCall, drafted: string): SimulatedStep {
  if (!results.some((result) => result.toolName === wanted.toolName)) {
    return { content: [wanted], finishReason: { unified: "tool-calls", raw: undefined } };
  }
  const done = resultFor<{ queued: boolean; refused?: string }>(results, wanted.toolName);
  if (done?.queued !== true) return speak([`I couldn't do that: ${done?.refused ?? "the page refused it."}`, SIMULATED_PLAYBOOK_NOTICE]);
  return speak([drafted, SIMULATED_PLAYBOOK_NOTICE]);
}

function playbookAnswer(results: readonly ToolResultLike[]): string[] {
  const day = resultFor<PlaybookReadout | { error: string }>(results, READ_PLAYBOOK_TOOL_NAME);
  if (day !== undefined && !("error" in day)) {
    const stops = day.days.flatMap((entry) => entry.stops.map((stop) => plain(stop.title)));
    const span = day.dayCount === 1 ? "" : ` over ${day.dayCount} days`;
    return [`${plain(day.name)} covers ${pluralStops(stops.length)}${span}${stops.length > 0 ? `: ${stops.join(", ")}` : ""}.`];
  }
  const listed = resultFor<{ days: { name: string }[] }>(results, SEARCH_THIS_PAGE_TOOL_NAME);
  if (listed !== undefined) {
    const names = listed.days.slice(0, MAX_NAMED_DAYS).map((entry) => plain(entry.name));
    return [`This page lists ${listed.days.length} playbook${listed.days.length === 1 ? "" : "s"}${names.length > 0 ? `, starting with ${names.join(", ")}` : ""}.`];
  }
  return ["I couldn't read this page just now."];
}

// A text step from a list of sentences: one message part, streamed sentence by
// sentence. Split into parts instead and every client that concatenates them
// reads "5 stops.They are:".
function speak(sentences: string[]): SimulatedStep {
  return {
    content: [{ type: "text", text: sentences.join(" ") }],
    finishReason: { unified: "stop", raw: undefined },
    textDeltas: sentences.map((sentence, i) => (i === sentences.length - 1 ? sentence : `${sentence} `)),
  };
}

/**
 * The switched-off model. One surface, so no parameter: /ask is the one AI route
 * (ADR-033 Decision 1) and every shape it serves is an ask turn.
 *
 * **No emission latch, and none is needed.** The command endpoint's branches
 * kept one, because the SDK loops until `stopWhen` fires and a model that
 * re-emitted the same tool calls every step composed once per remaining step —
 * settling every one of those round-trips against the actor's quota (KI-67) and
 * returning `truncated: true` on a page that was finished after the first step.
 * Every branch here instead reads the CONVERSATION to decide what it has
 * already done (`toolResultsOf`) and ends with a text step, which stops the loop
 * by itself. That is the stronger version of the same guarantee: it survives a
 * retry, where an instance flag does not.
 */
export function simulatedModel(): LanguageModel {
  const step = (options: CallOptionsLike): SimulatedStep => askTurn(options);

  return {
    specificationVersion: "v4",
    provider: "simulated",
    modelId: SIMULATED_MODEL_ID,
    supportedUrls: {},
    async doGenerate(options: CallOptionsLike) {
      const { content, finishReason } = step(options);
      return { content, finishReason, usage: NO_USAGE, warnings: [] };
    },
    async doStream(options: CallOptionsLike) {
      // Every turn streams. This used to throw for the command surfaces — a
      // loud seam marking that the command path never streamed — and ADR-033
      // deletes it rather than relaxing it: there is no command path left for
      // the seam to mark, and page authoring now arrives HERE.
      const { content, finishReason, textDeltas } = step(options);
      // Part order mirrors the SDK's own `simulateStreamingMiddleware`:
      // stream-start, then a start/deltas/end run per text part (tool calls
      // pass through whole), then finish.
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            let id = 0;
            for (const part of content) {
              if (part.type !== "text") {
                controller.enqueue(part);
                continue;
              }
              const textId = String(id++);
              controller.enqueue({ type: "text-start", id: textId });
              for (const delta of textDeltas ?? [part.text]) {
                controller.enqueue({ type: "text-delta", id: textId, delta });
              }
              controller.enqueue({ type: "text-end", id: textId });
            }
            controller.enqueue({ type: "finish", finishReason, usage: NO_USAGE });
            controller.close();
          },
        }),
      };
    },
  };
}
