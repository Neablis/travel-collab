import { z } from "zod";
import { ActivitySnapshot } from "./activity.ts";
import { TripDetail } from "./detail.ts";
import { TripGlobals } from "./globals.ts";
import { UserPreferences } from "./identity.ts";
// `unwrapSchema` is shared with `annotationOf` rather than kept here: the
// annotation lookup and the list/enum reading must agree about what "the same
// field" means, and while they were two walks they did not (Copilot, PR 139).
import { VALUE_KINDS, annotationOf, described, unwrapSchema as unwrap } from "./valueKind.ts";

// The attribute manifest — ADR-037 open question 4, and the mechanism behind
// *"a developer adding a new global attribute gets it for free"*.
//
// Mitchell wanted `{{trip.cities[Tokyo].activities.length}}`; what was settled
// instead was a widget whose control is a searchable select over a GENERATED
// list of readable paths, with a structured stored param and no user-facing
// syntax at all:
//
// > Yes, thats fine, i didnt mean that template string to be how a end user
// > actually interacts, lets always avoid dropping into letting end user write
// > raw string templates, it should also be a frontend widget, a search input,
// > a dropdown, something easy for them to use.
// >
// > The manifest is fine, we can invert a Typescript type to identify the fields
// > that can be accessed and how to serialize them
//
// **Zod, not TypeScript**, per that decision's own refinement: in this repo the
// TS type is the DERIVED artifact (invariant 5 — "Zod schemas; types inferred,
// never hand-written twice"), so inverting the type would need the compiler API
// and a codegen artifact to keep in sync, to recover what Zod already holds at
// runtime. Walking `ZodObject.shape` is reflection with no build step, and it
// lives here because `packages/contracts` depends on nothing.

// ---------------------------------------------------------------------------
// Exposure is OPT-IN, twice over
// ---------------------------------------------------------------------------
//
// ADR-037: *"free-by-default over a whole schema is a leak: `TripDetail` carries
// `dismissedConflictIds`, `forkedFrom` and internal uuids, none of which belong
// in a user-facing picker."* So two gates, and both must pass:
//
//   1. **The schema must be a declared root.** Only what `MANIFEST_ROOTS` names
//      is ever walked. Pointing this at `TripDetail` would publish the trip's
//      internals, and no code path can do that by accident because there is no
//      "walk everything" entry point.
//   2. **The field must be annotated by `described()`** (or, for a collection,
//      `describedCollection()`). That is the "one line per field" the ADR calls
//      still-free, and it carries the human label the picker shows. An
//      unannotated field is not in the manifest — so the default for anything
//      added later is EXCLUDED, which is the direction that fails safe.
//
// **Not `.describe()`, which this gate was until M14 T06.** `.describe()` is
// also the OpenAPI text of every public-API schema, so gating on it made API
// wording a picker label and published any field described for the API alone.
// The annotation lives in `valueKind.ts`'s WeakMap, and `.description` decides
// nothing here.
//
// The consequence worth stating plainly: annotating a field on a root publishes
// it, and adding an unannotated one does not. That is the whole contract, and
// `manifest.test.ts` asserts both halves.

// One readable thing, as the picker will list it.
//
// A Zod schema rather than a hand-written type, on Copilot's finding (PR 134):
// invariant 5 says cross-boundary types in this package are "Zod schemas; types
// inferred, never hand-written twice", and this is exported from `contracts`.
// It also earns its keep beyond the letter of the rule — `manifest.test.ts` now
// parses the builder's output through it, so a malformed entry is a test
// failure rather than a shape nobody checks.
const ValueKindSchema = z.enum(VALUE_KINDS);
// Present only on an array field; `valueKind` then names each element. Never
// declared by hand — see `VALUE_KINDS` for why a list is not a kind.
const ListFlag = z.literal(true).optional();
// Present exactly when `valueKind` is `enum`: the vocabulary, read off the
// `ZodEnum` itself. A formatter needs it to print a label, and "distinct"
// (M14 field widget, answer 3) needs it to say what can repeat.
const EnumValues = z.array(z.string().min(1)).min(1).optional();

