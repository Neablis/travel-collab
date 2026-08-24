"use client";

import { useEffect, useState } from "react";
import type { ActivityView, Anchor, Location, Money, TimeWindow } from "@tc/contracts";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Banner } from "@/components/ui/banner";
import { Preview } from "@/components/ui/preview";
import { Text } from "@/components/ui/text";
import { Textarea } from "@/components/ui/textarea";
import { toClockLabel, toMinutes, toTimeString } from "@/lib/time";
import type { Slot } from "@/components/trip/unscheduledRack";
import {
  closestDurationLabel,
  DEFAULT_DURATION_LABEL,
  DURATION_OPTIONS,
  durationMinutes,
  type DurationLabel,
} from "./activityDuration";
import { LocationInput } from "./LocationInput";
import { MoneyInput } from "./MoneyInput";

export type ActivityFormValue = {
  title: string;
  dayId: string | null;
  timeWindow: TimeWindow | null;
  location: Location | null;
  notes: string | null;
  anchors: Anchor[];
  cost: Money | null;
};

// One option per trip day for the "Day" NativeSelect, plus that day's
// already-scheduled windows (excluding whatever activity is being edited) —
// the availability Banner below feeds these straight into fitIntoDay.
export type ActivityDayOption = { dayId: string; label: string; existing: Slot[] };

// Illustrative only (Preview id="add-stop-suggestions", M9 — grounded place
// search doesn't exist yet, so nothing generates real matches from what the
// user types into "What or where"). Static shape for the design's
// list-of-buttons layout, not real data — same illustrative-constant pattern
// as SettingsSheet's BREAKDOWN_CATEGORIES.
const SUGGESTED_MATCH_SHAPE = [
  { kind: "Place", name: "Example match", detail: "Appears once M9 grounding is wired up" },
] as const;

// Illustrative only (Preview id="add-stop-who", M13 — no field records who a
// stop is for yet, so there is nothing real to list per-stop).
const CREW_CHIP_SHAPE = [{ name: "Everyone" }] as const;

export function ActivityEditor({
  initial,
  mode,
  days,
  defaultDayId,
  tripCurrency = "USD",
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
  onSave: (value: ActivityFormValue) => void;
  onCancel: () => void;
}) {
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
  const [cost, setCost] = useState<Money | null>(initial?.cost ?? null);
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
      cost,
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-3">
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
              ? `Open day — fits ${toClockLabel(start)}–${toClockLabel(actualEnd)} with room to spare.`
              : `Fits ${toClockLabel(start)}–${toClockLabel(actualEnd)}, alongside ${selectedDay.existing.length} other stop${selectedDay.existing.length === 1 ? "" : "s"} already on this day.`}
          </Banner>
        )
      ) : null}

      <FormField
        id="activity-cost"
        label="Cost"
        description="Rough is fine. It counts against the trip budget as an estimate until you confirm."
      >
        <MoneyInput id="activity-cost" value={cost} currency={tripCurrency} onChange={setCost} placeholder="e.g. 120" />
      </FormField>

      <div className="flex flex-col gap-1.5">
        <Text variant="muted">Who is in</Text>
        <Preview id="add-stop-who" size="container" className="flex flex-wrap gap-1.5 p-1.5">
          {CREW_CHIP_SHAPE.map((crew) => (
            <span
              key={crew.name}
              className="flex items-center gap-1.5 rounded-full border border-hairline py-0.5 pl-0.5 pr-2.5"
            >
              <span className="size-6 shrink-0 rounded-full bg-moss" aria-hidden />
              <Text as="span" className="text-sm text-ink">
                {crew.name}
              </Text>
            </span>
          ))}
        </Preview>
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
        <Text variant="muted">Booked? Attach a confirmation after saving.</Text>
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
