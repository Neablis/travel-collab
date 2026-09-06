import { newPageDoc } from "@tc/contracts";
import type {
  CreatePageInput,
  PageContext,
  PageDoc,
  PageHeadingNode,
  PageInlineNode,
  PageNode,
  PageParagraphNode,
  PageTextNode,
  PageWidgetNode,
} from "@tc/contracts";

// The notebook template library.
//
// Typed against the AST rather than returning bare object literals (ADR-038).
// These are the oldest producers of stored page content in the repo, and until
// the write path became `PageDoc` nothing checked that what they seed is
// something the editor can open. Now a template that drifts out of the
// vocabulary fails to compile, which is where that should fail.
//
// --- Widgets are back in the seeds (2026-09-06) ---
// This file used to carry a note saying seeded templates "no longer plant macro
// nodes a reader can't add, edit, or remove themselves" — true when it was
// written, in the window between M8 taking macro authoring off the editing
// surface and M14 putting it back. It is not true now: the slash menu, the
// widget picker, drag-and-drop and the chrome row all exist
// (`components/pages/editor/`), so every widget below is one a reader can add,
// rebind or delete by hand. Removing the constraint is what makes a template
// worth having — "Costs, broken down" as a widget stays true when a stop moves;
// as a prompt to write a table it is stale by the second day.
//
// --- Two lists, and the split is the point ---
// `DEFAULT_TEMPLATES` is what a new trip is SEEDED with; `TEMPLATE_LIBRARY` is
// what the gallery OFFERS. The first is a subset of the second, and it stays
// small deliberately: a library that plants every entry in every trip stops
// being a library at about four entries, and `pages_system_seed_unique` makes
// each seeded title a permanent fixture of that trip's index.

const heading = (text: string, level: 1 | 2 | 3 = 2): PageHeadingNode => ({
  type: "heading",
  attrs: { level },
  content: [{ type: "text", text }],
});
const para = (...content: PageInlineNode[]): PageParagraphNode => ({ type: "paragraph", content });
const text = (t: string): PageTextNode => ({ type: "text", text: t });

/**
 * A widget, as the document stores it.
 *
 * **Every macro node is an INLINE atom** — `MacroNodeExtension` declares
 * `group: "inline"` — so even a block-shaped widget like `day.detail` lives
 * inside a paragraph rather than beside one. `block()` below is the ordinary
 * case (a widget on a line of its own); putting one mid-sentence is what
 * `para(text("…"), widget(…))` is for, and both are legal.
 *
 * **Params are not validated here.** `insertWidget` is the one door
 * (ADR-037 decision 4) and it returns a refusal rather than throwing — which is
 * right for a picker and wrong for a module-level constant, where a throw would
 * white-screen every surface that imports this file. So the shape is checked by
 * the compiler and the PARAMS are checked by `templates.test.ts`, which runs
 * every widget below through `insertWidget` and fails on any refusal.
 */
const widget = (name: string, params: Record<string, unknown> = {}): PageWidgetNode => ({
  type: "macro",
  attrs: { name, params },
});
const block = (name: string, params: Record<string, unknown> = {}): PageParagraphNode =>
  para(widget(name, params));

const rule = (): PageNode => ({ type: "horizontalRule" });

const bullets = (...items: string[]): PageNode => ({
  type: "bulletList",
  content: items.map((item) => ({ type: "listItem" as const, content: [para(text(item))] })),
});

export interface TemplateSeed {
  key: string;
  title: string;
  /**
   * The gallery card's second line.
   *
   * On the SEED rather than in a lookup table beside the gallery, which is
   * where it lived (`STARTER_DESCRIPTIONS` in `NotebookScreen.tsx`, keyed by
   * template key). A map in the component silently returns `""` for a template
   * it has not heard of — so adding one here shipped a card with a title and a
   * blank line under it, and nothing failed. Making it a required field means a
   * template without a description does not compile.
   */
  description: string;
  /**
   * Whether every new trip is seeded with this one, or it is only offered in
   * "Start from a template".
   *
   * See the header: the seeded set stays small on purpose.
   */
  seedIntoNewTrips: boolean;
  buildContext(tripId: string): PageContext;
  content: PageDoc;
}

