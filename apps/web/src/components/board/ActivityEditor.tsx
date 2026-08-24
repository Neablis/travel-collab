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
import { fitIntoDay, type Slot } from "@/components/trip/unscheduledRack";
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
  // selection is applied once real days show up, not just at mount. Guarded
  // on `selectedDayId === ""` so it never overwrites a user's own choice.
  // Create mode falls back to the first day when there is no prefill; edit
  // mode does not — an activity with no day (the backlog) should stay
  // unselected rather than being pinned to Day 1 by this effect.
  useEffect(() => {
    if (selectedDayId !== "") return;
    if (defaultDayId !== undefined) {
      setSelectedDayId(defaultDayId);
    } else if (mode === "create" && days[0] !== undefined) {
      setSelectedDayId(days[0].dayId);
    }
  }, [days, defaultDayId, mode, selectedDayId]);

  const selectedDay = days.find((d) => d.dayId === selectedDayId);

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

      {selectedDay && start !== "" ? (
        <Banner variant="success">
          {(() => {
            const fitted = fitIntoDay(selectedDay.existing, start);
            const slot = `${toClockLabel(fitted.start)}–${toClockLabel(fitted.end)}`;
            const otherCount = selectedDay.existing.length;
            return otherCount === 0
              ? `Open day — fits ${slot} with room to spare.`
              : `Fits ${slot}, alongside ${otherCount} other stop${otherCount === 1 ? "" : "s"} already on this day.`;
          })()}
        </Banner>
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
