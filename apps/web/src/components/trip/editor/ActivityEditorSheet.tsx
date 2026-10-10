"use client";

import { travellerIds, type ActivityView, type NearbyStop } from "@tc/contracts";
import { useEffect, useState } from "react";
import { personNames } from "@tc/pages";
import { Banner } from "@/components/ui/banner";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { DataText } from "@/components/ui/data-text";
import { Text } from "@/components/ui/text";
import { ActivityEditor, type ActivityDayOption, type ActivityFormValue } from "@/components/board/ActivityEditor";
import { addActivityCommand } from "@/components/board/activityCommands";
import { editActivityCommands } from "@/components/board/editActivityCommands";
import { ActivityConflicts } from "@/components/trip/editor/ActivityConflicts";
import { useEditor } from "@/components/trip/context/EditorHost";
import { useTrip, type DispatchResult } from "@/components/trip/context/TripProvider";
import { peopleNamesOf, personasOf } from "@/components/pages/people";
import { dayLabel } from "@/lib/dates";
import { toClockRange } from "@/lib/time";
import { useTimeFormat } from "@/components/account/PreferencesProvider";
import { fetchNearbyStops } from "@/lib/apiClient";
import { formatMoney } from "@/lib/formatMoney";
import { stopTotalLine } from "@/lib/cost";
import { displayPlace, legEnd } from "@/lib/place";

