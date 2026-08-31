"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import type { TripSummary } from "@tc/contracts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { NativeSelect } from "@/components/ui/native-select";
import { Text } from "@/components/ui/text";
import { fetchTrips, insertSavedDay } from "@/lib/apiClient";

// "Add to a trip", from a day you are looking at (M11b link 6).
//
// **The shape mismatch this bridges.** `SavedDaysDialog` is *fixed trip, choose
// a day*: it lives inside a trip, reads your own library, and hands the outcome
// back to `TripProvider`. Link 6 is the inverse — *fixed day, choose a trip* —
// and the day is usually somebody else's. The picker shape came from
// `InsertPlaybookDialog`, which carried exactly this control and was dead code
// (nothing rendered imported it); it is harvested here and deleted there.
//
// What is NOT rebuilt is the insert itself: `POST /api/trips/:id/saved-days/:id`
// is the same real path `SavedDaysDialog` uses — one batch, one history entry,
// one undo, and the adds ledger written in the same transaction. Two insert
// paths would be two chances to disagree about the rule that makes the
// leaderboard mean anything.
//
// **The day may stop being addable while this dialog is open.** Its author can
// unpublish between the page load and the button, and the insert then answers
// 404 "That saved day does not exist" — the same answer a private day has
// always had. That is the conflict state for this flow: it is reported here, in
// place, and the caller refreshes rather than a modal being thrown at anyone.
export function AddToTripDialog({
  open,
  onOpenChange,
  savedDayId,
  dayName,
  onConflict,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  savedDayId: string;
  dayName: string;
  /** Raised when the day itself has gone — the page above says so, not a modal. */
  onConflict: () => void;
}) {
  const router = useRouter();
  const tripFieldId = useId();
  const [trips, setTrips] = useState<TripSummary[] | null>(null);
  const [tripId, setTripId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await fetchTrips();
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    // Cleared on success: a retry that worked must not leave the previous
    // failure sitting next to a fresh, correct list (the fix TravelersPanel,
    // ShareButton and SavedDaysDialog all took).
    setError(null);
    setTrips(result.value);
    // Kept only if the refreshed list still HAS it. This dialog stays mounted
    // between openings, so a trip deleted in another tab while it was closed
    // would otherwise leave `tripId` pointing at a row with no `<option>` — a
    // select rendering blank and an Add that posts a dead id, whose 404 this
    // component then reports as "the day was withdrawn" (CodeRabbit, PR 102).
    setTripId((current) =>
      result.value.some((trip) => trip.tripId === current)
        ? current
        : (result.value[0]?.tripId ?? ""),
    );
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  async function add() {
    setBusy(true);
    setError(null);
    const result = await insertSavedDay(tripId, savedDayId);
    setBusy(false);
    if (!result.ok) {
      // 404 means the day is gone or was withdrawn while this was open — a
      // different situation from "the request failed", and the only one the
      // page above has to redraw for.
      if (result.error.status === 404) {
        onOpenChange(false);
        onConflict();
        return;
      }
      setError(result.error.message);
      return;
    }
    onOpenChange(false);
    // Straight to the trip it landed in. The insert already returned the
    // authoritative detail and history, but this page has no TripProvider to
    // feed them to — the trip's own load is the next thing that happens either
    // way, so navigating is the honest move rather than holding an outcome
    // nothing will apply.
    router.push(`/trips/${tripId}`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={`Add “${dayName}” to a trip`}>
      <div className="flex flex-col gap-3.5">
        {trips !== null && trips.length === 0 ? (
          <Text variant="secondary">
            You have no trips yet. Start one from Your trips, then come back for this day.
          </Text>
        ) : (
          <FormField id={tripFieldId} label="Which trip">
            <NativeSelect
              id={tripFieldId}
              value={tripId}
              disabled={trips === null}
              onChange={(e) => setTripId(e.target.value)}
            >
              {(trips ?? []).map((trip) => (
                <option key={trip.tripId} value={trip.tripId}>
                  {trip.name}
                </option>
              ))}
            </NativeSelect>
          </FormField>
        )}

        <Text variant="secondary">
          The day is appended at the end, keeping its order and gaps. It is one history entry, so
          one undo takes the whole thing back out.
        </Text>

        {error !== null && (
          <Text as="span" className="text-xs text-danger-ink">
            {error}
          </Text>
        )}
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button variant="primary" disabled={busy || tripId === ""} onClick={() => void add()}>
          {busy ? "Adding…" : "Add to trip"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
