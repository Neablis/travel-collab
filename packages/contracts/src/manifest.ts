import { z } from "zod";
import { TripGlobals } from "./globals";
// `unwrapSchema` is shared with `valueKindOf` rather than kept here: the label
// lookup and the kind lookup must agree about what "the same field" means, and
// while they were two walks they did not (Copilot, PR 139).
import { VALUE_KINDS, unwrapSchema as unwrap, valueKindOf, type ValueKind } from "./valueKind";

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
//      is ever walked — `TripGlobals` and nothing else. Pointing this at
//      `TripDetail` would publish the trip's internals, and no code path can do
//      that by accident because there is no "walk everything" entry point.
//   2. **The field must carry `.describe()`.** That is the "one line per field"
//      the ADR calls still-free, and it doubles as the human label the picker
//      shows. A field with no description is not in the manifest — so the
//      default for anything added later is EXCLUDED, which is the direction
//      that fails safe.
//
// The consequence worth stating plainly: adding a described field to
// `TripGlobals` publishes it, and adding an undescribed one does not. That is
// the whole contract, and `manifest.test.ts` asserts both halves.

// One readable thing, as the picker will list it.
//
// A Zod schema rather than a hand-written type, on Copilot's finding (PR 134):
// invariant 5 says cross-boundary types in this package are "Zod schemas; types
// inferred, never hand-written twice", and this is exported from `contracts`.
// It also earns its keep beyond the letter of the rule — `manifest.test.ts` now
// parses the builder's output through it, so a malformed entry is a test
// failure rather than a shape nobody checks.
const ValueKindSchema = z.enum(VALUE_KINDS);

/** What can be read off one member of a collection. */
export const AttributeField = z.object({
  field: z.string().min(1),
  label: z.string().min(1),
  // Absent when the field carries a label but no kind — see `described()`.
  // A picker can list it and a generic widget cannot print it, which is the
  // honest degradation rather than guessing a formatter.
  valueKind: ValueKindSchema.optional(),
}).strict();
export type AttributeField = z.infer<typeof AttributeField>;

export const AttributeEntry = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("value"),
    object: z.literal("trip"),
    field: z.string().min(1),
    label: z.string().min(1),
    valueKind: ValueKindSchema.optional(),
  }).strict(),
  z.object({
    kind: z.literal("collection"),
    object: z.literal("trip"),
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
 * lookup can miss" (decision 6's "not set up"), where a string parser cannot
 * tell `cities[Tokyo]` — a lookup that may find nothing — from a property
 * access that returns `undefined` and then throws on `.length`.
 */
export const AttributeRef = z.object({
  object: z.literal("trip"),
  /** Absent for a top-level value like `bookedCount`. */
  collection: z.string().min(1).optional(),
  /** Which member, for a collection. Absent means the collection itself. */
  key: z.string().min(1).optional(),
  field: z.string().min(1),
}).strict().refine((ref) => ref.collection !== undefined || ref.key === undefined, {
  // Found by Copilot on PR 134. `collection` and `key` were independently
  // optional, so `{ object: "trip", key: "Tokyo", field: "bookedCount" }`
  // parsed — a member of no collection, which is not a reference to anything.
  // Calling this format "closed and validated" while it accepted a shape with
  // no meaning was the gap.
  message: "a key names a member of a collection, so `collection` is required whenever `key` is set",
  path: ["collection"],
});
export type AttributeRef = z.infer<typeof AttributeRef>;

// The declared roots. One entry today; the point is that it is a LIST someone
// has to add to deliberately, not a default.
const MANIFEST_ROOTS = { trip: TripGlobals } as const;

// Zod wraps: `.nullable()`, `.optional()` and `.default()` each produce a new
// schema around the inner one, and a description set before the wrap lives on
// the inner. Unwrapping is what makes `date: z.string().nullable().describe(…)`
// and `z.string().describe(…).nullable()` behave the same, which a reader would
// reasonably expect and would otherwise silently not get.
function describedLabel(schema: z.ZodTypeAny): string | undefined {
  return schema.description ?? unwrap(schema).description;
}

/**
 * The manifest, computed by reflection over the declared roots.
 *
 * Pure and cheap — it reads schema objects that already exist in memory and
 * performs no I/O — so a caller may build it per render rather than caching a
 * copy that could go stale against the schema it came from.
 */
export function buildAttributeManifest(): AttributeEntry[] {
  const entries: AttributeEntry[] = [];
  for (const [object, root] of Object.entries(MANIFEST_ROOTS) as ["trip", typeof TripGlobals][]) {
    for (const [key, rawField] of Object.entries(root.shape)) {
      const field = rawField as z.ZodTypeAny;
      const label = describedLabel(field);
      // Gate 2: no description, not in the manifest.
      if (label === undefined) continue;
      const inner = unwrap(field);
      if (inner instanceof z.ZodArray) {
        const element = unwrap(inner.element as z.ZodTypeAny);
        // An array of anything but an object is not addressable as a
        // collection — there are no fields to pick from — so it is skipped
        // rather than published as a collection with none.
        if (!(element instanceof z.ZodObject)) continue;
        const fields = Object.entries(element.shape as Record<string, z.ZodTypeAny>)
          .flatMap(([name, member]): AttributeField[] => {
            const memberLabel = describedLabel(member);
            if (memberLabel === undefined) return [];
            const memberKind = valueKindOf(member);
            return [{ field: name, label: memberLabel, ...(memberKind ? { valueKind: memberKind } : {}) }];
          });
        entries.push({ kind: "collection", object, collection: key, label, fields });
      } else {
        const fieldKind = valueKindOf(field);
        entries.push({ kind: "value", object, field: key, label, ...(fieldKind ? { valueKind: fieldKind } : {}) });
      }
    }
  }
  return entries;
}
