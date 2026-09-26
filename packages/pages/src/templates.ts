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
// --- Widgets are back — in the templates you CHOOSE, not the ones you are given ---
// This file used to carry a note saying seeded templates "no longer plant macro
// nodes a reader can't add, edit, or remove themselves" — true when it was
// written, in the window between M8 taking macro authoring off the editing
// surface and M14 putting it back. It is out of date now: the slash menu, the
// widget picker, drag-and-drop and the chrome row all exist
// (`components/pages/editor/`), so a template CAN plant a widget a reader is
// able to rebind or delete by hand, and the templates below do.
//
// **The rule that governs which widgets a SEEDED page may carry, and it is
// narrower than it used to be:**
//
//   *A widget that reads well on an empty trip may be seeded. One that does
//   not, may not.*
//
// This used to be the blunter "seeded templates plant no widgets", on the
// grounds that a brand-new trip has no dates, no cities and no stops, so a
// widget-bearing page opens as five grey "no dates set" chips — the honest
// empty state and a poor first page. What it never actually said was "no
// widgets": it said "nothing that looks broken before there is a plan".
//
// **What "reads well" means, since SPEC §36.10b (2026-09-26):** *an empty line
// that says what fills it reads well.* "add a day to see this", "no dates set
// yet" and "nothing is waiting on you" all qualify — each tells a new trip's
// reader what the line becomes — and the page's own prose is written so they
// read as a promise ("Everything below … fills in as it grows"). What still
// does not qualify: `unbound` (a chip asking for a binding the seeded page
// never made), a blank chip, and anything that cannot say a word until a third
// party answers (`day.weather`). `templates.test.ts` renders every seeded
// widget against a brand-new trip, before and after its globals land, to hold
// exactly that line.
//
// **Until 2026-09-12 two templates were seeded and neither carried a widget.**
// Now exactly one is — the Overview (§25, and Mitchell: *"Only 1 notebook per
// trip is always generated"*) — and Trip Overview and Day overview are gallery
// templates. Nothing migrates: `listPages` seeds only into a trip with zero
// pages, so every existing trip keeps both, under their own names, as ordinary
// deletable pages.
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

/**
 * **The Overview page — SPEC §25.** The one page every trip comes with, and the
 * one it cannot delete.
 *
 * > Not a dashboard, and not a second rendering of the trip. Every trip is
 * > created with one notebook page it cannot delete, and the Overview tab
 * > renders that page.
 *
 * Three things make it what it is, and all three are visible right here:
 *
 * 1. **`kind: "overview"` in its context** is what marks it. Not its title,
 *    which a reader may rename, and not its position, which sorting decides.
 * 2. **Its blocks are ordinary registry widgets** — every one is in the picker
 *    like everything else, and could be inserted into any other page. §25 is
 *    explicit that there is no bespoke Overview layout.
 * 3. **It is headings, a few joining lines, and widgets that read well
 *    empty** — the header's rule. On a trip created a minute ago every widget
 *    here says in words what will fill it, so the page reads as a list of what
 *    it is about to become rather than a row of grey chips.
 *
 * §25's *"The consequence to accept"* applies and is not worked around: because
 * this is a real page, its content is user-editable, and someone can empty it.
 * Guaranteeing a block would have to be a property of the page (undeletable
 * blocks), not of the tab.
 */
