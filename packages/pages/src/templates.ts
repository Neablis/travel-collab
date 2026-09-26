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
// never made), a blank chip, and a widget still waiting on a third party
// AFTER the page has loaded.
//
// **Waiting is allowed at first paint, and only then.** A widget that declares
// an outside input (`needs`, ADR-052 — `day.weather`, and since M30 the
// notebook list `link.internal` reads) reads "loading weather" while its fetch
// is in flight; that is a loading line, the same beat every other widget
// spends waiting for its globals. Once the fetch has answered it must say
// something the trip explains — on a new trip with dated days and no stops,
// "add a place to a stop to see this". What would disqualify it is
// `unavailable` outliving the load.
//
// `templates.test.ts` renders every seeded widget against two new trips — no
// dates at all, and dated days with no stops (what the wizard makes) — each at
// first paint and after everything has loaded, to hold exactly that line.
//
// --- Four notebooks come with a trip, since M30 ---
// **Reversed 2026-09-26.** On 2026-09-12 Mitchell set *"Only 1 notebook per
// trip is always generated, this is undeletable notebook that needs to be
// created on every new trip"*, and for two weeks the Overview was the one page
// and had to carry everything — which is what he then read back as *"a massive
// dump of information … Maybe the issue is trying to make the overview do
// everything, and instead we have several notebooks, with different
// purposes."* Asked, he chose: **seed several notebooks into every new trip.**
// So a new trip gets four, each with one job:
//
//   - **Overview** — the itinerary: a short letter, then every day as a timed
//     schedule, then links to the other three. Undeletable (SPEC §25).
//   - **Before you go** — clocks, weather, what is different about where you
//     are going, documents and packing.
//   - **Bookings** — what is still to book, where you sleep, how you move, and
//     what needs you.
//   - **Money** — what it costs, day by day, against the budget.
//
// Only the Overview is undeletable: its `kind: "overview"` is what
// `deletePage` refuses on, and the other three carry no `kind`. Nothing
// migrates: `listPages` seeds only into a trip with zero pages, so every
// existing trip keeps exactly the notebooks it has. `docs/milestones/M30-notebooks-and-links.md`
// and ADR-056 carry the decision.
//
// --- Two lists, and the split is the point ---
// `DEFAULT_TEMPLATES` is what a new trip is SEEDED with; `TEMPLATE_LIBRARY` is
// what the gallery OFFERS. Apart from the Overview, the first is a subset of
// the second — so a notebook somebody deleted can be started again from the
// gallery — and it stays small deliberately: a library that plants every entry
// in every trip stops being a library, and `pages_system_seed_unique` makes
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

/** A link card to a sibling notebook, by the id it was seeded with (ADR-056). */
const notebookLink = (pageId: string): PageParagraphNode => block("link.internal", { to: { kind: "notebook", pageId } });

/**
 * The ids a seeded notebook's siblings were given, keyed by template key — how
 * the Overview's links can name notebooks that do not exist until the seeder
 * writes them.
 */
export type SiblingIds = Readonly<Record<string, string>>;

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
  /**
   * The document. For a template that links to its seeded siblings (only the
   * Overview) this is the document with PLACEHOLDER ids — valid, so every test
   * that parses or inserts `content` still can, and honest if it is ever read:
   * a placeholder id names no notebook, so its card says the notebook was
   * deleted. `instantiateDefaults` builds the real one with `buildContent`.
   */
  content: PageDoc;
  /** The document built against the ids the seeder minted for the other seeds. */
  buildContent?(siblings: SiblingIds): PageDoc;
}

// ---------------------------------------------------------------------------
// Seeded into every trip
// ---------------------------------------------------------------------------

/**
 * The ids `content` carries where a seeded Overview carries its siblings' real
 * ones. In the `…f` block, beside the demo's `…e` page ids (`server/pages.ts`),
 * so none can collide with a minted page.
 */
const PLACEHOLDER_IDS: SiblingIds = {
  "before-you-go": "00000000-0000-4000-8000-00000000f001",
  "bookings-and-confirmations": "00000000-0000-4000-8000-00000000f002",
  money: "00000000-0000-4000-8000-00000000f003",
};

