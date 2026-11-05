import { z } from "zod";
import type { MacroDef, PollPayload, WidgetContext } from "../../registry-types";
import { blockOf } from "../../registry-types";
import { empty, needsTrip, ok, type MacroResult } from "../../result";

// `poll` — "Poll" (M58 decision 8, ADR-088 §8): a question for the people
// going. **A registered widget, not a primitive**, for `trip.people`'s reason:
// there is no entity to narrow.
//
// The question and the options are params, so writing a poll is a notebook
// edit. The votes are not: they are `poll_votes`, read by the block live for a
// member and handed in as counts (`WidgetContext.pollTallies`) for a stranger.
// Nothing here knows who voted.

const MOST_OPTIONS = 12;
const OPTION_LENGTH = 80;
const QUESTION_LENGTH = 200;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

// Every field is read leniently, because the editor's text boxes store what was
// typed and `poll` judges it below: a half-written poll is `empty`, not a
// widget whose settings "no longer fit it". `pollId` is the one exception, and
// it is NOT defaulted here: `renderMacro` parses on every read, so a default
// would give a stored poll without an id a new one each time and its votes
// would never be found. It is minted once, by `seed` when the widget is
// inserted; a node that has none is not a poll yet (`pollSpecOf`).
//
// `options` is a list of `{ id, label }`: the vote stores the id, so renaming an
// option keeps its votes (decision 8). The comma-separated text a first build
// stored is still read, each label being its own id.
//
// **The same poll id twice on one trip is one poll** (a pasted copy of the
// widget shows, and votes into, the same poll), by design: votes and closes are
// keyed by trip and poll id, so a copy on ANOTHER trip is a poll of its own.
const PollOptionRow = z.object({ id: z.string(), label: z.string() });
const PollParams = z.object({
  pollId: z.string().uuid().optional(),
  question: z.string().optional(),
  options: z.union([z.string(), z.array(PollOptionRow)]).optional(),
  multi: z.boolean().optional(),
  closesAt: z.string().optional(),
});
type PollParams = z.infer<typeof PollParams>;

/** What a poll is, once its text is read: the part both the block and the vote route need. */
export interface PollSpec {
  pollId: string;
  question: string;
  /** The id is the option's own, kept when its label is edited; the vote stores it. */
  options: { id: string; label: string }[];
  multi: boolean;
  /** `yyyy-mm-dd`, the last day votes are taken. */
  closesAt: string | null;
  hideWhenPublic: boolean;
}

function optionsOf(raw: PollParams["options"]): PollSpec["options"] {
  const rows = typeof raw === "string" ? raw.split(",").map((label) => ({ id: label.trim(), label })) : (raw ?? []);
  const seen = new Set<string>();
  const options: PollSpec["options"] = [];
  for (const row of rows) {
    const id = row.id.trim().slice(0, OPTION_LENGTH);
    const label = row.label.trim().slice(0, OPTION_LENGTH);
    // A row not yet typed into is not an option; a repeated id is one option.
    if (id === "" || label === "" || seen.has(id)) continue;
    seen.add(id);
    options.push({ id, label });
  }
  return options.slice(0, MOST_OPTIONS);
}

/** `null` when the text does not make a poll yet: no id, no question, or fewer than two options. */
export function pollSpecOf(raw: unknown, hideWhenPublic = false): PollSpec | null {
  const parsed = PollParams.safeParse(raw);
  if (!parsed.success) return null;
  const { pollId, question, options, multi, closesAt } = parsed.data;
  const asked = (question ?? "").trim().slice(0, QUESTION_LENGTH);
  const listed = optionsOf(options);
  if (pollId === undefined || asked === "" || listed.length < 2) return null;
  return {
    pollId,
    question: asked,
    options: listed,
    multi: multi === true,
    closesAt: closesAt !== undefined && DAY.test(closesAt.trim()) ? closesAt.trim() : null,
    hideWhenPublic,
  };
}

/**
 * Whether votes are no longer taken: an editor closed it, or `today` is past
 * its closing date (which is itself still open). `today` is passed in, as
 * everywhere in this package; `yyyy-mm-dd` strings order as dates do.
 */
