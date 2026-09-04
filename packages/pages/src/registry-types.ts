import type { z } from "zod";
import type { TripDetail, PageContext, TripGlobals, UserPreferences, WidgetShape } from "@tc/contracts";
import type { MacroResult } from "./result";

// Inline payloads are display-ready strings; block payloads are structured data
// the renderer turns into a component (NOT markup — the C-era swap point).
//
// `InlinePayload = string` is retained as the RESOLVER's output type and is no
// longer what reaches the screen — `render` below turns it into `Seg[]`. ADR-037
// names this as the second problem with the old model: the design's own
// `w-person` renders as chip, text, chip, text, chip from a single binding, and
// a display-ready string cannot carry that.
export type InlinePayload = string;
export interface ItineraryDayPayload { kind: "itinerary-day"; dayId: string; date: string | null; activities: { title: string; timeWindow: string | null; cost: string | null }[]; }
export interface ItineraryTripPayload { kind: "itinerary-trip"; days: ItineraryDayPayload[]; }
export interface CostRow { label: string; amount: string; }
export interface CostsTablePayload { kind: "costs-table"; rows: CostRow[]; total: string; }

// A DISCRIMINATED union, and the `kind` tags are the whole reason `MacroView`
// no longer switches on a widget's name.
//
// ADR-037 decision 1 says a widget's renderer must not live in a switch case in
// `apps/web`, and decision 3 says `render` returns data rather than markup. Both
// are satisfiable together only if the thing `apps/web` dispatches on is the
// PRESENTATION, not the widget: there are 21 designed widgets and about five
// shapes they render as, so a switch over shapes grows when someone designs a
// genuinely new presentation and stays put when someone adds the fifteenth
// widget. That is the requirement ADR-037 actually states — *"if adding the
// fifteenth widget touches a component, the model has failed"* — and dispatching
// by name failed it by construction, because every widget was its own case.
//
// This is an implementation decision the ADR did not make; it is recorded in
// ADR-037 under decision 3 rather than only here.
export type BlockPayload = ItineraryDayPayload | ItineraryTripPayload | CostsTablePayload;

// ---------------------------------------------------------------------------
// What a widget RENDERS (ADR-037 decision 3 — the CSR protection)
// ---------------------------------------------------------------------------

// A rendered fragment. Text or a chip, and nothing else.
//
// This is the load-bearing half of decision 3: the output is a closed union of
// DATA, never a string of HTML. React escapes text nodes by default, so a widget
// cannot emit an element, an attribute, a URL or a script — not because it is
// asked not to, but because the type has nowhere to put one. There is no
// `{ kind: "html" }` and there must never be; `dangerouslySetInnerHTML` is
// absent from this path and a lint wall should keep it so.
export type Seg =
  | { kind: "text"; text: string }
  | { kind: "chip"; name: string; text: string };

// What `render` hands back. Three shapes, closed.
//
// `rows` is what a `repeat` widget produces — one segment list per item — and it
// exists now, before link 6 builds repeaters, because the format has to
// understand a shape before the editor emits it (the same argument ADR-038 makes
// about `repeat` nodes).
export type Rendered =
  | { kind: "inline"; segs: Seg[] }
  | { kind: "block"; block: BlockPayload }
  | { kind: "rows"; rows: Seg[][] };

// Convenience constructors, so a widget's `render` reads as data rather than as
// object literals with a discriminator repeated seven times.
export const text = (t: string): Seg => ({ kind: "text", text: t });
export const chip = (name: string, t: string): Seg => ({ kind: "chip", name, text: t });
export const inlineOf = (...segs: Seg[]): Rendered => ({ kind: "inline", segs });
export const blockOf = (block: BlockPayload): Rendered => ({ kind: "block", block });
export const rowsOf = (rows: Seg[][]): Rendered => ({ kind: "rows", rows });

// What a widget TAKES, declared so a UI can choose a control for it
// (ADR-035 decision 2, SPEC §18). A Zod schema says a param is a string; it
// cannot say the string is a day, a person or a tag — so `params` alone cannot
// tell the insert sheet which control to render. Hence a second, purely
// descriptive field.
//
// `type` is what the control is chosen from, so a NEW widget taking a day needs
// no new UI. Five types, per §18's table:
//   day    → one day select        "Day 6 · Hakone"
//   days   → from / through        "Day 6 – Day 8", or "Day 6" when equal
//   person → who                   "Priya"
//   tags   → every stop, or one    "meal stops"
//   trip   → which trip            the trip name
//
// `name` is not decoration: it must be a key the macro's OWN `params` schema
// accepts, or the widget declares a binding the validator ignores. That
// correspondence is enforced by a registry-wide test rather than by convention.
export type WidgetInput =
  | { name: string; type: "day"; label: string }
  | { name: string; type: "days"; label: string }
  | { name: string; type: "person"; label: string }
  | { name: string; type: "tags"; label: string }
  | { name: string; type: "trip"; label: string };

