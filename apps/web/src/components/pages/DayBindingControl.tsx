"use client";
import type { DayRef, TripDetail } from "@tc/contracts";
import { NativeSelect } from "@/components/ui/native-select";
import { Label } from "@/components/ui/label";

const UNBOUND = "";

// The DOM id `PageScreen` focuses when `MacroView`'s "select a day" chip
// fires `onBindDay` (the unbound-chip's action, design spec's "point at a
// day" gesture) — a plain lookup rather than a forwarded ref, since
// `NativeSelect` (ADR-010: a real <select>, not Radix) doesn't forward one.
export const DAY_BINDING_SELECT_ID = "day-binding-select";

export function DayBindingControl({ trip, dayRef, onChange }: {
  trip: TripDetail;
  dayRef: DayRef | undefined;
  onChange: (dayRef: DayRef | undefined) => void;
}) {
  const value = dayRef?.kind === "index" ? String(dayRef.index) : UNBOUND;

  return (
    <div className="flex items-center gap-2">
      <Label htmlFor={DAY_BINDING_SELECT_ID}>Bind to day</Label>
      <NativeSelect
        id={DAY_BINDING_SELECT_ID}
        value={value}
        onChange={(e) => {
          const raw = e.target.value;
          onChange(raw === UNBOUND ? undefined : { kind: "index", index: Number(raw) });
        }}
      >
        <option value={UNBOUND}>Trip-wide (no day)</option>
        {trip.days.map((day, i) => (
          <option key={day.dayId} value={i}>
            Day {i + 1}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}
