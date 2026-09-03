import { z } from "zod";
import { TripGlobals } from "./globals";

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

/** One readable thing, as the picker will list it. */
export type AttributeEntry =
  | { kind: "value"; object: "trip"; field: string; label: string }
  | {
      kind: "collection";
      object: "trip";
      collection: string;
      label: string;
      /** What can be read off one member of the collection. */
      fields: { field: string; label: string }[];
    };

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
}).strict();
export type AttributeRef = z.infer<typeof AttributeRef>;

// The declared roots. One entry today; the point is that it is a LIST someone
// has to add to deliberately, not a default.
const MANIFEST_ROOTS = { trip: TripGlobals } as const;

// Zod wraps: `.nullable()`, `.optional()` and `.default()` each produce a new
// schema around the inner one, and a description set before the wrap lives on
// the inner. Unwrapping is what makes `date: z.string().nullable().describe(…)`
// and `z.string().describe(…).nullable()` behave the same, which a reader would
// reasonably expect and would otherwise silently not get.
function unwrap(schema: z.ZodTypeAny): z.ZodTypeAny {
  let current = schema;
  for (;;) {
    const def = current._def as { innerType?: z.ZodTypeAny };
    if (!def.innerType) return current;
    current = def.innerType;
  }
}

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
          .map(([name, member]) => ({ field: name, label: describedLabel(member) }))
          .filter((f): f is { field: string; label: string } => f.label !== undefined);
        entries.push({ kind: "collection", object, collection: key, label, fields });
      } else {
        entries.push({ kind: "value", object, field: key, label });
      }
    }
  }
  return entries;
}
