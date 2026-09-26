"use client";

import { useEffect, useState } from "react";
import { type ActivityKind, type ActivityMode, type ActivityTag, type ActivityView, type Anchor, type Location, type Money, type PendingReason, type TimeWindow, type TripMember } from "@tc/contracts";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Banner } from "@/components/ui/banner";
import { Preview } from "@/components/ui/preview";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Text } from "@/components/ui/text";
import { Textarea } from "@/components/ui/textarea";
import { toClockRange, toMinutes, toTimeString } from "@/lib/time";
import { useTimeFormat } from "@/components/account/PreferencesProvider";
import type { Slot } from "@/components/trip/fitIntoDay";
import {
  closestDurationLabel,
  DEFAULT_DURATION_LABEL,
  DURATION_OPTIONS,
  durationMinutes,
  type DurationLabel,
} from "./activityDuration";
import { KIND_LABEL, KIND_OPTIONS } from "./activityKind";
import { TAG_LABEL, TAG_ORDER, toggleTag } from "@/lib/activityTags";
import { LocationInput } from "./LocationInput";
import { MoneyInput } from "./MoneyInput";
import { PendingReasonPicker } from "./PendingReasonPicker";
import { TravelModePicker } from "./TravelModePicker";

export type ActivityFormValue = {
  title: string;
  dayId: string | null;
  timeWindow: TimeWindow | null;
  location: Location | null;
  notes: string | null;
  anchors: Anchor[];
  kind: ActivityKind;
  tags: ActivityTag[];
  cost: Money | null;
  // M13 link 5. Two relations, not one (Mitchell, 2026-09-03): who BOOKED a
  // stop is not who is GOING to it, and M19's splits need the participants.
  bookedBy: string | null;
  participants: string[];
  // M24. Only ever non-null while `kind` is "transit": the form clears both on
  // save otherwise, because the decider refuses a leg on any other kind.
  mode: ActivityMode | null;
  endLocation: Location | null;
  // ADR-055. Only ever non-null while `kind` is "pending", for the same reason.
  pendingReason: PendingReason | null;
};

// One option per trip day for the "Day" NativeSelect, plus that day's
// already-scheduled windows (excluding whatever activity is being edited) —
// the availability Banner below feeds these straight into fitIntoDay.
// One line under the Kind control saying what the chosen kind means — the
// handoff's `kindHelp`. Exhaustive, so a fourth kind needs a sentence.
const KIND_HELP: Record<ActivityKind, string> = {
  planned: "You intend to do it",
  pending: "Not locked in yet",
  transit: "Moving between the stops either side",
};

export type ActivityDayOption = { dayId: string; label: string; existing: Slot[] };

// Illustrative only (Preview id="add-stop-suggestions", M9 — grounded place
// search doesn't exist yet, so nothing generates real matches from what the
// user types into "What or where"). Static shape for the design's
// list-of-buttons layout, not real data.
const SUGGESTED_MATCH_SHAPE = [
  { kind: "Place", name: "Example match", detail: "Appears once M9 grounding is wired up" },
] as const;

// Illustrative only (Preview id="add-stop-who", M13 — no field records who a
// stop is for yet, so there is nothing real to list per-stop).
// M13 link 5 replaced the `add-stop-who` Preview placeholder that stood here
// (a single hardcoded "Everyone" chip) with the real control below.

