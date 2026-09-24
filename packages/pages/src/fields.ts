import {
  HIDDEN_STOP_FIELDS,
  buildAttributeManifest,
  type ActivitySnapshot,
  type ManifestObject,
  type ValueKind,
} from "@tc/contracts";

// What a `field` input can be pointed at (M14 field widget, build step 5):
// the attribute manifest's published fields for one object, flattened into the
// list a picker shows and the path a document stores.
//
// **The path is `object.field`, or `object.collection.field` for a member of a
// collection** — the spelling `AttributeFieldRef` already stores
// (`trip.name`), so there is one field vocabulary rather than two. It is what
// a document keeps and what the assistant writes; a person never sees it. The
// picker shows `label` under `group` (ADR-037 open question 4: *"never drop
// the end user into raw string paths"*).

/** One pickable field. `path` is stored; `label` and `group` are shown. */
export interface FieldChoice {
  path: string;
  label: string;
  group: string;
  valueKind: ValueKind;
  list?: true;
  values?: readonly string[];
}

// The heading a top-level value sits under. A collection's members sit under
// the collection's own manifest label instead ("Every day of the trip").
const OBJECT_GROUP: Record<ManifestObject, string> = {
  trip: "The trip",
  account: "Your account",
  stop: "The stop",
};

/**
 * Every field a `field` input over `of` may offer, in manifest order.
 *
 * Built from the manifest on each call, which `buildAttributeManifest` says is
 * the intended use: it is reflection over schemas already in memory, and a
 * cached copy is the one thing that could disagree with them.
 */
export function fieldChoices(
  of: ManifestObject,
  hiddenStopFields: readonly (keyof ActivitySnapshot)[] = HIDDEN_STOP_FIELDS,
): FieldChoice[] {
  return buildAttributeManifest(hiddenStopFields)
    .filter((entry) => entry.object === of)
    .flatMap((entry): FieldChoice[] => {
      if (entry.kind === "value") {
        const { field, label, valueKind, list, values } = entry;
        return [{ path: `${of}.${field}`, label, group: OBJECT_GROUP[of], valueKind, list, values }];
      }
      return entry.fields.map(({ field, label, valueKind, list, values }) => ({
        path: `${of}.${entry.collection}.${field}`,
        label,
        group: entry.label,
        valueKind,
        list,
        values,
      }));
    })
    // `list` and `values` are absent rather than `undefined` on a field that
    // has neither, so a choice compares equal to one written out by hand.
    .map((choice) => Object.fromEntries(Object.entries(choice).filter(([, v]) => v !== undefined)) as FieldChoice);
}

/**
 * The published field a stored path names, or `undefined`.
 *
 * **This is the resolve-time check, and there is deliberately no write-time
 * one.** A field input's param is a plain string in the schema, so a page
 * naming a field this build no longer publishes still saves — gap 1 of the M14
 * field-widget review was exactly a page locked by one stale widget. Renames and
 * removals are converted by `PAGE_DOC_MIGRATIONS`; this is what a resolver
 * reads through, so an unannotated field (`bookedBy`, which holds user ids) is
 * unreachable however the string was written (gap 6).
 */
export function fieldAt(of: ManifestObject, path: unknown): FieldChoice | undefined {
  if (typeof path !== "string") return undefined;
  return fieldChoices(of).find((choice) => choice.path === path);
}