// What a widget is handed at resolve time (ADR-037 decision 1).
//
// One argument rather than `(detail, ctx)`, because ADR-037 open question 2
// settled what a notebook is scoped to. Mitchell, 2026-09-03:
//
// > notebooks are always account scope, they can access data from account like
// > your name, tier, etc. notebooks can be optionally account scoped, but that's
// > today assigned on creation. the creation of a notebook based on what trip
// > initiated it locks the trip it operates on.
//
// So the account is always in scope and the trip is a property of the notebook,
// fixed at creation — which is why `PageContext` keeps `tripId` and why it is
// not a binding a widget can be re-pointed at.
//
// **`user` is `UserPreferences | null`, and the `null` is not the absent-account
// case.** The account is always in scope; what can be absent is our copy of its
// preferences, because loading them is a request that can fail. A widget answers
// that with ADR-037 decision 6's "not set up" state rather than the page
// refusing to open — a notebook that will not load because a preferences fetch
// 500'd is a worse outcome than one widget saying it has nothing to show.
//
// **`trip` is OPTIONAL, and every resolver handles its absence.** ADR-037 open
// question 2 requires this outright — root-account notebooks are the stated
// direction, and *"a resolver that assumes a trip is a resolver that has to be
// rewritten when they arrive"*. An earlier version of this file made it required
// and argued the case could not occur yet; Copilot pointed out on PR 134 that
// the ADR says otherwise and that deferring means rewriting all seven resolvers
// later. A trip-reading widget answers `needsTrip()` — which is
// `unbound("trip")`, a first-class rendered state rather than an error.
export interface WidgetContext {
  trip?: TripDetail;
  page: PageContext;
  user: UserPreferences | null;
  // The trip's addressable collections (ADR-037 open question 4). `null` for
  // the same reason `user` is: it is a separate request, and a widget saying
  // "not set up" beats a notebook that will not open.
  //
  // It is HANDED to widgets rather than computed by them, and that is the
  // architectural point rather than a convenience: `trip.cities` is derived by
  // `citiesOfDay` in `@tc/domain`, which only `apps/web/src/server/**` may
  // import. See `TripGlobals`' own header.
  globals: TripGlobals | null;
}

// The per-iteration scope a repeat renderer passes as it maps a row template
// over resolved items (ADR-035 decision 4). **Never persisted** — storing an
// item identity is exactly what makes a document go stale when a day moves.
//
// One member today because link 6's first repeater iterates days. It widens
// when a repeater over cities or tags arrives; the union exists now so
// `resolve`'s signature does not change again when it does.
export type ItemScope = { kind: "day"; index: number };

export interface MacroDef<P, T> {
  name: string;                    // "cost.trip", "itinerary.day" — STORED
  // What a person calls it, for the insert sidebar. Distinct from `name`, which
  // is a stored identifier a document keeps forever (ADR-037 decision 8), so
  // retitling a widget never touches a stored page.
  title: string;
  // ADR-037 decision 1. Replaces `kind: MacroKind`, which could say "inline" or
  // "block" and had nowhere to put a repeater.
  shape: WidgetShape;
  params: z.ZodType<P>;            // per-macro param schema (registry owns it)
  // What the widget takes. REQUIRED, and `[]` is a real answer meaning "binds
  // nothing, inserts immediately" (ADR-035 decision 2). Optional would collapse
  // that into "not declared yet", which the insert sheet has to tell apart —
  // and required means the compiler names every entry that forgot.
  inputs: readonly WidgetInput[];
  description: string;             // human- AND machine-readable (AI + autocomplete)
  emptyText: string;               // declarative empty-state copy
  // The insert sidebar's sample. **A fixed string, never a computed value**
  // (ADR-037 decision 5): a preview asserting numbers the live widget computes
  // makes the sidebar and the page contradict each other in one session, which
  // is why the design phrases person previews generically.
  preview: string;
  resolve(ctx: WidgetContext, params: P, item?: ItemScope): MacroResult<T>;
  // `resolve` and `render` are deliberately TWO functions, not one (ADR-037
  // decision 1). `resolve` answers "what does this mean against the current
  // trip"; `render` answers "what does that look like". Keeping them apart is
  // what lets the insert sheet preview a widget without a trip, lets the AI path
  // validate without a DOM, and keeps this package free of React.
  render(payload: T): Rendered;
}

// Existentially-typed entry for the registry map.
export type AnyMacroDef = MacroDef<Record<string, unknown>, InlinePayload | BlockPayload>;
