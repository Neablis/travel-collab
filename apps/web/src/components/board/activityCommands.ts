import type { AddActivity, UpdateActivity } from "@tc/contracts";
import type { ActivityFormValue } from "./ActivityEditor";

/**
 * The one place `ActivityFormValue` becomes a command, and the only one that
 * is allowed to exist.
 *
 * **This module exists because hand-enumerating the form's fields has silently
 * dropped one four times**: KI-1 (day order), KI-54 (`Location.city`), M18's
 * editor sheet losing `kind` and `tags`, and PR #201's Board adapters losing
 * `bookedBy`/`participants` (plus `kind`, `tags` and `dayId`, which nobody had
 * noticed). Every one was the same shape — an object literal listing fields by
 * hand, where TypeScript has nothing to say about the field you forgot,
 * because every target field is optional and an omission is legal.
 *
 * `KI-2026-09-05-o` fixed this for the STORED shape by declaring the field set
 * once (`ActivitySnapshot`) and keying `FIELD_EQUAL` off it, so a ninth field
 * is a compile error at every site that must move. This is the same guarantee
 * for the FORM shape, which that refactor does not reach: `ActivityFormValue`
 * is the editor's own type, carrying `dayId` (which no stored activity has)
 * and omitting nothing.
 *
 * **How the guarantee works.** Each builder destructures every field by name
 * and collects the remainder in `...rest`, then asserts `rest` is empty. Add a
 * field to `ActivityFormValue` and it lands in `rest`, the assertion stops
 * compiling, and the error names this file — which is the whole point: the
 * next field cannot be dropped silently, it has to be dealt with here.
 *
 * Deliberately NOT a `Record<keyof ActivityFormValue, …>` mapper like
 * `FIELD_EQUAL`. That idiom fits when every field maps the same way; these do
 * not — the two commands disagree about `null`, and `dayId` belongs to one of
 * them and neither is a straight copy.
 */

/**
 * Compile-time proof that a destructuring consumed every field.
 *
 * `{}` satisfies `Record<string, never>`; an object with any property does not.
 * So this is a no-op at runtime and a hard stop at build time.
 */
type NothingLeftOver = Record<string, never>;

/**
 * The form's answer as an `AddActivity`.
 *
 * **`null` becomes `undefined` here, and that is the difference from update.**
 * On a create, absent and empty are the same thing: `AddActivity`'s optional
 * fields mean "not supplied", and the decider resolves each to its zero value.
 * Sending an explicit `null` would be saying "cleared", which is not a thing a
 * stop being created can be.
 */
export function addActivityCommand(
  tripId: string,
  activityId: string,
  value: ActivityFormValue,
): AddActivity {
  const {
    title,
    // The form's own Day select wins over the prefill once the user has
    // touched it — `value.dayId` already falls back to the prefill or the
    // first day via `ActivityEditor`'s default-day effect, so this forwards
    // its answer rather than re-deriving one. `null` means the backlog.
    dayId,
    timeWindow,
    location,
    notes,
    anchors,
    kind,
    tags,
    cost,
    bookedBy,
    participants,
    ...rest
  } = value;
  const _exhaustive: NothingLeftOver = rest;
  void _exhaustive;

  return {
    type: "AddActivity",
    tripId,
    activityId,
    dayId: dayId ?? undefined,
    title,
    timeWindow: timeWindow ?? undefined,
    location: location ?? undefined,
    notes: notes ?? undefined,
    anchors,
    kind,
    tags,
    cost: cost ?? undefined,
    bookedBy,
    participants,
  };
}

/**
 * The form's answer as an `UpdateActivity`.
 *
 * **`null` is passed through, because on an update it means "cleared".** That
 * is the opposite of the create path above: `UpdateActivity` reads omitted as
 * "unchanged", so mapping `null` to `undefined` here would turn every "remove
 * the time window" into a silent no-op.
 */
export function updateActivityCommand(
  tripId: string,
  activityId: string,
  value: ActivityFormValue,
): UpdateActivity {
  const {
    title,
    // **Deliberately not forwarded, and named here so the exhaustiveness
    // check cannot be satisfied by accident.** `UpdateActivity` carries no
    // `dayId` — `ActivityEditor`'s Day select is disabled in edit mode for
    // exactly this reason, and a cross-day move stays `MoveActivity`'s job
    // (drag and drop), not this form's.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructured to be DISCARDED, which is the point: naming it is what keeps the exhaustiveness check below honest, and a rest-spread that skipped it would let a future `dayId` change pass unnoticed
    dayId: _dayId,
    timeWindow,
    location,
    notes,
    anchors,
    kind,
    tags,
    cost,
    bookedBy,
    participants,
    ...rest
  } = value;
  const _exhaustive: NothingLeftOver = rest;
  void _exhaustive;

  return {
    type: "UpdateActivity",
    tripId,
    activityId,
    title,
    timeWindow,
    location,
    notes,
    anchors,
    kind,
    tags,
    cost,
    bookedBy,
    participants,
  };
}