/** Everything the manifest can address: the trip, the reader's account, one stop. */
export const MANIFEST_OBJECTS = ["trip", "account", "stop"] as const;
const ManifestObject = z.enum(MANIFEST_OBJECTS);
export type ManifestObject = z.infer<typeof ManifestObject>;

/** What can be read off one member of a collection. */
export const AttributeField = z.object({
  field: z.string().min(1),
  label: z.string().min(1),
  // Required since T06: the gate IS the kind, so an unprintable field is never
  // listed. It used to be optional for a bare `.describe()`, which listed a
  // field the generic widget could name and not print.
  valueKind: ValueKindSchema,
  list: ListFlag,
  values: EnumValues,
}).strict();
export type AttributeField = z.infer<typeof AttributeField>;

export const AttributeEntry = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("value"),
    object: ManifestObject,
    field: z.string().min(1),
    label: z.string().min(1),
    valueKind: ValueKindSchema,
    list: ListFlag,
    values: EnumValues,
  }).strict(),
  z.object({
    kind: z.literal("collection"),
    object: ManifestObject,
    collection: z.string().min(1),
    label: z.string().min(1),
    fields: z.array(AttributeField),
  }).strict(),
]);
export type AttributeEntry = z.infer<typeof AttributeEntry>;

/**
 * What a widget STORES when pointed at an attribute — structured, never a
 * string expression.
 *
 * This is the shape ADR-037's counter-proposal names, and the reason the
 * `{{…}}` syntax was dropped: a closed, validated param can express "this
 * lookup can miss" (decision 6's "not set up"), where a string parser cannot.
 *
 * **No member key.** It had one (`key: "Tokyo"`) until M14's field-widget
 * review (gap 4): it duplicated the `city` filter, and it is trip-specific, so
 * in a template copied to another trip it named a city that trip may not have.
 * Which member is read is the widget's filters and `narrow`, never a private
 * lookup here. Nothing stored one — no document or widget read this shape yet.
 */
export const AttributeRef = z.object({
  object: ManifestObject,
  /** Absent for a top-level value like `bookedCount`. */
  collection: z.string().min(1).optional(),
  field: z.string().min(1),
}).strict();
export type AttributeRef = z.infer<typeof AttributeRef>;

// The facts the `attribute` primitive reads that no delivered schema holds as
// a field of its own. They are roots so that its stored `field` values are
// manifest paths — one vocabulary, where there were two (M14 field-widget
// review). Each borrows the contract's own field schema, so none is a second
// declaration of `TripDetail` or `UserPreferences` (invariant 5); `described()`
// clones, so neither original schema is annotated.
//
// `countdown` is the exception with no schema to borrow: it is a sentence
// computed against the READER's today (`attribute.ts`), never stored or sent.
// `text` is what it prints as.
const TripFacts = z.object({
  name: described("text", "The trip's name", TripDetail.shape.name),
  budgetRemaining: described("money", "What's left of the budget", TripDetail.shape.budgetRemaining),
  countdown: described("text", "How long until it starts", z.string()),
});
const AccountFacts = z.object({
  name: described("text", "Your name", UserPreferences.shape.displayName),
  homeAirport: described("text", "Your home airport", UserPreferences.shape.homeAirport),
});

/**
 * The declared roots — a LIST someone has to add to deliberately, not a
 * default. Exported so a test can check each published field against the
 * schema it came from; walking them is still only `buildAttributeManifest`'s.
 *
 * `stop` is one activity's stored field set. Which stop is the widget's
 * filters' business, exactly as for a collection member.
 */
export const MANIFEST_ROOTS = {
  trip: [TripGlobals, TripFacts],
  account: [AccountFacts],
  stop: [ActivitySnapshot],
} as const satisfies Record<ManifestObject, readonly z.AnyZodObject[]>;