const overviewPage: TemplateSeed = {
  key: "overview",
  title: "Overview",
  // §25's index line: *"titled 'Overview / Comes with the trip'"*. The title is
  // the first half; this is the second, and it is where the gallery and the
  // index already put a template's second line.
  description: "Comes with the trip.",
  seedIntoNewTrips: true,
  buildContext: (tripId) => ({ tripId, kind: "overview" }),
  // **Rewritten 2026-09-26 from SPEC §36.10b, as inspiration rather than a
  // copy** (Mitchell: *"better but not great … use it for inspiration not just
  // copy"*). What was kept from the design: one column, a line of prose only
  // where it tells you something the heading does not, registry widgets only,
  // and no trip name, dates, counts or money totals — `TripHeader` already
  // shows every one of those above this page (its title, `TripMetaPill` and
  // `BudgetChip`), and saying them twice is rule 4's duplication.
  //
  // **Order is short-and-actionable first, the long reference last.** The old
  // page put `day.detail` in the middle, so on a two-week trip everything under
  // it sat fourteen cards down. What needs a decision comes first, then the
  // practical and the money glances, then the day-by-day read.
  //
  // What the design had and this does not, and why, is in the commit message
  // that made this change rather than here — this comment describes the page,
  // not its drafts. The short version: weather is left for a person to choose
  // (it sends the trip's places to third parties, KI-2026-09-24-o, and cannot
  // say anything until the forecast lands); `city.detail` repeats what the strip
  // and the day cards already say; the stats line and money sentence are the
  // header's; there is no "booked" line since M28 (ADR-054).
  //
  // Every widget below says something readable on a trip created a minute ago
  // — "no dates set yet", "add a day to see this", "nothing is waiting on you" —
  // and `templates.test.ts` renders each one against that trip to hold it.
  content: newPageDoc([
    // ---- The hook -------------------------------------------------------
    // The one fact about a trip that changes every day and that the header
    // does not show. A label rather than a sentence around it, because the
    // countdown's values do not share a verb: "in 34 days", "day 6 of 14",
    // "ended yesterday", "no dates set yet" all read after "Countdown:" and no
    // single "Your trip starts …" survives all four. The second sentence is
    // what makes a new trip's empty lines read as a promise instead of a
    // fault, and it stays true when the trip is full.
    para(
      text("Countdown: "),
      widget("attribute", { field: "trip.countdown" }),
      text(". Everything below reads from the plan and fills in as it grows."),
    ),
    // The route at a glance, in city colours — where the old page spent a
    // heading and a table (`city.detail`) saying the same thing in rows.
    block("trip.strip"),
    // ---- What to do next -------------------------------------------------
    // First, because it is the reason to open the page rather than a tab.
    heading("What needs you"),
    block("open"),
    // ---- What is still loose ----------------------------------------------
    // The `still-to-book` preset — `needsBooking`, the rule Calendar's "N to
    // book" and the Home hero share — rather than a hand-written
    // `kind: "pending"`, so this list cannot disagree with them if the rule
    // grows. The line says how a stop gets here, which on a new trip is the
    // only thing worth saying about an empty list.
    heading("Still to book"),
    para(text("Anything marked Pending waits here until it's settled.")),
    block("stop.rows", { only: "needsBooking" }),
    // ---- Before you go ---------------------------------------------------
    // What a traveller checks in the week before leaving. "Clocks:" is a label
    // for the same reason "Countdown:" is: `day.fromHome`'s empty reasons
    // ("set a home airport in Account to see this") are not a clause.
    heading("Before you go"),
    para(text("Clocks: "), widget("day.fromHome"), text(".")),
    block("country.facts"),
    // ---- Money -----------------------------------------------------------
    // The header already has spent and left, so this is the one money view it
    // does not: which days cost what, against an even pace for the budget.
    heading("Spend by day"),
    block("cost.chart"),
    // ---- The trip itself -------------------------------------------------
    // Last because it is the longest, not because it matters least: this is
    // the read the deleted Timeline lens used to give (SPEC §24), and every
    // card carries its date, city, stops, hours and cost.
    heading("Day by day"),
    block("day.detail"),
  ]),
};