// ---------------------------------------------------------------------------
// Seeded into every trip
// ---------------------------------------------------------------------------

const tripOverview: TemplateSeed = {
  key: "trip-overview",
  title: "Trip Overview",
  description: "The whole trip in one place — the why, the shape, the money.",
  seedIntoNewTrips: true,
  buildContext: (tripId) => ({ tripId }),
  content: newPageDoc([
    heading("Overview"),
    para(text("What's this trip about? Jot down the highlights, the why, who's coming.")),
    // The three facts that answer "what trip is this" without anybody typing
    // them, and that stay right when the dates move. Unbound on purpose: no
    // day filter means the whole trip, which is what makes this template work
    // in any trip it is started from.
    block("dates"),
    block("city"),
    heading("The shape of it"),
    para(text("Sketch the arc — arrival, the days that matter, departure.")),
    block("day.rows"),
    heading("Money"),
    para(text("What is worth spending on, and what isn't.")),
    block("attribute", { field: "trip.budgetRemaining" }),
    block("cost.rows"),
  ]),
};

const dayOverview: TemplateSeed = {
  key: "day-overview",
  // Renamed from "Day Sheet" (2026-09-06). M14 link 6 left renaming the seeds
  // to this file, and the gallery card takes its name from the seed rather than
  // from SPEC §7, so the card and the notebook it creates still agree. Nothing
  // migrates: `listPages` seeds only into a trip with zero pages, so a trip
  // that already has a "Day Sheet" keeps it under its own name.
  title: "Day overview",
  description: "One day, close up. What's booked, what it costs, what's still loose.",
  seedIntoNewTrips: true,
  buildContext: (tripId) => ({ tripId }),
  content: newPageDoc([
    heading("The day"),
    para(text("Point the widgets below at a day — click one, then pick the day from its chrome row. Unpointed they read the whole trip, which is also a fine way to use this page.")),
    block("hours"),
    block("cost"),
    heading("Every stop"),
    block("day.detail"),
    heading("Still to sort"),
    para(text("What is not booked yet, and who is chasing it.")),
    block("stop.rows", { kind: "hold" }),
  ]),
};

// ---------------------------------------------------------------------------
// Offered in the gallery only
// ---------------------------------------------------------------------------

const fullTripBreakdown: TemplateSeed = {
  key: "full-trip-breakdown",
  title: "Full trip breakdown",
  description: "Every day, every city and every cost, laid out end to end.",
  seedIntoNewTrips: false,
  buildContext: (tripId) => ({ tripId }),
  content: newPageDoc([
    heading("The whole trip", 1),
    para(
      text("This page is built out of widgets, so it is never out of date — move a stop on the board and it moves here."),
    ),
    block("dates"),
    para(text("Days: "), widget("count", { of: "day" }), text(" · Stops: "), widget("count"), text(" · Cities: "), widget("count", { of: "city" })),
    rule(),
    heading("Where it goes"),
    block("city.detail"),
    rule(),
    heading("Day by day"),
    block("day.detail"),
    rule(),
    heading("What it costs"),
    block("attribute", { field: "trip.budgetRemaining" }),
    block("cost.rows"),
    heading("Notes"),
    para(text("Anything the plan cannot carry: why a day is shaped the way it is, what to do if the weather turns, what you would cut first.")),
  ]),
};

const dinnerTracker: TemplateSeed = {
  key: "dinner-tracker",
  title: "Dinner tracker",
  description: "Every meal on the trip, what it costs, and which ones still need a table.",
  seedIntoNewTrips: false,
  buildContext: (tripId) => ({ tripId }),
  content: newPageDoc([
    heading("Eating", 1),
    para(
      text("Tag a stop "),
      text("meal"),
      text(" on the board and it appears here. Nothing on this page is typed twice."),
    ),
    para(text("Meals planned: "), widget("count", { tag: "meal" }), text(" · Booked: "), widget("count", { tag: "meal", kind: "booked" })),
    heading("Booked"),
    para(text("Tables that exist. Confirmation numbers go in the stop's notes, not here.")),
    block("stop.rows", { tag: "meal", kind: "booked" }),
    heading("Still to book"),
    para(text("The ones that need a phone call. A restaurant that takes reservations a month out is a stop that should be booked, not held.")),
    block("stop.rows", { tag: "meal", kind: "hold" }),
    heading("Ideas"),
    para(text("Places somebody mentioned. Move one onto a day when it earns a slot.")),
    block("stop.rows", { tag: "meal", kind: "idea" }),
    heading("What eating costs"),
    block("cost", { tag: "meal" }),
    block("cost.rows", { tag: "meal" }),
  ]),
};