/**
 * **The Overview — the itinerary** (SPEC §25, rewritten for M30). The page every
 * trip comes with, the one it cannot delete, and the page the Overview tab
 * renders.
 *
 * Mitchell, 2026-09-26: *"I wanted it to read more like a Professional travel
 * itinerary"*, and, choosing between shapes, **"Letter + full daily schedule"**:
 * a short opening written the way a travel agent's itinerary opens, then each
 * day as a timed schedule — times, place, booking status — like a printed
 * itinerary, and last the way to the rest of the trip's notebooks.
 *
 * What left, and where it went: *What needs you* and *Still to book* to
 * **Bookings**; the clocks, the weather and the country facts to **Before you
 * go**; the spend chart to **Money**. The trip strip and the countdown are not
 * seeded anywhere — both are in the picker, and the header already says when
 * the trip is.
 *
 * Every widget still reads on an empty trip: the dates line says "no dates
 * set", the schedule "no days yet", and each notebook card is "loading
 * notebooks" for one beat and then the notebook's own first line.
 */
function overviewContent(ids: SiblingIds): PageDoc {
  return newPageDoc([
    // ---- The letter ------------------------------------------------------
    // Two sentences, as an agent's covering note has: what this document is,
    // and why it can be trusted. The second is also what makes a new trip's
    // empty schedule read as a promise rather than a fault.
    para(
      text(
        "Here is your itinerary, day by day: where you will be, at what time, and anything still to book, in the order you will live it. It reads straight from the plan, so when a stop moves, this moves with it.",
      ),
    ),
    // The facts a printed itinerary heads its first page with, as labels
    // rather than a sentence around them: "Dates: no dates set" reads on an
    // empty trip, where "You travel no dates set" would not.
    para(text("Dates: "), widget("dates"), text(" · Route: "), widget("city")),
    // ---- The schedule ----------------------------------------------------
    heading("Day by day"),
    block("day.detail", { view: "schedule" }),
    // ---- The rest of the trip ---------------------------------------------
    heading("Also in this trip"),
    para(text("Three more notebooks came with the trip, each with one job.")),
    notebookLink(ids["before-you-go"]!),
    notebookLink(ids["bookings-and-confirmations"]!),
    notebookLink(ids.money!),
  ]);
}

const overviewPage: TemplateSeed = {
  key: "overview",
  title: "Overview",
  // §25's index line: *"titled 'Overview / Comes with the trip'"*.
  description: "Comes with the trip.",
  seedIntoNewTrips: true,
  buildContext: (tripId) => ({ tripId, kind: "overview" }),
  content: overviewContent(PLACEHOLDER_IDS),
  buildContent: overviewContent,
};

/**
 * **Before you go** — seeded since M30. The week before leaving: what time it
 * will be, what the weather is doing, what is different about where you are
 * going, and the two lists nobody should write from memory.
 *
 * `day.weather` sends rounded stop locations to the weather providers, which
 * Mitchell accepted on 2026-09-26 (*"It's ok to send a users data to
 * weather"*); KI-2026-09-24-o is the disclosure, not the flow.
 */
const beforeYouGo: TemplateSeed = {
  key: "before-you-go",
  title: "Before you go",
  description: "The week before you leave — clocks, weather, what's different there, documents and packing.",
  seedIntoNewTrips: true,
  buildContext: (tripId) => ({ tripId }),
  content: newPageDoc([
    para(text("What to check in the week before you leave: the clocks, the weather, what is different about where you are going, and what to pack.")),
    heading("Clocks"),
    // A label, as the Overview's facts are: `day.fromHome`'s empty reasons
    // ("set a home airport in Account to see this") are not a clause.
    para(text("Time difference: "), widget("day.fromHome"), text(".")),
    heading("Weather"),
    block("day.weather"),
    heading("Know before you go"),
    block("country.facts"),
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
      "Whatever the weather above actually says, not what the average does.",
      "Chargers, and one adapter per person who will not share.",
      "The medication that is hard to buy where you are going.",
    ),
  ]),
};

/**
 * **Bookings** — seeded since M30. What is loose and what is settled: the list
 * Calendar counts as "N to book", then the nights and the journeys, then
 * whatever else the plan is waiting on.
 */
