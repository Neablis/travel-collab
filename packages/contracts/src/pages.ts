import { z } from "zod";
import { ActivityKind, ActivityTag } from "./activity";
import { PageDoc } from "./pageDoc";

// A day binding: the value shape of a `day` input inside ONE WIDGET's params
// (ADR-035 decision 3 / SPEC §18). "index" = the Nth day (0-based) of the trip;
// resolvers map it to the day at that position in TripDetail.days. (uuid form
// reserved for a later "pin to a specific day" affordance; index is what the
// registry's day macros take now.)
//
// It lives here rather than in the registry because it crosses the boundary
// twice over: it is written into `MacroNode.attrs.params`, which the AI compose
// path and the editor both produce, and read back by a resolver in @tc/pages.
export const DayRef = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("index"), index: z.number().int().nonnegative() }),
  z.object({ kind: z.literal("dayId"), dayId: z.string().uuid() }),
]);
export type DayRef = z.infer<typeof DayRef>;

/**
 * A tag binding: the value shape of a `tags` input inside ONE WIDGET's params.
 *
 * Here for the same reason `DayRef` is, and ADR-037 decision 9 says so outright
 * — *"they belong in `packages/contracts` because the editor, the AI path and
 * the resolvers all read them"*. It was declared locally inside `stop.line`
 * instead, so those three could have drifted on a value that is persisted in
 * every document carrying that widget. Found by Copilot on PR 139.
 *
 * **Absent is a real answer meaning "every stop", not "not configured."** SPEC
 * §18's table reads *"every stop, or one"*, so a widget with no tag bound is
 * finished rather than waiting — which is why `stop.line` is useful the moment
 * it is pointed at a day.
 *
 * **This is narrower than decision 9's own row**, which reads `"all" |
 * ActivityTag[]`. §18 (2026-09-03) is the later document and asks for one tag or
 * none; a set-valued binding needs a control that can express a set, and nothing
 * in the design shows one. Recorded in the ADR rather than settled here — if the
 * set form is wanted, this is the one place it widens.
 */
export const TagRef = ActivityTag;
export type TagRef = z.infer<typeof TagRef>;

// ---------------------------------------------------------------------------
// The filter vocabulary (ADR-039 decisions 1, 2 and 7)
// ---------------------------------------------------------------------------

/**
 * The dimensions a widget's selection can be narrowed along.
 *
 * ADR-039 decision 1: `widget = entity + filters + shape`. These are the
 * `filters` half, and the list is closed — a new dimension is a decision, a row
 * in the legality matrix and a control, not a string somebody writes into
 * params.
 *
 * **An absent dimension means EVERY member, and that is a real binding rather
 * than an unset one** (decision 2). Mitchell's *"it can also select All at the
 * top"* is the absent value made visible: a widget with no day chosen is not
 * waiting for a choice, it is showing every day. `TagRef` already worked this
 * way (ADR-037 decision 9) and this generalises it to all six.
 *
 * They live here rather than in `@tc/pages` for the reason `DayRef` and
 * `TagRef` do: these values are PERSISTED in every document carrying a widget,
 * and the editor, the AI compose path and the resolvers all read them.
 */
export const FilterDimension = z.enum(["day", "city", "tag", "kind", "person", "dates"]);
export type FilterDimension = z.infer<typeof FilterDimension>;

/**
 * A city binding: the city's NAME, as `TripGlobals.cities` reports it.
 *
 * A name rather than an id because a city has no id — cities are derived from
 * `location.city` by `citiesOfDay`, so the name is the identity. A stale
 * binding (a city the trip no longer touches) therefore matches nothing, which
 * is the same answer a stale `DayRef` gets: never a guessed one.
 */
export const CityRef = z.string().min(1).max(200);
export type CityRef = z.infer<typeof CityRef>;

/**
 * A kind binding: one `ActivityKind`. This is what absorbs `booking.line` —
 * "a line for every booking" is `stop.rows` filtered to `kind: "booked"`
 * (ADR-039's table of widgets written twice).
 */
export const KindRef = ActivityKind;
export type KindRef = z.infer<typeof KindRef>;

/**
 * A person binding — **vocabulary, not a capability** (ADR-039 decision 7).
 *
 * Declared now so the shape is settled, and it resolves to nothing today. Two
 * separate gaps: `TripMember` is `{ userId, role }` with no display name, so an
 * option list built from it would show ids; and no stop carries a person at all
 * — there is no assignee, payer or participant on `ActivityView` — so the
 * filter has nothing to narrow by. A widget handed one answers ADR-037 decision
 * 7's "needs a field" state rather than filtering against data that is not
 * there.
 *
 * A `userId`, or the literal `"me"` — the filter that follows whoever is
 * reading a shared page. `"me"` is recorded intent (ADR-039 decision 7) and an
 * open question, not a plan: a page that says something different to each reader
 * is a genuinely new thing for this product.
 */
export const PersonRef = z.string().min(1);
export type PersonRef = z.infer<typeof PersonRef>;

// A calendar date, `YYYY-MM-DD`. Local to this file rather than exported: the
// rest of the contracts spell dates `z.string()` and widening that is its own
// change, not a side effect of adding a filter.
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected a YYYY-MM-DD date");

