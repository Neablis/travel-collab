import type { PageContext, PageDoc, PageMark, PageNode, TripDetail, TripGlobals } from "@tc/contracts";
import {
  renderMacro, repeatTemplate, resolveRepeat, sentenceLines,
  type ExternalInputs, type RenderOutcome, type TripNowClock, type UnboundNeeds, type WidgetContext,
} from "@tc/pages";
import { cityAccents } from "@/components/pages/cityAccents";
import type { AccentTable } from "@/components/pages/MacroView";
import { redactBookingFor } from "./bookingRedaction";

/**
 * What `/n/<token>` sends a reader with no session (M58, ADR-088 §3): the
 * page's title and document, **with every widget already resolved**, and
 * nothing else. Mitchell, on decision 5: *"a hidden widget's data is not sent
 * to the page"*. So no trip goes with it, and no widget's params: a hidden
 * instance is its name and `not-shared`, and every other one is what its
 * resolver answered for the public reader. A widget cannot leak what it was
 * never handed, and the browser is handed only answers.
 *
 * Three floors hold whatever a widget's `hideWhenPublic` says (ADR-088 §5),
 * because they are on what the resolvers read, not in the widgets:
 * - A booking goes through `redactBookingFor(null)` (ADR-086): provider only.
 * - There is no chat, and the public reader has no `canChat`.
 * - A stop's `addedBy` is emptied, and no member's name, look or guest list
 *   is handed in: actor ids and names identify real people. `bookedBy` and
 *   `participants` stay: the money widgets split by them (an empty list means
 *   "everyone"), and with no names handed in they print "Traveler N", never an id.
 *
 * Live, not pinned (ADR-088 §2), so there is no `seq` here, unlike `toSharedView`.
 */
export interface PublicNotebookView {
  title: string;
  content: readonly PublicDocNode[];
  /** Each city and day the resolved widgets name, and its accent (`PublicMacroView`). */
  accents: AccentTable;
}

/** A widget as the stranger's page gets it: its name, for its chips' words, and its outcome. */
export interface PublicWidgetNode {
  type: "macro";
  attrs: { name: string; outcome: RenderOutcome };
}

/**
 * A repeat as the stranger's page gets it: its lines, already written, or why
 * there are none. An unwritten sentence is no lines, as Reading draws it.
 */
export type PublicRepeatOutcome =
  | { status: "ok"; lines: readonly string[] }
  | { status: "empty"; emptyText: string }
  | { status: "unbound"; needs: UnboundNeeds }
  | { status: "invalid" }
  | { status: "not-shared" };

export interface PublicRepeatNode {
  type: "repeat";
  attrs: { name: string; outcome: PublicRepeatOutcome };
}

/** Every other node the page draws, with only the attrs it draws and its children made public too. Any node not drawn is dropped to its type. */
export type PublicDocNode =
  | PublicWidgetNode
  | PublicRepeatNode
  | { type: "unknown" }
  | { type: string; attrs?: Readonly<Record<string, unknown>>; text?: string; marks?: readonly PageMark[]; content?: readonly PublicDocNode[] };

export interface PublicNotebookInput {
  trip: TripDetail;
  globals: TripGlobals | null;
  page: { title: string; content: PageDoc; context: PageContext };
  /** The trip's notebooks and the weather, as a member's page would read them. Absent is pending. */
  external?: ExternalInputs;
  /** The live public link of a notebook, by id (`WidgetContext.publicTokenFor`, part 2's lookup). */
  publicTokenFor: (pageId: string) => string | null;
  today: string | null;
  now: TripNowClock | null;
}

/**
 * A public notebook as a stranger reads it: every widget resolved here, under
 * the public reader and on the floored trip, and only the answers returned.
 */
export function toPublicNotebookView(input: PublicNotebookInput): PublicNotebookView {
  const trip = floored(input.trip);
  const ctx: WidgetContext = {
    trip,
    page: input.page.context,
    user: null,
    globals: input.globals,
    today: input.today,
    now: input.now,
    // The notebook list stays here: a link card takes from it only what
    // `forStranger` lets through (a public token, or a plain title).
    external: input.external,
    people: null,
    personas: null,
    guests: null,
    reader: "public",
    canChat: false,
    chat: null,
    soloTrip: false,
    publicTokenFor: input.publicTokenFor,
  };
  const content = input.page.content.content.map((node) => publicNode(node, ctx));
  return { title: input.page.title, content, accents: accentsOf(trip, content) };
}