export function pollClosed(closesAt: string | null, closedByHand: boolean, today: string): boolean {
  return closedByHand || (closesAt !== null && today > closesAt);
}

/**
 * Every poll in a stored document, nested ones too. Reads the stored shape
 * directly rather than a parsed document, so the vote route and the public
 * page see the polls of a page a newer build wrote.
 */
export function pollsIn(doc: unknown, into: PollSpec[] = []): PollSpec[] {
  if (typeof doc !== "object" || doc === null) return into;
  const node = doc as { type?: unknown; attrs?: { name?: unknown; params?: unknown; hideWhenPublic?: unknown }; content?: unknown };
  if (node.type === "macro" && node.attrs?.name === "poll") {
    const spec = pollSpecOf(node.attrs.params, node.attrs.hideWhenPublic === true);
    if (spec !== null) into.push(spec);
  }
  if (Array.isArray(node.content)) for (const child of node.content) pollsIn(child, into);
  return into;
}

type PollNode = { type?: unknown; attrs?: { name?: unknown; params?: unknown }; content?: unknown };

const isPollNode = (n: PollNode): boolean => n.type === "macro" && n.attrs?.name === "poll";

/** A poll node's params; `{}` for a node that has none, which is still a poll (it can be minted an id). */
const paramsOfNode = (n: PollNode): Record<string, unknown> =>
  typeof n.attrs?.params === "object" && n.attrs.params !== null ? (n.attrs.params as Record<string, unknown>) : {};

/** Every poll node in a document, nested ones too: the one place that decides what counts as a poll. */
function pollNodesIn(doc: unknown, into: PollNode[] = []): PollNode[] {
  if (Array.isArray(doc)) {
    for (const child of doc) pollNodesIn(child, into);
    return into;
  }
  if (typeof doc !== "object" || doc === null) return into;
  const node = doc as PollNode;
  if (isPollNode(node)) into.push(node);
  pollNodesIn(node.content, into);
  return into;
}

/** A question as a match key; `null` when there is none to match on. */
function questionKey(params: Record<string, unknown>): string | null {
  const q = typeof params.question === "string" ? params.question.trim() : "";
  return q === "" ? null : q;
}

/**
 * A document with an id for every poll that has none (M58 D6). The widget
 * insert mints it, but the assistant and the v1 API write the node themselves,
 * and a poll with no id cannot be voted on. An id already there is never
 * replaced, so saving the same page twice is a no-op. An id already used by
 * another poll is kept too: a pasted copy is the same poll, by design (D4, D13).
 *
 * A client that round-trips a page may drop the id (an agent rewriting a poll
 * from its question and options). Blocks carry no identity, so a poll with no
 * id takes the `held` page's id only when the match is unambiguous: exactly one
 * held poll and exactly one id-less incoming poll have that (trimmed) question,
 * and the id is not already carried by another incoming poll. Every other case
 * mints. Position is never used: a lost vote is better than one that lands on
 * a different question. `mint` is passed in: this package draws no randomness
 * of its own in a resolver.
 */
export function withPollIds<T>(doc: T, mint: () => string, held: unknown = null): T {
  const claimed = new Set<string>();
  const stripped = new Map<string, number>();
  for (const node of pollNodesIn(doc)) {
    const params = paramsOfNode(node);
    if (params.pollId !== undefined) {
      if (typeof params.pollId === "string") claimed.add(params.pollId);
      continue;
    }
    const key = questionKey(params);
    if (key !== null) stripped.set(key, (stripped.get(key) ?? 0) + 1);
  }
  const heldIds = new Map<string, string[]>();
  for (const node of pollNodesIn(held)) {
    const params = paramsOfNode(node);
    const key = questionKey(params);
    if (key === null || typeof params.pollId !== "string") continue;
    heldIds.set(key, [...(heldIds.get(key) ?? []), params.pollId]);
  }
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (typeof node !== "object" || node === null) return node;
    const n = node as PollNode;
    const content = Array.isArray(n.content) ? { content: walk(n.content) } : {};
    if (!isPollNode(n)) return { ...n, ...content };
    const params = paramsOfNode(n);
    if (params.pollId !== undefined) return { ...n, ...content };
    const key = questionKey(params);
    const candidates = key === null ? [] : (heldIds.get(key) ?? []);
    const only = candidates.length === 1 && stripped.get(key as string) === 1 ? candidates[0]! : null;
    const id = only !== null && !claimed.has(only) ? only : mint();
    claimed.add(id);
    return { ...n, ...content, attrs: { ...n.attrs, params: { ...params, pollId: id } } };
  };
  return walk(doc) as T;
}