// Behavior change #2 (M5 wave 2, resolves PR #11 comment #9): the activity
// editor is now a portable Sheet raised from EditorHost's own state, not
// rendered inline wherever a lens happens to trigger it. ActivityEditor's
// form markup/behavior is unchanged — this is only a new host surface.
//
// Redesign (Phase 7, Task 7.1): the "day note" block this used to render as a
// static paper sidecar is gone — its job (the day + slot-availability note)
// is now the design's real `Banner variant="success"`, computed live from
// Day/Start inside ActivityEditor itself (via fitIntoDay), not a one-shot
// value handed down here. This component's remaining job is just building
// the per-day option list (label + already-scheduled windows) that Banner
// needs, and wiring dayId correctly into AddActivity/UpdateActivity.
export function ActivityEditorSheet() {
  const { state, close } = useEditor();
  const { activeTrip, dispatch, dispatchBatch, canEditBoard, boardMode, access } = useTrip();
  // Opted in to suggest mode (W8): a suggester's save joins their draft, so
  // only a reader gets the read-only sheet.
  const readOnly = !canEditBoard;
  // From the provider's live access (W18), which is re-read on every access
  // change, so someone who joins while the page is open is named here as in
  // People. `usePeople()` read it once, and named them "Traveler 2".
  const people = access === null ? null : peopleNamesOf(access.members);

  const open = state.mode !== null;
  // A viewer never gets the form. This is the backstop for every caller of
  // `openEdit` the board surface does not own — MapLens, TimelineLens and
  // CalendarLens all raise the sheet, and all three are outside this change's
  // scope — so the sheet presents read-only regardless of which one opened it
  // (docs/reviews/2026-08-28-m11-pr71-review.md §5). The title changes with
  // it: "Edit activity" over a form nothing can save is a promise the sheet
  // does not keep. NOT the security boundary — the server refuses a viewer's
  // UpdateActivity/AddActivity independently, and TripProvider's own dispatch
  // gate refuses them before they reach the network.
  const title = readOnly ? "Activity" : state.mode === "edit" ? "Edit activity" : "Add a stop";

  const editingActivity: ActivityView | null =
    state.mode === "edit" && state.activityId !== undefined
      ? (activeTrip?.activities[state.activityId] ?? null)
      : null;

  // Seed a synthetic "initial" from the create-mode prefill so ActivityEditor's
  // existing initial-value mapping (ActivityView shape) can be reused unchanged.
  // Its timeWindow (e.g. TimelineLens's nextSlot) is also what ActivityEditor
  // reverse-maps into an initial "How long" selection (closestDurationLabel).
  //
  // `kind: "pending"` (`hold` before M28), not the contract's `"planned"` zero value: a stop a person
  // creates through this form is more likely to need booking than not, and the
  // picker should preselect that rather than an empty-reading default (Mitchell,
  // 2026-08-29). This is a UI default, not the domain's — a command that omits
  // `kind` still resolves to `planned` (decide.ts), and the fixture always
  // states a kind explicitly, so neither is touched by this.
  const createInitial: ActivityView | null =
    state.mode === "create" && state.prefill !== undefined
      ? {
          activityId: "",
          title: "",
          timeWindow: state.prefill.timeWindow ?? null,
          location: state.prefill.location ?? null,
          notes: null,
          anchors: [],
          kind: "pending" as const,
          tags: [],
          cost: null,
          // M13 link 5. A stop being created is attributed to nobody until
          // somebody says otherwise — "nobody yet" and "everyone's business",
          // not "unknown".
          bookedBy: null,
          participants: [],
          mode: null,
          endLocation: null,
          pendingReason: null,
        }
      : null;

  // Create mode gets its dayId straight from the openCreate() prefill (e.g.
  // TimelineLens's "Add stop"); edit mode looks up which day already lists
  // this activityId. Either can come back with no match (a MapLens
  // create-by-coordinate has no dayId; a backlog activity belongs to no
  // day) — ActivityEditor's own default-day effect handles that (falls back
  // to the first day in create mode, stays unselected in edit mode) rather
  // than this component guessing one.
  const editingActivityId = state.mode === "edit" ? state.activityId : undefined;
  // A suggester has no rack (W71), so a stop they add with no day named — the
  // header's bare "Add stop" — starts on the first day rather than in a drawer
  // they cannot open. The Day select then offers no "Unscheduled" at all.
  const defaultDayId =
    state.mode === "create"
      ? (state.prefill?.dayId ?? (boardMode === "suggest" ? activeTrip?.days[0]?.dayId : undefined))
      : editingActivityId !== undefined
        ? activeTrip?.days.find((d) => d.activityIds.includes(editingActivityId))?.dayId
        : undefined;

  // M34: library stops near the day being added to, fetched once per opening
  // and filtered as the person types (D5). Create mode only (D12). A failed
  // read is an empty list: suggestions are a convenience, and must never stand
  // between someone and adding a stop. Results are kept against the request
  // they answer, so a reply that lands after the sheet closed or moved on to
  // another day is never shown.
  //
  // Not refetched when the Day select changes: that choice lives in the
  // editor, and the list stays the one for the day the sheet opened on.
  // A MapLens double-click has a coordinate and no day: the coordinate is the
  // anchor distance is ranked from. `fetchNearbyStops` sends it only as a pair.
  const lat = state.mode === "create" ? state.prefill?.location?.lat : undefined;
  const lng = state.mode === "create" ? state.prefill?.location?.lng : undefined;
  const tripId = activeTrip?.tripId;
  const nearbyKey =
    open && !readOnly && state.mode === "create" && tripId !== undefined
      ? `${tripId}|${defaultDayId ?? ""}|${lat ?? ""}|${lng ?? ""}`
      : null;
  const [nearby, setNearby] = useState<{ key: string; stops: NearbyStop[] } | null>(null);
  useEffect(() => {
    // Closed (or editing): forget the last list. Reopening on the same day is
    // the same key, and a list kept across a close would show again at once,
    // and stay there if the new read failed (CodeRabbit, PR 334).
    if (nearbyKey === null || tripId === undefined) {
      setNearby(null);
      return;
    }
    let current = true;
    void fetchNearbyStops(tripId, { dayId: defaultDayId, lat, lng }).then((result) => {
      if (current && result.ok) setNearby({ key: nearbyKey, stops: result.value.stops });
    });
    return () => {
      current = false;
    };
  }, [nearbyKey, tripId, defaultDayId, lat, lng]);
  const nearbyStops = nearby !== null && nearby.key === nearbyKey ? nearby.stops : [];

  const memberIds = activeTrip?.members.map((m) => m.userId) ?? [];
  const names = activeTrip === null ? new Map<string, string>() : personNames(activeTrip, people, memberIds);
  const personas = access === null ? null : personasOf(access.members);
  const namedMembers = (activeTrip?.members ?? []).map(({ userId, travelling }) => ({
    userId,
    name: names.get(userId)!,
    travelling,
    avatar: personas?.[userId]?.avatar,
    color: personas?.[userId]?.color,
  }));

  const dayOptions: ActivityDayOption[] =
    activeTrip?.days.map((day, index) => ({
      dayId: day.dayId,
      label: dayLabel(activeTrip.startDate, index),
      // Other stops already on this day, excluding whichever activity is
      // being edited — the same existing:Slot[] shape
      // `editActivityCommands` builds for fitIntoDay.
      existing: day.activityIds
        .filter((id) => id !== editingActivityId)
        .map((id) => activeTrip.activities[id]?.timeWindow)
        .filter((w): w is { start: string; end: string } => w !== null && w !== undefined),
    })) ?? [];

  // **Closed only once the change is accepted** (Mitchell, PR #269 preview:
  // "i cant add a stop, it just closes with no message"). This closed
  // unconditionally, so a refused command — every edit on a deleted trip, the
  // case he hit — shut the sheet and threw away what was typed, with the
  // reason on a line under the header that a scrolled board hides. A refusal
  // now keeps the sheet and the form as they are and says why, here. Cleared
  // whenever the sheet closes, so it never greets the next stop.
  const [refusal, setRefusal] = useState<string | null>(null);
  if (!open && refusal !== null) setRefusal(null);

  async function handleSave(value: ActivityFormValue) {
    if (activeTrip === null) return;
    // Unreachable while the form is not rendered for a viewer; kept so the
    // gate does not depend on the render branch above staying correct.
    if (readOnly) return;
    // Both commands are built by `activityCommands`, which destructures every
    // `ActivityFormValue` field and asserts nothing is left over. That is the
    // standing fix the M18 comment that used to sit here asked for: the two
    // literals it warned about are gone, and a field added to the form is now
    // a compile error in one file rather than a silent drop in several.
    let result: DispatchResult = { ok: true };
    if (state.mode === "edit" && state.activityId !== undefined) {
      // A changed day is a move as well as an update, sent as one batch
      // (M41 D3); an unchanged one is the single update it always was.
      const commands = editActivityCommands(activeTrip, state.activityId, value);
      result = commands.length === 1 ? await dispatch(commands[0]!) : await dispatchBatch(commands);
    } else if (state.mode === "create") {
      result = await dispatch(addActivityCommand(activeTrip.tripId, crypto.randomUUID(), value));
    }
    if (!result.ok) {
      setRefusal(result.message);
      return;
    }
    close();
  }

  // M41 D4: the editor is where a stop is removed from, now that the rack's
  // cards carry no controls. Refused, it stays open and says why, like a save.
  async function handleRemove() {
    if (activeTrip === null || readOnly || state.activityId === undefined) return;
    const result = await dispatch({ type: "RemoveActivity", tripId: activeTrip.tripId, activityId: state.activityId });
    if (!result.ok) return setRefusal(result.message);
    close();
  }

  return (
    <Sheet title={title} open={open} onOpenChange={(next) => { if (!next) close(); }}>
      {open && editingActivityId !== undefined && activeTrip !== null && (
        // KI-43: every conflict naming this stop, dismissed ones included.
        // Edit mode only — a stop being created has no id yet, so nothing can
        // name it, and the domain has not run a rule against it either.
        <ActivityConflicts
          conflicts={activeTrip.conflicts}
          dismissedConflictIds={activeTrip.dismissedConflictIds}
          activityId={editingActivityId}
        />
      )}
      {open && readOnly && (
        <ReadOnlyActivity
          activity={editingActivity}
          currency={activeTrip?.currency ?? "USD"}
          travellerCount={travellerIds(activeTrip?.members ?? []).length}
          onClose={close}
        />
      )}
      {open && !readOnly && refusal !== null && (
        <Banner variant="danger" className="mb-3" data-testid="activity-save-refused">
          {refusal} Nothing was saved.
        </Banner>
      )}
      {open && !readOnly && (
        <ActivityEditor
          // Edit mode's key includes whether the real activity has loaded
          // yet, not just its id — activeTrip is null only during a trip's
          // very first fetch (TripProvider never nulls it out again once
          // loaded), and nothing today can trigger openEdit before that
          // fetch resolves (every caller only renders a clickable activity
          // once activeTrip itself is non-null). Still worth guarding: if
          // that ever changes (e.g. a future deep-link opens edit mode on
          // load), a null `initial` would otherwise seed ActivityEditor's
          // fields blank once and never re-seed when the real data arrives
          // a moment later, since React reuses the instance across
          // re-renders with the same key — a save would then silently
          // overwrite real fields with blanks (CodeRabbit, PR #32).
          key={state.mode === "edit" ? `${state.activityId}-${editingActivity ? "loaded" : "pending"}` : "create"}
          mode={state.mode === "edit" ? "edit" : "create"}
          initial={state.mode === "edit" ? editingActivity : createInitial}
          days={dayOptions}
          defaultDayId={defaultDayId}
          tripCurrency={activeTrip?.currency ?? "USD"}
          // M13 link 5. The trip's own member list is the only vocabulary the
          // attribution controls offer, so an id from nowhere is not reachable
          // through the product — which is why the domain does not validate it.
          // Named by `personNames` over `PeopleProvider`'s names (mounted by
          // TripBoardScreen): "Traveler 2" until they land, never the id.
          members={namedMembers}
          nearbyStops={nearbyStops}
          onSave={handleSave}
          onCancel={close}
          onRemove={state.mode === "edit" ? () => void handleRemove() : undefined}
        />
      )}
    </Sheet>
  );
}