export function ActivityEditor({
  initial,
  mode,
  days,
  defaultDayId,
  tripCurrency = "USD",
  members = [],
  onSave,
  onCancel,
}: {
  initial: ActivityView | null;
  mode: "create" | "edit";
  days: ActivityDayOption[];
  // The day to preselect: a create-mode prefill's dayId, or (edit mode) the
  // day that already lists this activity. Left undefined when neither
  // applies (a MapLens create-by-coordinate, or a backlog activity) — the
  // selection then falls back to "no day" rather than guessing one.
  defaultDayId?: string;
  tripCurrency?: string;
  /**
   * The trip's members, as the only options this form offers for attribution
   * (M13 link 5). Defaulted to `[]` so every existing caller and test keeps
   * working: with no members there is nobody to attribute to, and the section
   * renders a plain "nobody else is on this trip yet" rather than an empty
   * control that looks broken.
   */
  members?: TripMember[];
  onSave: (value: ActivityFormValue) => void;
  onCancel: () => void;
}) {
  const clock = useTimeFormat();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [start, setStart] = useState(initial?.timeWindow?.start ?? "");
  // Edit mode only: a stop being edited already has an end time, and forcing
  // it back through the duration dropdown would lose precision (Task 7.1).
  const [end, setEnd] = useState(initial?.timeWindow?.end ?? "");
  const [durationLabel, setDurationLabel] = useState<DurationLabel>(() => {
    if (initial?.timeWindow) {
      const minutes = toMinutes(initial.timeWindow.end) - toMinutes(initial.timeWindow.start);
      if (minutes > 0) return closestDurationLabel(minutes);
    }
    return DEFAULT_DURATION_LABEL;
  });
  const [location, setLocation] = useState<Location | null>(initial?.location ?? null);
  // No UI reaches anchors (D-1, see packages/domain/src/trip/conflicts.ts) — the
  // editor never lets a user set them, but still round-trips whatever value the
  // activity already carries so existing anchors aren't silently dropped.
  const anchors: Anchor[] = initial?.anchors ?? [];
  const [notes, setNotes] = useState(initial?.notes ?? "");
  // A stop being edited starts wherever it already sits. One being CREATED
  // starts at `pending` (`hold` before M28 folded it in), not the contract's
  // `planned` zero value: a new stop is more likely to need booking than not
  // (Mitchell, 2026-08-29) — see ActivityEditorSheet's `createInitial` for the
  // same call on the prefilled path. This `??` only fires for
  // `initial === null` — the bare "Add stop" with no prefill;
  // ActivityEditorSheet already supplies "pending" whenever it builds an
  // initial value at all, and an edit's `initial` carries the activity's own
  // real kind.
  const [kind, setKind] = useState<ActivityKind>(initial?.kind ?? (mode === "create" ? "pending" : "planned"));
  const [tags, setTags] = useState<ActivityTag[]>(initial?.tags ?? []);
  const [bookedBy, setBookedBy] = useState<string | null>(initial?.bookedBy ?? null);
  const [participants, setParticipants] = useState<string[]>(initial?.participants ?? []);
  const [cost, setCost] = useState<Money | null>(initial?.cost ?? null);
  // Kept while the kind is switched away, so switching back does not lose
  // them; only what is SAVED is cleared (see submit).
  const [travelMode, setTravelMode] = useState<ActivityMode | null>(initial?.mode ?? null);
  const [endLocation, setEndLocation] = useState<Location | null>(initial?.endLocation ?? null);
  // A stop being CREATED says "To book" until told otherwise — the handoff's
  // own default (`addWhy || 'book'`), and the same bet the `pending` default
  // above makes. A stop being edited keeps what it has, including no reason.
  // Kept across a kind switch like the leg above; only the save clears it.
  const [pendingReason, setPendingReason] = useState<PendingReason | null>(
    initial?.pendingReason ?? (mode === "create" ? "book" : null),
  );
  const [error, setError] = useState<string | null>(null);
  const [selectedDayId, setSelectedDayId] = useState(defaultDayId ?? "");

  // `days` (and therefore `defaultDayId`) can arrive empty on first render —
  // activeTrip loads asynchronously in ActivityEditorSheet — so the default
  // selection is applied once a real defaultDayId shows up, not just at
  // mount. Guarded on `selectedDayId === ""` so it never overwrites a user's
  // own choice. Deliberately does NOT fall back to the first day when there
  // is no prefill at all (e.g. TripHeader's bare "Add stop", openCreate()
  // with no dayId): that is the header's own create-unscheduled trigger —
  // AGENTS.md's "real" feature list names the unscheduled rack "incl. drag
  // both ways", and e2e (m1-board.spec.ts, m2-history.spec.ts) asserts stops
  // created this way land in the rack, not on Day 1. Leaving selectedDayId
  // at "" surfaces the Day select's own "Unscheduled" option instead, and
  // the resulting dayId: null / undefined round-trips through AddActivity
  // exactly as it did before this task.
  useEffect(() => {
    if (selectedDayId !== "" || defaultDayId === undefined) return;
    setSelectedDayId(defaultDayId);
  }, [defaultDayId, selectedDayId]);

  const selectedDay = days.find((d) => d.dayId === selectedDayId);

  // The window the availability Banner below reports on — must match what
  // submit() below actually saves (start + selected duration in create
  // mode, the explicit End time in edit mode), not some other window a
  // separate suggestion algorithm might prefer (CodeRabbit, PR #32).
  const actualEnd =
    mode === "edit" ? end : start !== "" ? toTimeString(toMinutes(start) + durationMinutes(durationLabel)) : "";
  const overlapsExisting =
    selectedDay !== undefined &&
    start !== "" &&
    actualEnd !== "" &&
    selectedDay.existing.some((w) => toMinutes(start) < toMinutes(w.end) && toMinutes(w.start) < toMinutes(actualEnd));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedTitle = title.trim();
    if (trimmedTitle === "") return setError("Title is required");

    let timeWindow: TimeWindow | null = null;
    if (mode === "edit") {
      if ((start === "") !== (end === "")) return setError("Provide both start and end times");
      if (start !== "" && start >= end) return setError("End time must be after start time");
      timeWindow = start !== "" ? { start, end } : null;
    } else if (start !== "") {
      const computedEnd = toTimeString(toMinutes(start) + durationMinutes(durationLabel));
      timeWindow = { start, end: computedEnd };
    }

    onSave({
      title: trimmedTitle,
      dayId: selectedDayId !== "" ? selectedDayId : null,
      timeWindow,
      location,
      notes: notes.trim() !== "" ? notes.trim() : null,
      anchors,
      kind,
      // Always the complete set: `UpdateActivity.tags` is a whole-array
      // replace, not a delta (packages/contracts/src/activity.ts).
      tags,
      bookedBy,
      // Always the complete list, for the same reason `tags` is: the command
      // replaces the array wholesale rather than adding to it.
      participants,
      cost,
      mode: kind === "transit" ? travelMode : null,
      endLocation: kind === "transit" ? endLocation : null,
      pendingReason: kind === "pending" ? pendingReason : null,
    });
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-3">
      <FormField
        id="activity-title"
        label="What or where"
        description="Type a place and we fill in the address, hours and travel time."
      >
        <Input
          id="activity-title"
          aria-label="What or where"
          placeholder="e.g. Dinner at Kikunoi Roan"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </FormField>

      <Preview id="add-stop-suggestions" size="container">
        <ul className="m-0 list-none divide-y divide-hairline rounded-lg border border-hairline p-0">
          {SUGGESTED_MATCH_SHAPE.map((match) => (
            <li key={match.name}>
              <Button variant="ghost" className="h-auto w-full justify-start gap-2 px-3 py-2 text-left">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-sm bg-moss text-xs text-ink">
                  {match.kind[0]}
                </span>
                <span className="flex flex-col">
                  <Text as="span" className="text-sm text-ink">
                    {match.name}
                  </Text>
                  <Text as="span" variant="muted">
                    {match.detail}
                  </Text>
                </span>
              </Button>
            </li>
          ))}
        </ul>
      </Preview>

      <LocationInput value={location} onChange={setLocation} />

      <div className="activity-editor-grid">
        <div className="flex flex-col gap-1">
          <Label htmlFor="activity-day">Day</Label>
          <NativeSelect
            id="activity-day"
            value={selectedDayId}
            onChange={(e) => setSelectedDayId(e.target.value)}
            // Edit mode has no command that moves a stop between days from
            // this form (UpdateActivity carries no dayId — that's what
            // MoveActivity/drag-and-drop already do). Shown for context, not
            // editable here, rather than a control that silently no-ops.
            disabled={mode === "edit"}
          >
            {selectedDayId === "" && <option value="">Unscheduled</option>}
            {days.map((day) => (
              <option key={day.dayId} value={day.dayId}>
                {day.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="activity-start">Start</Label>
          <Input
            id="activity-start"
            aria-label="Start"
            type="time"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </div>
        {mode === "edit" ? (
          <div className="flex flex-col gap-1">
            <Label htmlFor="activity-end-time">End time</Label>
            <Input
              id="activity-end-time"
              aria-label="End time"
              type="time"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <Label htmlFor="activity-duration">How long</Label>
            <NativeSelect
              id="activity-duration"
              value={durationLabel}
              onChange={(e) => setDurationLabel(e.target.value as DurationLabel)}
            >
              {DURATION_OPTIONS.map((option) => (
                <option key={option.label} value={option.label}>
                  {option.label}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
      </div>

      {selectedDay && start !== "" && actualEnd !== "" ? (
        overlapsExisting ? null : (
          // "success" only when the window actually about to be saved is
          // clear — describing start+How-long (or the explicit edit-mode
          // end), not some other window fitIntoDay might have suggested
          // instead. fitIntoDay picks its OWN duration from the day's free
          // gaps, ignoring the user's own "How long" choice, so calling it
          // here could report a slot that fits while a Half day selection
          // actually saves a longer, conflicting one (CodeRabbit, PR #32).
          // A real overlap still isn't blocked — Invariant 3, conflicts are
          // data, not errors — it just doesn't get a false "Fits" banner;
          // the domain's own time-overlap conflict surfaces it after save.
          <Banner variant="success">
            {selectedDay.existing.length === 0
              ? `Open day — fits ${toClockRange(start, actualEnd, clock)} with room to spare.`
              : `Fits ${toClockRange(start, actualEnd, clock)}, alongside ${selectedDay.existing.length} other stop${selectedDay.existing.length === 1 ? "" : "s"} already on this day.`}
          </Banner>
        )
      ) : null}

      {/* SPEC §36.9: a three-way segmented Kind, then ONE second row for the
          kind that has a detail — why a pending stop is pending, or how a
          transit stop travels. Both rows are the same icon-radio shape
          (Mitchell, 2026-09-26: "I prefer the icon buttons so use that for
          both places it has a kind"). Without a picker every kind surface
          (the card badge, the Calendar's split and its `N to book`, the home
          hero's tile) would render on seeded trips only. */}
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2.5">
          <Text variant="muted">Kind</Text>
          <Text variant="muted">{KIND_HELP[kind]}</Text>
        </div>
        <SegmentedControl
          aria-label="Kind"
          fullWidth
          value={kind}
          onValueChange={setKind}
          options={KIND_OPTIONS.map((option) => ({ value: option, label: KIND_LABEL[option] }))}
        />
        {kind === "pending" && <PendingReasonPicker value={pendingReason} onChange={setPendingReason} />}
        {kind === "transit" && <TravelModePicker value={travelMode} onChange={setTravelMode} />}
      </div>

      {kind === "transit" && (
        // The place above is where the leg starts; this is where it ends.
        <LocationInput id="end-location-search" label="Going to" value={endLocation} onChange={setEndLocation} />
      )}

      <FormField
        id="activity-cost"
        label="Cost"
        description="Rough is fine. It counts against the trip budget as an estimate until you confirm."
      >
        <MoneyInput id="activity-cost" value={cost} currency={tripCurrency} onChange={setCost} placeholder="e.g. 120" />
      </FormField>

      {/* Four toggles, never the handoff's six (KI-52). The design pairs each
          chip with the "power" it grants — "Pins where you sleep that night",
          "the assistant keeps asking until there is a booking date". None of
          those powers exists yet (they are M18b and later), so the copy that
          promises them is left out rather than shipped ahead of the
          behaviour. */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-2.5">
          <Text variant="muted">Tags</Text>
          <Text variant="muted">Pick as many as fit</Text>
        </div>
        <div role="group" aria-label="Tags" className="flex flex-wrap gap-1.5">
          {TAG_ORDER.map((tag) => {
            const on = tags.includes(tag);
            return (
              <Button
                key={tag}
                variant={on ? "primary" : "secondary"}
                size="sm"
                aria-pressed={on}
                className="rounded-full px-3"
                onClick={() => setTags((current) => toggleTag(current, tag))}
              >
                {TAG_LABEL[tag]}
              </Button>
            );
          })}
        </div>
      </div>

      {/* M13 link 5. Two controls because they answer two questions — who
          BOOKED this stop, and who is GOING to it. A single "who" would read
          fine here and be wrong for every cost split later built on it
          (M19 link 3). */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-2.5">
          <Text variant="muted">Who is in</Text>
          {members.length > 0 && <Text variant="muted">Pick as many as are going</Text>}
        </div>
        {members.length === 0 ? (
          <Text variant="muted">Invite someone to the trip to say who a stop is for.</Text>
        ) : (
          <>
            <div role="group" aria-label="Who is going" className="flex flex-wrap gap-1.5">
              {members.map((member) => {
                const on = participants.includes(member.userId);
                return (
                  <Button
                    key={member.userId}
                    variant={on ? "primary" : "secondary"}
                    size="sm"
                    aria-pressed={on}
                    className="rounded-full px-3"
                    onClick={() =>
                      setParticipants((current) =>
                        current.includes(member.userId)
                          ? current.filter((id) => id !== member.userId)
                          : [...current, member.userId],
                      )
                    }
                  >
                    {member.userId}
                  </Button>
                );
              })}
            </div>
            <FormField
              id="activity-booked-by"
              label="Booked by"
              description="Who is handling this one. Not the same as who is going."
            >
              <NativeSelect
                id="activity-booked-by"
                value={bookedBy ?? ""}
                onChange={(e) => setBookedBy(e.target.value === "" ? null : e.target.value)}
              >
                <option value="">Nobody yet</option>
                {members.map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {member.userId}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
          </>
        )}
      </div>

      <FormField id="activity-notes" label="Notes" hint="Confirmation numbers, what to order, who to ask for.">
        <Textarea
          id="activity-notes"
          aria-label="Notes"
          rows={3}
          placeholder="Optional"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </FormField>

      {error !== null && (
        <Text as="p" role="alert" className="text-danger-ink">
          {error}
        </Text>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-hairline pt-4">
        <Text variant="muted">Have a confirmation? Attach it after saving.</Text>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            {mode === "edit" ? "Save" : "Add stop"}
          </Button>
        </div>
      </div>
    </form>
  );
}
