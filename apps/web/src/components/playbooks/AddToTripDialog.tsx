"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { TripSummary } from "@tc/contracts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { addDayToNewTrip, type NewTripLatch } from "@/lib/addDayToNewTrip";
import { fetchTripDetail, fetchTrips, insertSavedDay } from "@/lib/apiClient";
import { dayLabel } from "@/lib/dates";
import { AddToTripForm, NEW_TRIP } from "./AddToTripForm";

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
// leaderboard mean anything. The new-trip branch below ends in that same call
// for the same reason.
//
// **The day may stop being addable while this dialog is open.** Its author can
// unpublish between the page load and the button, and the insert then answers
// 404 "That saved day does not exist" — the same answer a private day has
// always had. That is the conflict state for this flow: it is reported here, in
// place, and the caller refreshes rather than a modal being thrown at anyone.
//
// **The second branch: start a new trip with this day as day 1.** The
// sequence is `addDayToNewTrip`'s, shared with the day page's return from
// signing up; this dialog only adds the optional start date.
//
// **Which day (M51 decision 8c).** On an existing trip the day can land on one
// of that trip's days rather than after the last: `startingAt`, the server's
// merge (ADR-050), which places its stops among that day's by time. The fields
// are `AddToTripForm`; this component reads the trips and days and does the add.
// A fixed sentence, not the server's text: what the reader needs is that the
// append still works.
const DAYS_UNREAD = "This trip's days could not be read; the day can still go after the last one.";

export function AddToTripDialog({
  open,
  onOpenChange,
  savedDayId,
  dayName,
  dayCount,
  onConflict,
  retrying = null,
  startOnNewTrip = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  savedDayId: string;
  dayName: string;
  /**
   * How many days this Playbook adds to the trip (M23 link 4).
   *
   * **The rule this exists for: a surface states the count it is acting on
   * BEFORE it acts.** This dialog is the surface that actually performs the
   * add, so it is the sharpest instance of it — "add to trip" quietly
   * adding three days when somebody expected one is the exact failure link 4
   * was written to prevent, and every word below was singular until a walk of
   * the preview caught it.
   */
  dayCount: number;
  /** Raised when the day itself has gone — the page above says so, not a modal. */
  onConflict: () => void;
  /**
   * The day page's return from signing up failed to make its trip: this
   * opening says why, and starts on the trip if it was made before the add
   * failed, so pressing Add fills it rather than leaving it empty beside a
   * second one.
   */
  retrying?: { tripId: string | null; error: string } | null;
  /** Opens on *Start a new trip*, not the first trip: what the press before signing up asked for. */
  startOnNewTrip?: boolean;
}) {
  const router = useRouter();
  const [trips, setTrips] = useState<TripSummary[] | null>(null);
  const [tripId, setTripId] = useState("");
  // Keyed by the trip it was picked on, like `days`: a pick made while the
  // trip list is still loading survives that list keeping the trip, and is
  // dropped if the list moves to another one.
  const [pick, setPick] = useState<{ tripId: string; dayId: string } | null>(null);
  const [startDate, setStartDate] = useState("");
  // The chosen trip's days, keyed by the trip they were read for so a slow
  // answer for the previous choice is never offered under the new one. A
  // failed read is kept the same way, so its sentence does not follow the
  // reader to a trip whose days did load.
  const [days, setDays] = useState<{
    tripId: string;
    days: { dayId: string; label: string }[];
    failed?: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // How far the new-trip branch got (`NewTripLatch`), so a retry resumes.
  const newTrip = useRef<NewTripLatch | null>(null);

  const creatingTrip = tripId === NEW_TRIP;
  const startingAt = pick?.tripId === tripId ? pick.dayId : "";
  const tripDays = days?.tripId === tripId ? days : null;
  const shownError = [error, tripDays?.failed ? DAYS_UNREAD : null].filter((s) => s !== null).join(" ") || null;

  const load = useCallback(async () => {
    const result = await fetchTrips();
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    // Cleared on success: a retry that worked must not leave the previous
    // failure sitting next to a fresh, correct list (the fix PeopleSection,
    // ShareButton and SavedDaysDialog all took).
    setError(retrying?.error ?? null);
    setTrips(result.value);
    // Kept only if the refreshed list still HAS it. This dialog stays mounted
    // between openings, so a trip deleted in another tab while it was closed
    // would otherwise leave `tripId` pointing at a row with no `<option>` — a
    // select rendering blank and an Add that posts a dead id, whose 404 this
    // component then reports as "the day was withdrawn" (CodeRabbit, PR 102).
    //
    // No trips at all now falls through to the new-trip branch. It used to be a
    // dead end — "start one from Your trips, then come back for this day" — which
    // sent the one reader most likely to want this day away from it.
    const kept = (id: string) => id === NEW_TRIP || result.value.some((trip) => trip.tripId === id);
    // A retry whose trip was never made offers a new one again, not the
    // reader's first trip, which one press of Add would put the day into.
    setTripId((current) =>
      retrying && kept(retrying.tripId ?? NEW_TRIP)
        ? (retrying.tripId ?? NEW_TRIP)
        : startOnNewTrip
          ? NEW_TRIP
          : kept(current)
            ? current
            : (result.value[0]?.tripId ?? NEW_TRIP),
    );
  }, [retrying, startOnNewTrip]);

  useEffect(() => {
    if (open) {
      // The latch is scoped to one opening: it must survive a retry, and must
      // NOT let the next opening add a second day to the trip minted for the
      // last one.
      newTrip.current = null;
      // Nor may it offer the last opening's days, or its pick: the trip may
      // have changed while this was closed, and a removed day's id would post.
      setDays(null);
      setPick(null);
      void load();
    }
  }, [open, load]);

  useEffect(() => {
    if (!open || tripId === "" || tripId === NEW_TRIP) return;
    let current = true;
    void fetchTripDetail(tripId).then((result) => {
      if (!current) return;
      if (!result.ok) {
        // The append needs no days, so it stays on offer; the reason is said.
        setDays({ tripId, days: [], failed: true });
        return;
      }
      const { startDate: start, days: tripDays } = result.value;
      setDays({ tripId, days: tripDays.map((d, i) => ({ dayId: d.dayId, label: dayLabel(start, i) })) });
    });
    return () => {
      current = false;
    };
  }, [open, tripId]);

  async function add() {
    setBusy(true);
    setError(null);

    const result = creatingTrip
      ? await addDayToNewTrip({ savedDayId, dayName, startDate }, newTrip)
      : await insertSavedDay(tripId, savedDayId, startingAt === "" ? {} : { startingAt }).then((inserted) =>
          inserted.ok ? { ok: true as const, value: { tripId } } : inserted,
        );
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
    router.push(`/trips/${result.value.tripId}`);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={
        dayCount === 1
          ? `Add “${dayName}” to a trip`
          : `Add “${dayName}” (${dayCount} days) to a trip`
      }
    >
      <AddToTripForm
        dayName={dayName}
        dayCount={dayCount}
        trips={trips}
        days={tripDays?.days ?? null}
        value={{ tripId, startingAt, startDate }}
        onChange={(next) => {
          setTripId(next.tripId);
          setPick({ tripId: next.tripId, dayId: next.startingAt });
          setStartDate(next.startDate);
        }}
        error={shownError}
      />

      <DialogFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={busy || tripId === ""}
          onClick={() => void add()}
        >
          {busy ? "Adding…" : "Add to trip"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