// A viewer's presentation of the sheet: what the stop actually is, with no
// control that would dispatch. It exists because the notes field has no other
// surface in the app — dropping the sheet entirely for a viewer would hide
// real content, not just an affordance.
function ReadOnlyActivity({
  activity,
  currency,
  travellerCount,
  onClose,
}: {
  activity: ActivityView | null;
  currency: string;
  travellerCount: number;
  onClose: () => void;
}) {
  const clock = useTimeFormat();
  const destination = activity === null ? null : legEnd(activity);
  return (
    <div className="flex flex-col gap-3">
      {activity === null ? (
        <Text as="p" variant="secondary">
          You have view-only access to this trip.
        </Text>
      ) : (
        <>
          <Text as="p" className="font-medium">{activity.title}</Text>
          <DataText size="xs" className="block">
            {activity.timeWindow === null
              ? "No time yet"
              : toClockRange(activity.timeWindow.start, activity.timeWindow.end, clock)}
          </DataText>
          {activity.location && (
            <Text as="p" variant="secondary">{displayPlace(activity.location)}</Text>
          )}
          {/* The editable form names a leg's destination in its "Going to"
              field; a viewer, who gets no form, read only the origin here. */}
          {destination !== null && (
            <Text as="p" variant="secondary">Going to {displayPlace(destination)}</Text>
          )}
          <DataText size="xs" className="block">
            {activity.cost === null ? "No cost yet" : `${formatMoney(activity.cost.amountMinor, currency)} per person`}
          </DataText>
          {/* The same line the editor shows under its Cost field (ADR-060). */}
          {activity.cost !== null && (
            <Text variant="muted" data-testid="activity-cost-total">
              {stopTotalLine(activity, travellerCount, currency)}
            </Text>
          )}
          {activity.notes !== null && activity.notes !== "" && (
            <Text as="p" variant="secondary">{activity.notes}</Text>
          )}
          <Text as="p" variant="secondary">You have view-only access to this trip.</Text>
        </>
      )}
      <div className="flex justify-end">
        <Button variant="secondary" onClick={onClose}>Close</Button>
      </div>
    </div>
  );
}