/**
 * A date-range binding. A single date is `from === through`, so the control has
 * one shape rather than two — "All · a single date · a range" is absent, equal
 * endpoints, and different endpoints.
 *
 * `dates` is the one declared dimension besides `day`/`city`/`tag`/`kind` that
 * is **real today** (ADR-039 decision 7): days carry dates, so a range over days
 * and stops resolves against data that exists.
 *
 * Ordered endpoints are refused rather than silently swapped: a reversed range
 * is a mistake somebody made, and quietly reinterpreting it is how a widget
 * shows a confident wrong answer. `insertWidget` turns this into the same typed
 * refusal a bad param gets today (ADR-037 decision 4). ISO dates compare
 * correctly as strings, which is what every date filter in `@tc/pages` relies
 * on — no `Date` construction, no timezone.
 */
export const DateRangeRef = z
  .object({ from: IsoDate, through: IsoDate })
  .refine((r) => r.from <= r.through, { message: "from must not be after through" });
export type DateRangeRef = z.infer<typeof DateRangeRef>;

/**
 * Every dimension's value shape, in ONE map.
 *
 * `@tc/pages` builds each primitive's `params` schema by picking from this,
 * which is what makes "the declared filters and the params schema agree" true
 * by construction rather than by a convention six files have to remember. The
 * registry-wide test in `registry.test.ts` still checks it, because a primitive
 * may write its own schema and the check is cheap.
 */
export const FILTER_VALUE_SCHEMAS = {
  day: DayRef,
  city: CityRef,
  tag: TagRef,
  kind: KindRef,
  person: PersonRef,
  dates: DateRangeRef,
} as const satisfies Record<FilterDimension, z.ZodTypeAny>;

// A page is trip-bound and nothing else. It is NOT "about" a day: a page holds
// widgets and each widget owns its own inputs, so two widgets on one page can
// read two different days (SPEC §18, ADR-035 decision 1). `dayRef` used to live
// here; it moved onto the widget instance, where the binding it describes
// actually belongs.
export const PageContext = z.object({
  tripId: z.string().uuid(),
});
export type PageContext = z.infer<typeof PageContext>;

// Page content ON THE WAY OUT, and it stays permissive ON PURPOSE.
//
// ADR-038's consequences say "`PageContent`'s `passthrough()` and
// `z.unknown()` go". They go from the WRITE path — see `CreatePageInput` and
// `UpdatePageInput` below, which are `PageDoc` now. They cannot go from the
// read path, and the reason is decision 4 itself: a page whose stored document
// this build cannot parse is exactly the page the reader must be shown a
// read-only explanation for. A strict `Page.content` would make `fetchPage`
// throw on that row instead, and the user would get "Something went wrong"
// for a notebook that is, as far as anyone can tell, simply gone.
//
// So the asymmetry is the design, not a leftover: **read what is there, write
// only what we understand.** It is also what makes the guard possible at all —
// you cannot explain a document you refused to deliver.
export const PageContent = z.object({
  type: z.literal("doc"),
  content: z.array(z.unknown()).default([]),
}).passthrough();
export type PageContent = z.infer<typeof PageContent>;

export const MacroKind = z.enum(["inline", "block"]);
export type MacroKind = z.infer<typeof MacroKind>;

// What a widget renders AS (ADR-037 decision 1's `shape`). It supersedes
// `MacroKind` for widget definitions: `MacroKind` can say "inline" or "block"
// and has nowhere to put a repeater, which link 6 needs. `MacroKind` stays for
// now because `MacroView`'s older callers and the stored vocabulary still speak
// it; the widget registry speaks this.
export const WidgetShape = z.enum(["single", "block", "repeat"]);
export type WidgetShape = z.infer<typeof WidgetShape>;

export const Page = z.object({
  id: z.string().uuid(),
  tripId: z.string().uuid(),
  title: z.string().min(1),
  context: PageContext,
  content: PageContent,
  createdAt: z.string(),
  updatedAt: z.string(),
  actorId: z.string().min(1),
});
export type Page = z.infer<typeof Page>;

// The actor recorded on lazily seeded default pages. It lives here rather than
// in the server module that writes it because the UI now READS it — the
// provenance line below is "is this row's actorId this sentinel?" — and a
// sentinel compared on both sides of the server/UI wall is a contract, not a
// server detail (AGENTS.md invariant 5). Migration 0005's
// `pages_system_seed_unique` partial index is scoped to exactly this value, so
// changing the string means changing that index too.
export const SYSTEM_ACTOR_ID = "system";

// `actorId` rides along because the Notebook index draws a provenance line
// ("Comes with your trip" vs "Yours", SPEC §7) and the only thing that
// distinguishes the two is whether the row was written by the lazy template
// seeder or by a person. `content` stays off: it is the one field that makes a
// list response unbounded, and nothing in a list renders it.
export const PageSummary = Page.pick({ id: true, tripId: true, title: true, context: true, updatedAt: true, actorId: true });
export type PageSummary = z.infer<typeof PageSummary>;

// The write path is `PageDoc`, not `PageContent` (ADR-038 decisions 2 and 4).
// A document this build cannot parse is a document it cannot save losslessly,
// and "a page that cannot be saved losslessly is a page that must not be saved
// at all" is the one rule decision 4 would not trade away. Enforcing it here
// rather than only in the browser means it holds for the AI compose path, the
// template seeder and anything that reaches the route later.
//
// `PageDoc.v` defaults to 1, so a client that sends a bare `getJSON()` document
// still parses — and comes back out of `serializePageDoc` stamped, which is
// decision 2's "written on every save".
export const CreatePageInput = z.object({
  title: z.string().min(1),
  context: PageContext,
  content: PageDoc,
});
export type CreatePageInput = z.infer<typeof CreatePageInput>;

export const UpdatePageInput = z.object({
  title: z.string().min(1).optional(),
  context: PageContext.optional(),
  content: PageDoc.optional(),
});
export type UpdatePageInput = z.infer<typeof UpdatePageInput>;
