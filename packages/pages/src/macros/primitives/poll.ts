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
// widget whose settings "no longer fit it". `pollId` is the one exception. It
// is minted when the widget is inserted (the schema's default runs in
// `insertWidget`, whose parsed params are what is stored), and names the poll
// for its votes for as long as the node lives.
const PollParams = z.object({
  pollId: z.string().uuid().default(() => crypto.randomUUID()),
  question: z.string().optional(),
  options: z.string().optional(),
  multi: z.boolean().optional(),
  closesAt: z.string().optional(),
});
type PollParams = z.infer<typeof PollParams>;

/** What a poll is, once its text is read: the part both the block and the vote route need. */
export interface PollSpec {
  pollId: string;
  question: string;
  /** The id is the label: the vote stores it, so editing a poll keeps the votes of every option it still has. */
  options: { id: string; label: string }[];
  multi: boolean;
  /** `yyyy-mm-dd`, the last day votes are taken. */
  closesAt: string | null;
  hideWhenPublic: boolean;
}

/** `null` when the text does not make a poll yet: no question, or fewer than two distinct options. */
export function pollSpecOf(raw: unknown, hideWhenPublic = false): PollSpec | null {
  const parsed = PollParams.safeParse(raw);
  if (!parsed.success) return null;
  const { pollId, question, options, multi, closesAt } = parsed.data;
  const labels = [...new Set((options ?? "").split(",").map((o) => o.trim().slice(0, OPTION_LENGTH)).filter((o) => o !== ""))];
  const asked = (question ?? "").trim().slice(0, QUESTION_LENGTH);
  if (asked === "" || labels.length < 2) return null;
  return {
    pollId,
    question: asked,
    options: labels.slice(0, MOST_OPTIONS).map((label) => ({ id: label, label })),
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

/** What a member's vote sends: the option ids picked, one unless the poll lets people pick more. */
export const PollVoteBody = z.object({ optionIds: z.array(z.string().min(1).max(OPTION_LENGTH)).min(1).max(MOST_OPTIONS) });
export type PollVoteBody = z.infer<typeof PollVoteBody>;

/**
 * What the poll route answers a member (GET, and after a vote or a close):
 * **named**, since the group knows each other. A stranger never gets this: the
 * public page is handed counts through `WidgetContext.pollTallies` instead.
 * `votes` has one entry per person who voted; `mine` is the reader's own pick.
 */
export const PollResults = z.object({
  closed: z.boolean(),
  counts: z.record(z.string(), z.number()),
  votes: z.array(z.object({ userId: z.string(), optionIds: z.array(z.string()) })),
  mine: z.array(z.string()),
  /** Whether the reader may close it: the server's answer, since the notebook screen holds no role to ask. */
  canClose: z.boolean(),
});
export type PollResults = z.infer<typeof PollResults>;

export const poll: MacroDef<PollParams, PollPayload> = {
  name: "poll",
  title: "Poll",
  shape: "block",
  params: PollParams,
  inputs: [
    { name: "question", type: "text", label: "Question", placeholder: "Where should we eat?" },
    { name: "options", type: "text", label: "Options", placeholder: "Ramen, Sushi, Tempura" },
    { name: "multi", type: "toggle", label: "Let people pick more than one", default: false },
    { name: "closesAt", type: "text", label: "Last day to vote", placeholder: "yyyy-mm-dd" },
  ],
  selection: undefined,
  description:
    "A poll for the people going: a question and options (comma-separated in `options`). Every traveler votes once and can change it until an editor closes the poll or its `closesAt` day (yyyy-mm-dd) passes. Members see who voted for what; the public page shows only counts.",
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
