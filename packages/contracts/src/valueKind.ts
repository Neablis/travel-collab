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
export const VALUE_KINDS = ["money", "date", "count", "text", "duration"] as const;
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
// `.describe()` is still what carries the label, so a field annotated the old
// way keeps its label and simply has no kind. That is deliberate: it degrades
// to "listed but not printable" rather than to "silently absent".
const KINDS = new WeakMap<object, ValueKind>();

export function described<T extends z.ZodTypeAny>(kind: ValueKind, label: string, schema: T): T {
  const annotated = schema.describe(label) as T;
  KINDS.set(annotated, kind);
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

/**
 * The kind `described()` attached, or `undefined` for a bare `.describe()`.
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
export function valueKindOf(schema: object): ValueKind | undefined {
  const own = KINDS.get(schema);
  if (own !== undefined) return own;
  let current = schema as z.ZodTypeAny;
  for (;;) {
    const def = current._def as { innerType?: z.ZodTypeAny } | undefined;
    if (!def?.innerType) return undefined;
    current = def.innerType;
    const kind = KINDS.get(current);
    if (kind !== undefined) return kind;
  }
}