const bookingsAndConfirmations: TemplateSeed = {
  key: "bookings-and-confirmations",
  title: "Bookings",
  description: "Everything that is confirmed, in one list — flights, rooms, tickets, tables.",
  seedIntoNewTrips: false,
  buildContext: (tripId) => ({ tripId }),
  content: newPageDoc([
    heading("Confirmed", 1),
    para(text("Booked: "), widget("count", { kind: "booked" }), text(" of "), widget("count"), text(" stops.")),
    block("stop.rows", { kind: "booked" }),
    heading("Where we sleep"),
    para(text("Every stop tagged lodging, in order. A gap between two rooms is a night nobody has booked.")),
    block("stop.rows", { tag: "lodging" }),
    heading("Getting between places"),
    block("stop.rows", { kind: "transit" }),
    heading("Not booked yet"),
    para(text("On hold — held in the plan, not held by anybody.")),
    block("stop.rows", { kind: "hold" }),
    heading("What is already paid for"),
    block("cost", { kind: "booked" }),
  ]),
};

const beforeYouGo: TemplateSeed = {
  key: "before-you-go",
  title: "Before you go",
  description: "The list that stops a trip starting badly — packing, documents, the first day.",
  seedIntoNewTrips: false,
  buildContext: (tripId) => ({ tripId }),
  content: newPageDoc([
    heading("Leaving", 1),
    para(text("Flying from "), widget("attribute", { field: "account.homeAirport" }), text(" on "), widget("dates"), text(".")),
    heading("Documents"),
    bullets(
      "Passport — check the expiry against the return date, not the outbound one.",
      "Visa or entry authorisation, and the printout if the border wants paper.",
      "Travel insurance policy number, somewhere reachable without signal.",
      "Driving licence and the international permit, if anybody is driving.",
    ),
    heading("Packing"),
    para(text("Write the list once and it is yours for every trip after this one.")),
    bullets(
      "Whatever the weather actually does, not what the average says.",
      "Chargers and one adapter per person who will not share.",
      "The medication that is hard to buy where you are going.",
    ),
    heading("The first day"),
    para(text("Arriving tired is the single most common way a good plan comes apart. What is already booked for day one:")),
    block("day.detail", { day: { kind: "index", index: 0 }, kind: "booked" }),
    heading("Money"),
    para(text("Budget left before you spend anything: "), widget("attribute", { field: "trip.budgetRemaining" }), text(".")),
  ]),
};

/**
 * Everything the "Start from a template" gallery offers, in the order it offers
 * it: the two seeded ones first — a returning reader recognises them from their
 * own trips — then the rest.
 */
export const TEMPLATE_LIBRARY: TemplateSeed[] = [
  tripOverview,
  dayOverview,
  fullTripBreakdown,
  dinnerTracker,
  bookingsAndConfirmations,
  beforeYouGo,
];

/**
 * The templates a new trip is seeded with, on its first visit to the index.
 *
 * Derived from the library rather than listed again, so the two cannot disagree
 * about which templates exist. Order follows `TEMPLATE_LIBRARY`, which is what
 * `listPages` backdates its seeds against.
 */
export const DEFAULT_TEMPLATES: TemplateSeed[] = TEMPLATE_LIBRARY.filter((t) => t.seedIntoNewTrips);

export function instantiateDefaults(tripId: string): CreatePageInput[] {
  return DEFAULT_TEMPLATES.map((t) => ({ title: t.title, context: t.buildContext(tripId), content: t.content }));
}

/** One template, by key — what the gallery's "Use this" button instantiates. */
export function getTemplate(key: string): TemplateSeed | undefined {
  return TEMPLATE_LIBRARY.find((t) => t.key === key);
}
