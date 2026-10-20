"use client";

import { useId } from "react";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Text } from "@/components/ui/text";

// The trip select's second branch. A trip id is always a uuid, so this cannot
// collide with one.
export const NEW_TRIP = "new";

/** What the form has chosen. `startingAt` is a day id, or "" for after the last day. */
export interface AddToTripChoice {
  tripId: string;
  startingAt: string;
  startDate: string;
}

// The fields of "Add to a trip", and nothing that fetches or navigates: the
// dialog owns the reads and the insert, and the landing (M51 part 6) draws the
// same fields over canned trips with its own button. Actions are the caller's.
/** The fields of "Add to a trip", controlled through `value`/`onChange`; renders no buttons and fetches nothing. */
export function AddToTripForm({
  dayName,
  dayCount,
  trips,
  days,
  value,
  onChange,
  error = null,
}: {
  dayName: string;
  /** How many days this Playbook moves; every sentence below states it (M23 link 4). */
  dayCount: number;
  /** null while they load. */
  trips: readonly { tripId: string; name: string }[] | null;
  /** The chosen trip's days, in order; null while they load. */
  days: readonly { dayId: string; label: string }[] | null;
  value: AddToTripChoice;
  onChange: (next: AddToTripChoice) => void;
  error?: string | null;
}) {
  const tripFieldId = useId();
  const dayFieldId = useId();
  const startDateFieldId = useId();
  const creatingTrip = value.tripId === NEW_TRIP;
  // "Day N" by position, not the option's label: a dated trip's label carries
  // its date, which the sentence below does not need twice.
  const onto = value.startingAt === "" ? -1 : (days ?? []).findIndex((d) => d.dayId === value.startingAt);

  return (
    <div className="flex flex-col gap-3.5">
      <FormField id={tripFieldId} label="Which trip">
        <NativeSelect
          id={tripFieldId}
          value={value.tripId}
          disabled={trips === null}
          // A different trip has different days, so the day goes back to the append.
          onChange={(e) => onChange({ ...value, tripId: e.target.value, startingAt: "" })}
        >
          {(trips ?? []).map((trip) => (
            <option key={trip.tripId} value={trip.tripId}>
              {trip.name}
            </option>
          ))}
          <option value={NEW_TRIP}>Start a new trip</option>
        </NativeSelect>
      </FormField>

      {creatingTrip ? (
        <FormField
          id={startDateFieldId}
          label="Start date"
          hint={
            dayCount === 1
              ? `Optional. The trip is named “${dayName}”, and this day is day 1.`
              : `Optional. The trip is named “${dayName}”, and its ${dayCount} days become days 1–${dayCount}.`
          }
        >
          <Input
            id={startDateFieldId}
            type="date"
            value={value.startDate}
            onChange={(e) => onChange({ ...value, startDate: e.target.value })}
          />
        </FormField>
      ) : (
        value.tripId !== "" && (
          <FormField id={dayFieldId} label="Which day">
            <NativeSelect
              id={dayFieldId}
              value={value.startingAt}
              disabled={days === null}
              onChange={(e) => onChange({ ...value, startingAt: e.target.value })}
            >
              {(days ?? []).map((day) => (
                <option key={day.dayId} value={day.dayId}>
                  {day.label}
                </option>
              ))}
              <option value="">After the last day</option>
            </NativeSelect>
          </FormField>
        )
      )}

      <Text variant="secondary">
        {onto === -1
          ? dayCount === 1
            ? "The day is appended at the end, keeping its order and gaps."
            : `All ${dayCount} days are appended at the end, in order, keeping each day's own order and gaps.`
          : dayCount === 1
            ? `The day lands on Day ${onto + 1}, its stops placed among that day's by time.`
            : `Its first day lands on Day ${onto + 1} and the rest on the days after, each day's stops placed by time; any past the trip's last day are appended.`}{" "}
        It is one history entry, so one undo takes the whole thing back out.
      </Text>

      {error !== null && (
        <Text as="span" className="text-xs text-danger-ink">
          {error}
        </Text>
      )}
    </div>
  );
}