const ATTRIBUTE_FACTS = { trip: TripFacts, account: AccountFacts } as const;
type AttributeFactPath = {
  [O in keyof typeof ATTRIBUTE_FACTS]: `${O}.${Extract<keyof (typeof ATTRIBUTE_FACTS)[O]["shape"], string>}`;
}[keyof typeof ATTRIBUTE_FACTS];

/**
 * The paths `AttributeFieldRef` (pages.ts) is built from: every facts field,
 * in declaration order. Typed as literals so `attribute`'s `Record` over them
 * stays exhaustive; `manifest.test.ts` checks each is a published entry.
 */
export const ATTRIBUTE_FIELD_PATHS = (Object.keys(ATTRIBUTE_FACTS) as (keyof typeof ATTRIBUTE_FACTS)[])
  .flatMap((object) => Object.keys(ATTRIBUTE_FACTS[object].shape).map((field) => `${object}.${field}`)) as [
  AttributeFactPath,
  ...AttributeFactPath[],
];

/**
 * Stop fields the picker does not offer, although annotated — Mitchell's
 * "pluck" (M14 field widget, answer 2). Every annotated field is pickable for
 * now; one that makes no sense in testing is hidden here in one line. Typed
 * over the snapshot's keys, so renaming a field fails the build instead of
 * silently un-hiding it.
 */
export const HIDDEN_STOP_FIELDS: readonly (keyof ActivitySnapshot)[] = [];

// How to print one annotated field, or `undefined` if it has no kind and so is
// not published. `list` and `values` are read off the schema rather than
// declared, so neither can disagree with it.
function printable(schema: z.ZodTypeAny): Omit<AttributeField, "field"> | undefined {
  const note = annotationOf(schema);
  if (note?.kind === undefined) return undefined;
  const inner = unwrap(schema);
  const element = inner instanceof z.ZodArray ? unwrap(inner.element as z.ZodTypeAny) : inner;
  return {
    label: note.label,
    valueKind: note.kind,
    ...(inner instanceof z.ZodArray ? { list: true as const } : {}),
    ...(note.kind === "enum" && element instanceof z.ZodEnum ? { values: [...(element.options as string[])] } : {}),
  };
}

/**
 * The manifest, computed by reflection over the declared roots.
 *
 * Pure and cheap — it reads schema objects that already exist in memory and
 * performs no I/O — so a caller may build it per render rather than caching a
 * copy that could go stale against the schema it came from.
 *
 * `hiddenStopFields` can only take fields away. It is a parameter so the
 * exclusion is testable while the list is empty; it is not the "walk this
 * instead" seam `manifest.test.ts` explains refusing.
 */
export function buildAttributeManifest(
  hiddenStopFields: readonly (keyof ActivitySnapshot)[] = HIDDEN_STOP_FIELDS,
): AttributeEntry[] {
  const hidden = new Set<string>(hiddenStopFields);
  const entries: AttributeEntry[] = [];
  for (const object of MANIFEST_OBJECTS) {
    for (const root of MANIFEST_ROOTS[object] as readonly z.AnyZodObject[]) {
      for (const [key, rawField] of Object.entries(root.shape)) {
        if (object === "stop" && hidden.has(key)) continue;
        const field = rawField as z.ZodTypeAny;
        const note = annotationOf(field);
        // Gate 2: not annotated, not in the manifest.
        if (note === undefined) continue;
        if (note.kind !== undefined) {
          entries.push({ kind: "value", object, field: key, ...printable(field)! });
          continue;
        }
        // A label and no kind: `describedCollection`, an array of objects walked
        // for its members' own annotated fields.
        const inner = unwrap(field);
        const element = inner instanceof z.ZodArray ? unwrap(inner.element as z.ZodTypeAny) : undefined;
        if (!(element instanceof z.ZodObject)) continue;
        const fields = Object.entries(element.shape as Record<string, z.ZodTypeAny>)
          .flatMap(([name, member]): AttributeField[] => {
            const shown = printable(member);
            return shown ? [{ field: name, ...shown }] : [];
          });
        entries.push({ kind: "collection", object, collection: key, label: note.label, fields });
      }
    }
  }
  return entries;
}
