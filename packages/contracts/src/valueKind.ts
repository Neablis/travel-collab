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

/** The kind `described()` attached, or `undefined` for a bare `.describe()`. */
export function valueKindOf(schema: object): ValueKind | undefined {
  return KINDS.get(schema);
}