// The trip as the resolvers read it for a stranger: the floors applied.
function floored(trip: TripDetail): TripDetail {
  const redact = redactBookingFor(null);
  return {
    ...trip,
    activities: Object.fromEntries(
      Object.entries(trip.activities).map(([id, activity]) => [
        id,
        { ...activity, booking: redact(activity.booking), addedBy: null },
      ]),
    ),
  };
}

function publicNode(node: PageNode | { type: string }, ctx: WidgetContext): PublicDocNode {
  const stored = node as PageNode;
  switch (stored.type) {
    case "macro": {
      const { name, params, hideWhenPublic } = stored.attrs;
      const outcome = renderMacro(ctx, name, params, undefined, hideWhenPublic === true);
      // A parse error can quote the params it refused.
      return { type: "macro", attrs: { name, outcome: outcome.status === "bad-params" ? { status: "bad-params", message: "" } : outcome } };
    }
    case "repeat":
      return { type: "repeat", attrs: { name: stored.attrs.name, outcome: publicRepeat(ctx, stored.attrs) } };
    // Its `raw` is whatever a newer build stored, widgets and params included.
    case "unknown":
      return { type: "unknown" };
    default:
      return publicPlain(stored, ctx);
  }
}

// The nodes the public page draws, and the attrs it draws each with
// (`renderPublic`). Anything else is a bare `unknown`: a node type or an
// attr this list does not name never reaches the browser, so a future node that
// carries an id cannot leak by being forgotten here.
const PLAIN_NODES: Readonly<Record<string, readonly string[]>> = {
  text: [], hardBreak: [], paragraph: [], blockquote: [], bulletList: [], listItem: [],
  codeBlock: [], horizontalRule: [], heading: ["level"], orderedList: ["start"],
};

function publicPlain(stored: PageNode, ctx: WidgetContext): PublicDocNode {
  if (!Object.hasOwn(PLAIN_NODES, stored.type)) return { type: "unknown" };
  const keep = PLAIN_NODES[stored.type]!;
  const node = stored as { attrs?: Record<string, unknown>; text?: string; marks?: readonly PageMark[]; content?: readonly PageNode[] };
  const attrs = Object.fromEntries(keep.filter((key) => node.attrs?.[key] !== undefined).map((key) => [key, node.attrs![key]]));
  return {
    type: stored.type,
    ...(keep.length > 0 && { attrs }),
    ...(node.text !== undefined && { text: node.text }),
    ...(node.marks && { marks: node.marks }),
    ...(node.content && { content: node.content.map((child) => publicNode(child, ctx)) }),
  };
}

function publicRepeat(ctx: WidgetContext, attrs: { name: string; params: Record<string, unknown>; hideWhenPublic?: boolean }): PublicRepeatOutcome {
  const outcome = resolveRepeat(ctx, attrs.name, attrs.params, attrs.hideWhenPublic === true);
  if (outcome.status === "not-shared") return outcome;
  const template = repeatTemplate(attrs.params);
  if (template === "") return { status: "ok", lines: [] };
  switch (outcome.status) {
    case "ok":
      return { status: "ok", lines: sentenceLines(ctx, outcome.over, outcome.items, template) };
    case "empty":
      return { status: "empty", emptyText: outcome.emptyText };
    case "unbound":
      return { status: "unbound", needs: outcome.needs };
    case "invalid":
      return { status: "invalid" };
  }
}

// The accents of only the cities and days the page shows: a full table would
// list every city on the trip, hidden widgets' included. Any string in a
// resolved outcome that is a city or a day id is one the page shows.
function accentsOf(trip: TripDetail, content: readonly PublicDocNode[]): AccentTable {
  const accents = cityAccents(trip);
  const dayIds = new Set(trip.days.map((day) => day.dayId));
  const cities: Record<string, AccentTable["cities"][string]> = {};
  const days: Record<string, AccentTable["days"][string]> = {};
  for (const value of stringsIn(content)) {
    if (dayIds.has(value)) days[value] = accents.ofDayId(value);
    const family = accents.ofCity(value);
    if (family !== "neutral") cities[value] = family;
  }
  return { cities, days };
}

function* stringsIn(value: unknown): Generator<string> {
  if (typeof value === "string") yield value;
  else if (Array.isArray(value)) for (const item of value) yield* stringsIn(item);
  else if (typeof value === "object" && value !== null) for (const item of Object.values(value)) yield* stringsIn(item);
}