const bookings: TemplateSeed = {
  // The key it had as a gallery template, so the content bundle and anything
  // that named it keep meaning this page.
  key: "bookings-and-confirmations",
  title: "Bookings",
  description: "What still needs booking, where you sleep, how you get between places, and what needs you.",
  seedIntoNewTrips: true,
  buildContext: (tripId) => ({ tripId }),
  content: newPageDoc([
    para(text("What is still to book, and what is settled — where you sleep and how you get between places.")),
    heading("Still to book"),
    // The `still-to-book` preset — the rule Calendar's "N to book" and the Home
    // hero share — so this list cannot disagree with them.
    para(text("Anything marked Pending waits here until it is settled.")),
    block("stop.rows", { only: "needsBooking" }),
    heading("Where you sleep"),
    para(text("Every stop tagged Lodging, in order. A gap between two is a night nobody has booked.")),
    block("stop.rows", { tag: "lodging" }),
    heading("Getting between places"),
    block("stop.rows", { kind: "transit" }),
    heading("What needs you"),
    block("open"),
  ]),
};

/** **Money** — seeded since M30. Where the header's two numbers come from. */
const money: TemplateSeed = {
  key: "money",
  title: "Money",
  description: "What the trip costs, day by day, against the budget.",
  seedIntoNewTrips: true,
  buildContext: (tripId) => ({ tripId }),
  content: newPageDoc([
    para(text("What the trip costs, day by day, against the budget.")),
    heading("Spend by day"),
    // Against an even pace for the budget, when there is one.
    block("cost.chart"),
    heading("Costs, broken down"),
    block("cost.rows"),
    heading("Notes"),
    para(text("Who is paying for what, what is already deposited, and what you would cut first.")),
  ]),
};

const tripOverview: TemplateSeed = {
  key: "trip-overview",
  title: "Trip Overview",
  description: "The whole trip in one place — the why, the shape, the money.",
  // **No longer seeded** — Mitchell, 2026-09-12: *"Only 1 notebook per trip is
  // always generated, this is undeletable notebook that needs to be created on
  // every new trip."* That one is `overviewPage` above. This stays in the
  // gallery, unchanged, as a template somebody can choose — and stayed there
  // when M30 went back to seeding several (the header): the four seeded now
  // each have a job, and this one's job is the Overview's.
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
  // No longer seeded, since 2026-09-12 (SPEC §25). M30 seeds four again, and
  // not this one: the Overview's schedule is every day, close up, already.
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

/**
 * Everything the "Start from a template" gallery offers, in the order it offers
 * it: the three seeded ones first — a returning reader recognises them from
 * their own trips, and it is how a deleted one comes back — then the rest.
 */
export const TEMPLATE_LIBRARY: TemplateSeed[] = [
  // `overviewPage` is deliberately NOT here. The gallery is "Start from a
  // template", and a second copy of the page that comes with the trip is not a
  // template anybody wants — there can only be one page marked
  // `kind: "overview"`, and offering a button that makes another would be
  // offering a broken outcome (rule 2: no purposeless UI).
  beforeYouGo,
  bookings,
  money,
  tripOverview,
  dayOverview,
  dayInDetail,
  fullTripBreakdown,
  dinnerTracker,
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

/** The Overview's seed, for the callers that need to name it rather than list it. */
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

/** A seeded page: what `CreatePageInput` carries, and the id the seeder gave it. */
export type SeededPage = CreatePageInput & { id: string };

/**
 * The pages a new trip is seeded with, each with its id.
 *
 * **The ids are minted HERE, before any content is built**, because the
 * Overview links to its siblings by id (ADR-056) and those ids have to exist
 * before the Overview's document can say them. `mintId` is the caller's — this
 * package has no randomness (Invariant 4) — so the server passes `randomUUID`
 * and the demo passes its fixed ids, and one call to this is the whole seed.
 */
export function instantiateDefaults(tripId: string, mintId: () => string): SeededPage[] {
  const ids: Record<string, string> = {};
  for (const t of DEFAULT_TEMPLATES) ids[t.key] = mintId();
  return DEFAULT_TEMPLATES.map((t) => ({
    id: ids[t.key]!,
    title: t.title,
    context: t.buildContext(tripId),
    content: t.buildContent ? t.buildContent(ids) : t.content,
  }));
}

/** One template, by key — what the gallery's "Use this" button instantiates. */
export function getTemplate(key: string): TemplateSeed | undefined {
  return TEMPLATE_LIBRARY.find((t) => t.key === key);
}