/** What a member's vote sends: the option ids picked, one unless the poll lets people pick more. */
export const PollVoteBody = z.object({ optionIds: z.array(z.string().min(1).max(OPTION_LENGTH)).min(1).max(MOST_OPTIONS) });
export type PollVoteBody = z.infer<typeof PollVoteBody>;

/**
 * What the poll route answers a member (GET, and after a vote, a close or a reopen):
 * **named**, since the group knows each other. A stranger never gets this: the
 * public page is handed counts through `WidgetContext.pollTallies` instead.
 * `votes` has one entry per person who voted; `mine` is the reader's own pick.
 */
export const PollResults = z.object({
  closed: z.boolean(),
  counts: z.record(z.string(), z.number()),
  votes: z.array(z.object({ userId: z.string(), optionIds: z.array(z.string()) })),
  mine: z.array(z.string()),
  /** Whether the reader may close or reopen it: the server's answer, since the notebook screen holds no role to ask. */
  canClose: z.boolean(),
  /** Whether its `closesAt` day is past, so a reopen would change nothing until the date is moved. */
  datePassed: z.boolean(),
});
export type PollResults = z.infer<typeof PollResults>;

export const poll: MacroDef<PollParams, PollPayload> = {
  name: "poll",
  title: "Poll",
  shape: "block",
  params: PollParams,
  inputs: [
    { name: "question", type: "text", label: "Question", placeholder: "Where should we eat?" },
    { name: "options", type: "list", label: "Options", placeholder: "An option" },
    { name: "multi", type: "toggle", label: "Let people pick more than one", default: false },
    { name: "closesAt", type: "text", label: "Last day to vote", placeholder: "yyyy-mm-dd" },
  ],
  selection: undefined,
  // The one id the schema leaves out: minted here, once, and stored with the node.
  // Two blank options, so the settings open with two rows to type into.
  seed: (params) => ({
    ...params,
    pollId: params.pollId ?? crypto.randomUUID(),
    options: params.options ?? [{ id: crypto.randomUUID(), label: "" }, { id: crypto.randomUUID(), label: "" }],
  }),
  description:
    "A poll for the people going: a question and its `options`, a list of `{ id, label }` (the id stays when the label is edited, so votes are kept). Every traveler votes once and can change it until an editor closes the poll or its `closesAt` day (yyyy-mm-dd) passes. Members see who voted for what; the public page shows only counts.",
  emptyText: "add a question and two options",
  // Fixed, never computed (ADR-037 decision 5): nobody's words.
  preview: "a question with options to vote on",
  resolve: (ctx: WidgetContext, params): MacroResult<PollPayload> => {
    // Votes belong to a trip, so a notebook with none has nothing to ask.
    if (!ctx.trip) return needsTrip();
    const spec = pollSpecOf(params);
    if (spec === null) return empty();
    const base = { kind: "poll" as const, question: spec.question, options: spec.options, multi: spec.multi, closesAt: spec.closesAt };
    if (ctx.reader !== "public") return ok({ ...base, pollId: spec.pollId, counts: null, closed: null });
    // A stranger gets counts and nothing that names a poll, a person or a way to vote.
    const tally = ctx.pollTallies?.[spec.pollId];
    const counts = Object.fromEntries(spec.options.map((o) => [o.id, tally?.counts[o.id] ?? 0]));
    return ok({ ...base, pollId: null, counts, closed: tally?.closed ?? false });
  },
  render: blockOf,
};
