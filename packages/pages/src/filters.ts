import { z } from "zod";
import { FILTER_VALUE_SCHEMAS, type FilterDimension } from "@tc/contracts";
import type { WidgetInput, WidgetInputType } from "./registry-types";

// The other two thirds of ADR-039 decision 1's sentence — `widget = entity +
// filters + shape` — expressed as declarations a test can read.
//
// `shape` already lives in `@tc/contracts` (`WidgetShape`) because a stored
// document's renderer depends on it. `entity` and the legality matrix do not:
// nothing is persisted here. They describe what a widget DEFINITION is allowed
// to be, which is a fact about the registry rather than about any document, so
// they live beside the registry.

/**
 * What a widget is about (ADR-039 decision 1).
 *
 * Five, closed. `trip` and `account` are the two that have no set to narrow —
 * a trip is one trip and an account is one account — which is why the matrix
 * below gives them no dimensions at all rather than an empty selection.
 */
export type WidgetEntity = "day" | "stop" | "city" | "trip" | "account";

/**
 * **The legality matrix** (ADR-039 decision 3), and the actual design work in
 * this change: *"the cross product contains cells that mean nothing — the hours
 * of a city, the names of every stop on a trip as one sentence"*.
 *
 * One row per entity, naming every dimension that can EVER apply to it. A
 * primitive declares a subset of its entity's row; declaring anything outside
 * it is a failing registry test rather than a widget that offers a control
 * resolving against nothing.
 *
 * Read each row as a sentence about the data, because that is what makes a row
 * arguable rather than arbitrary:
 *
 * - **stop** — every dimension. A stop sits on a day (so `day` and, through the
 *   day's date, `dates`), in a city, carries tags and exactly one kind, and will
 *   one day carry a person.
 * - **day** — everything except `person`. A day has no person and, unlike a
 *   stop, cannot acquire one: `person` arrives on the stop (M13 `add-stop-who` /
 *   M19 link 3), and "the days somebody is on" is a question about their stops.
 *   `tag` and `kind` are legal because they narrow what a day's card SHOWS, not
 *   which days exist — `day.detail{kind: booked}` is the spec's own example.
 * - **city** — `day`, `city` and `dates`. A city is reached on days, so days and
 *   their dates select cities; `tag` and `kind` are not legal because "the
 *   cities with a meal in them" is a question about stops that happens to
 *   report cities, and the primitive that answers it is `count{of: city}` over
 *   the stop row.
 * - **trip** / **account** — nothing. `attribute` reads one field of one thing
 *   (ADR-039 decision 6); there is no set, so there is nothing to narrow.
 *
 * **`stop`'s row is a superset of `day`'s and `city`'s**, and that is load
 * bearing rather than incidental: it is what lets `count` — the one primitive
 * the spec gives three entities — declare the stop row and count days or cities
 * under it. `filters.test.ts` asserts the containment, so the claim cannot rot
 * into a comment.
 */
export const LEGAL_FILTERS: Record<WidgetEntity, readonly FilterDimension[]> = {
  stop: ["day", "city", "tag", "kind", "person", "dates"],
  day: ["day", "city", "tag", "kind", "dates"],
  city: ["day", "city", "dates"],
  trip: [],
  account: [],
};

/**
 * Which control a dimension gets (ADR-035 decision 2's `WidgetInput.type`).
 *
 * One map, so the chrome row, the phone's bind sheet and the insert step all
 * choose the same control for the same dimension — SPEC §5's *"both surfaces
 * read one declaration, so they cannot offer different things"*.
 *
 * `tag` maps to the input type `tags`, which is the one place the two
 * vocabularies differ in spelling: the input type is named for the control
 * ("every stop, or one") and predates the dimension being named at all.
 */
const INPUT_TYPE_OF: Record<FilterDimension, WidgetInputType> = {
  day: "day",
  city: "city",
  tag: "tags",
  kind: "kind",
  person: "person",
  dates: "dates",
};

/**
 * The human label a dimension's control carries. Beside the type map rather
 * than inside each primitive, because a primitive that labelled its own day
 * select "Which day" while another said "Day" would be two surfaces disagreeing
 * about one dimension.
 */
const LABEL_OF: Record<FilterDimension, string> = {
  day: "Day",
  city: "City",
  tag: "Tags",
  kind: "Kind",
  person: "Who",
  dates: "Dates",
};

/**
 * **The param key of a dimension is the dimension's own name.** `cost{day: 3}`,
 * `stop.rows{kind: "booked"}` — which is exactly how the spec's preset table
 * writes them.
 *
 * Stating it as a function rather than leaving it implicit is what makes the
 * registry-wide test able to check BOTH directions: every declared dimension is
 * a key the schema keeps, and every dimension the schema keeps is declared. The
 * legacy widgets spell their day binding `dayRef`, which is why this is a rule
 * about primitives rather than about the registry as a whole — the migration
 * (spec §8 step 3) is what retires the other spelling.
 */
export const paramKeyOf = (dimension: FilterDimension): string => dimension;

/**
 * Build a primitive's `params` schema from the dimensions it declares.
 *
 * Every dimension is `.optional()`, and that is decision 2 in one line: an
 * absent filter is not a missing value, it is the widest one. `.strip()` for the
 * reason every other macro uses it — a stale document carrying a param this
 * build no longer understands still opens.
 *
 * `extra` is for the params that are NOT filters: `count`'s `of` and (spec §8
 * step 2) `attribute`'s `field`. They are closed vocabularies chosen at insert
 * time rather than dimensions of a selection, so they get no row in the matrix
 * and no control from `filterInputs`.
 */
export function filterParams<D extends FilterDimension, E extends z.ZodRawShape = Record<never, never>>(
  dimensions: readonly D[],
  extra: E = {} as E,
): z.ZodObject<{ [K in D]: z.ZodOptional<(typeof FILTER_VALUE_SCHEMAS)[K]> } & E> {
  const shape: z.ZodRawShape = { ...extra };
  for (const dimension of dimensions) {
    shape[paramKeyOf(dimension)] = FILTER_VALUE_SCHEMAS[dimension].optional();
  }
  // The cast is the one place the dimension-keyed shape above meets the mapped
  // type in the signature. It is checked rather than trusted: the signature is
  // what every primitive's `params` type is inferred FROM, so a key spelled
  // differently would fail to compile in the resolver that reads it, and
  // `registry.test.ts` re-checks the correspondence at runtime for every
  // registered primitive.
  return z.object(shape).strip() as z.ZodObject<{ [K in D]: z.ZodOptional<(typeof FILTER_VALUE_SCHEMAS)[K]> } & E>;
}

/**
 * The declared inputs for a set of dimensions, in the order they were declared.
 *
 * Derived rather than written out beside each primitive, so a primitive cannot
 * declare a dimension and forget its control (or the reverse). `registry.test.ts`
 * still checks the correspondence registry-wide, because a primitive is free to
 * hand-write `inputs` and the check costs nothing.
 */
export function filterInputs(dimensions: readonly FilterDimension[]): readonly WidgetInput[] {
  return dimensions.map(
    (dimension) =>
      ({ name: paramKeyOf(dimension), type: INPUT_TYPE_OF[dimension], label: LABEL_OF[dimension] }) as WidgetInput,
  );
}