const tripOverview: TemplateSeed = {
  key: "trip-overview",
  title: "Trip Overview",
  description: "The whole trip in one place — the why, the shape, the money.",
  // **No longer seeded** — Mitchell, 2026-09-12: *"Only 1 notebook per trip is
  // always generated, this is undeletable notebook that needs to be created on
  // every new trip."* That one is `overviewPage` above. This stays in the
  // gallery, unchanged, as a template somebody can choose.
  //
  // Nothing migrates. `listPages` seeds only into a trip with zero pages, so
  // every trip that already has a Trip Overview keeps it, under its own name,
  // as an ordinary deletable page.
  seedIntoNewTrips: false,
  buildContext: (tripId) => ({ tripId }),
  // Prose, and no widgets — see the header. This is the blank sheet the rest of
  // the product reaches for.
  content: newPageDoc([
    heading("Overview"),
    para(text("What's this trip about? Jot down the highlights, the why, who's coming.")),
    heading("Itinerary"),
    para(text("Sketch the shape of the trip here — arrival, key days, departure.")),
    heading("Costs"),
    para(text("Track budget notes, splurges, and who's paying for what.")),
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
  description: "One day, close up. Times, reservations, notes for the group.",
  // No longer seeded, for the same reason Trip Overview is not: SPEC §25 and
  // Mitchell, 2026-09-12 — **one** notebook comes with a trip, and it is the
  // Overview. This is a gallery template now.
  seedIntoNewTrips: false,
  buildContext: (tripId) => ({ tripId }),
  // Prose, for the same reason as Trip Overview above. The widget-bearing
  // version of this page is "A day in detail" in the gallery.
  content: newPageDoc([
    heading("Day plan"),
    para(text("What's happening today? Times, reservations, notes for the group.")),
    heading("Who's doing what"),
    para(text("Anything the plan itself cannot carry — who is picking up the car, who is booking the table.")),
  ]),
};

// ---------------------------------------------------------------------------
// Offered in the gallery only
// ---------------------------------------------------------------------------

const dayInDetail: TemplateSeed = {
  key: "day-in-detail",
  title: "A day in detail",
  description: "One day, built out of the plan — every stop, what it costs, what is still loose.",
  seedIntoNewTrips: false,
  buildContext: (tripId) => ({ tripId }),
  content: newPageDoc([
    heading("The day", 1),
    para(
      text(
        "Point the widgets below at a day — click one, then pick the day from its chrome row. Unpointed they read the whole trip, which is also a fine way to use this page.",
      ),
    ),
    para(text("Running from "), widget("hours"), text(", and it costs "), widget("cost"), text(".")),
    heading("Every stop"),
    block("day.detail"),
    heading("Still to sort"),
    para(text("What is not booked yet, and who is chasing it.")),
    block("stop.rows", { kind: "pending" }),
  ]),
};

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
    para(text("Meals planned: "), widget("count", { tag: "meal" }), text(" · Still to book: "), widget("count", { tag: "meal", kind: "pending" })),
    heading("Every meal"),
    para(text("Confirmation numbers go in the stop's notes, not here.")),
    block("stop.rows", { tag: "meal" }),
    heading("Still to book"),
    para(text("The ones that need a phone call, and the places somebody mentioned. Move one onto a day when it earns a slot.")),
    block("stop.rows", { tag: "meal", kind: "pending" }),
    heading("What eating costs"),
    block("cost", { tag: "meal" }),
    block("cost.rows", { tag: "meal" }),
  ]),
};

const bookingsAndConfirmations: TemplateSeed = {
  key: "bookings-and-confirmations",
  title: "Bookings",
  description: "What still needs booking, where you sleep, and how you get between places.",
  seedIntoNewTrips: false,
  buildContext: (tripId) => ({ tripId }),
  content: newPageDoc([
    heading("Still to book", 1),
    para(text("Pending: "), widget("count", { kind: "pending" }), text(" of "), widget("count"), text(" stops.")),
    block("stop.rows", { kind: "pending" }),
    heading("Where we sleep"),
    para(text("Every stop tagged lodging, in order. A gap between two rooms is a night nobody has booked.")),
    block("stop.rows", { tag: "lodging" }),
    heading("Getting between places"),
    block("stop.rows", { kind: "transit" }),
    heading("What it all costs"),
    block("cost"),
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
    para(text("Arriving tired is the single most common way a good plan comes apart. What day one holds:")),
    block("day.detail", { day: { kind: "index", index: 0 } }),
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
  // `overviewPage` is deliberately NOT here. The gallery is "Start from a
  // template", and a second copy of the page that comes with the trip is not a
  // template anybody wants — there can only be one page marked
  // `kind: "overview"`, and offering a button that makes another would be
  // offering a broken outcome (rule 2: no purposeless UI).
  tripOverview,
  dayOverview,
  dayInDetail,
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
export const DEFAULT_TEMPLATES: TemplateSeed[] = [
  overviewPage,
  ...TEMPLATE_LIBRARY.filter((t) => t.seedIntoNewTrips),
];

/** The one seeded page, for the callers that need to name it rather than list it. */
export const OVERVIEW_TEMPLATE = overviewPage;

/**
 * The stored marker that makes a page the trip's Overview (SPEC §25).
 *
 * Exported because it is now read in two languages: this predicate, and the
 * `WHERE` clause `deletePage` refuses on (`apps/web/src/server/pages.ts`). A
 * SQL string literal cannot import a type, so the one thing it can share is
 * this constant — and a hand-typed `'overview'` in a query is exactly how the
 * database's idea of the Overview and the code's would come apart.
 */
export const OVERVIEW_KIND = "overview";

/** Whether this page is the trip's undeletable Overview (SPEC §25). */
export function isOverviewPage(context: PageContext): boolean {
  return context.kind === OVERVIEW_KIND;
}

export function instantiateDefaults(tripId: string): CreatePageInput[] {
  return DEFAULT_TEMPLATES.map((t) => ({ title: t.title, context: t.buildContext(tripId), content: t.content }));
}

/** One template, by key — what the gallery's "Use this" button instantiates. */
export function getTemplate(key: string): TemplateSeed | undefined {
  return TEMPLATE_LIBRARY.find((t) => t.key === key);
}
