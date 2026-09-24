import type { z } from "zod";

// How a readable value should be PRINTED — ADR-037 open question 4's settled
// answer: *"'How to serialize them' becomes a small closed set of value kinds —
// money, date, count, text, duration — each with one formatter.
// `packages/pages/src/format.ts` already has `formatMoney` and `formatDate`, so
// this is naming what exists rather than inventing it."*
//
// Closed on purpose. A generic attribute widget picks a formatter by this and
// nothing else, so an open string here would be a formatter lookup that can
// miss at render time — the failure decision 6's "not set up" exists to avoid.
//
// `enum` and `location` were added for M14's field widget (reviewed
// 2026-09-24, gap 3): an activity's kind or tag is a closed vocabulary that
// prints as a label rather than as free text, and a `Location` is an object
// that prints as a place rather than as any one of its fields.
//
// **A list is not a kind.** `cities: string[]` is `text`, and the manifest says
// `list: true` beside it — derived from the schema being a `ZodArray`, never
// declared. One list-kind per scalar kind would double this set, and a declared
// flag is a second fact that can disagree with the schema it describes, which
// is the drift the WeakMap below exists to avoid.
export const VALUE_KINDS = ["money", "date", "count", "text", "duration", "enum", "location"] as const;
export type ValueKind = (typeof VALUE_KINDS)[number];

// One line per field, and the line carries BOTH facts.
//
// Zod has no metadata slot in v3, so the kind rides in a `WeakMap` keyed by the
// schema object itself. That works because schemas are module singletons: the
// object `described()` returns is the same object the manifest later reflects
// over. The alternative — a parallel `Record<fieldName, ValueKind>` — is the
// hand-maintained second list invariant 5 exists to forbid, and it would drift
// from the schema the first time a field was renamed.
//
// **The label rides in the WeakMap too, and this map — not `.describe()` — is
// the manifest's opt-in** (M14 T06). `.describe()` is also the OpenAPI text of
// every public-API schema, so gating on it let API wording reach the picker
// and made a field described for the API alone a published one. `described()`
// still calls `.describe(label)`: that clone is what gives the WeakMap a key of
// its own (annotating a shared `ActivityTag` in place would annotate it
// everywhere), and `TripGlobals` is served by the public API, whose generated
// document carries these labels today.
//
// No kind means a collection — see `describedCollection`.
export interface Annotation {
  kind?: ValueKind;
  label: string;
}
const ANNOTATIONS = new WeakMap<object, Annotation>();

export function described<T extends z.ZodTypeAny>(kind: ValueKind, label: string, schema: T): T {
  const annotated = schema.describe(label) as T;
  ANNOTATIONS.set(annotated, { kind, label });
  return annotated;
}

/**
 * Publish an array of objects as a collection: walked for its members' own
 * `described()` fields, never printed itself, so it takes a label and no kind.
 */
export function describedCollection<T extends z.ZodArray<z.AnyZodObject>>(label: string, schema: T): T {
  const annotated = schema.describe(label) as T;
  ANNOTATIONS.set(annotated, { label });
  return annotated;
}

/**
 * Walk a schema's wrappers down to the thing being wrapped.
 *
 * `.nullable()`, `.optional()` and `.default()` each return a NEW schema whose
 * `_def.innerType` is the one they wrap, so anything attached to the inner
 * schema — a description, a value kind — is invisible from the outside. Shared
 * with the manifest's label lookup rather than written twice: the two must
 * agree about what "the same field" means, and they did not.
 */
export function unwrapSchema(schema: z.ZodTypeAny): z.ZodTypeAny {
  let current = schema;
  for (;;) {
    const def = current._def as { innerType?: z.ZodTypeAny };
    if (!def.innerType) return current;
    current = def.innerType;
  }
}

/** The kind `described()` attached, or `undefined` for a bare `.describe()` or a collection. */
export function valueKindOf(schema: object): ValueKind | undefined {
  return annotationOf(schema)?.kind;
}

/**
 * What `described()` or `describedCollection()` recorded, or `undefined` for a
 * bare `.describe()` — the manifest's opt-in and its label, in one lookup.
 *
 * **It walks wrappers, and reading only the outer schema was a real bug.** The
 * kind is attached to the exact object `described()` returned, so a normal later
 * combinator — `described("date", label, z.string()).nullable()` — produced a
 * wrapper this lookup did not recognise. `describedLabel` already unwrapped, so
 * the manifest kept the field's LABEL and lost its kind, and published it as
 * "listed but not printable": a field the generic attribute widget can name and
 * cannot render. Worse than either answer alone, because the entry looks
 * complete. Found by Copilot on PR 139.
 *
 * Checked at every level rather than only at the bottom, so both orders work —
 * `described(...).nullable()` and `described(kind, label, z.string().nullable())`.
 */
export function annotationOf(schema: object): Annotation | undefined {
  const own = ANNOTATIONS.get(schema);
  if (own !== undefined) return own;
  let current = schema as z.ZodTypeAny;
  for (;;) {
    const def = current._def as { innerType?: z.ZodTypeAny } | undefined;
    if (!def?.innerType) return undefined;
    current = def.innerType;
    const note = ANNOTATIONS.get(current);
    if (note !== undefined) return note;
  }
}
