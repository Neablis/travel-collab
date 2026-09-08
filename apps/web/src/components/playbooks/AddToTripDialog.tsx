"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { TripSummary } from "@tc/contracts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Text } from "@/components/ui/text";
import { createTrip, fetchTrips, insertSavedDay, sendTripCommandBatch } from "@/lib/apiClient";

// The select's second branch. A trip id is always a uuid, so this cannot
// collide with one.
const NEW_TRIP = "new";

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
// **The second branch: start a new trip with this day as day 1** (Mitchell,
// 2026-09-08 — "do smallest possible... For name same thing, just use name of
// the day for trip."). Three facts make the two- or three-call sequence below
// correct, and each cost a read to establish:
//
//   1. A freshly created trip has `days: []` and `startDate: null`
//      (`packages/domain/src/trip/evolve.ts`), so the insert's `AddDay` lands
//      the playbook day as day 1. Nothing extra makes it "first".
//   2. The date goes on with `SetTripStartDate`, never `SetTripDates`. The
//      latter reconciles day COUNT (`decide.ts`) and would mint an empty day 1,
//      pushing the playbook day to day 2.
//   3. **The start date is OPTIONAL** (Mitchell, 2026-09-08 — "no make that
//      field optional now"). It was required, and it was a correctness
//      requirement rather than a preference: `addCounts()` refused a
//      leaderboard add against an undated trip, so an insert that overtook the
//      date under-credited the author silently and forever. That clause was
//      dropped the same day and the add now counts either way, which leaves the
//      field nothing to guarantee. Blank means **no `SetTripStartDate` is sent
//      at all** — the trip is simply created undated, which is a supported
//      state everywhere (`evolve.ts` genesis is `startDate: null`, and
//      `deriveDayDates` renders an undated trip as ordinals). Blank is NOT
//      `SetTripStartDate` with an empty date.
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
  const startDateFieldId = useId();
  const [trips, setTrips] = useState<TripSummary[] | null>(null);
  const [tripId, setTripId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // How far the new-trip branch got, so a retry resumes rather than restarts —
  // `NewTripWizard`'s latch (CodeRabbit, PR #32), which exists because a failure
  // at a later step used to mint a second trip on every attempt.
  //
  // `datedAs` is the half that latch does not have: re-sending the same
  // `SetTripStartDate` is rejected as a no-op (`okUnlessNoOp`, `decide.ts`), so
  // a retry after a failed insert must SKIP step 2 rather than repeat it, or the
  // user is stuck behind "This change would have no effect." Storing the date
  // rather than a boolean means changing it before retrying still re-sends.
  const newTrip = useRef<{ tripId: string; datedAs: string | null } | null>(null);

  const creatingTrip = tripId === NEW_TRIP;

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
    //
    // No trips at all now falls through to the new-trip branch. It used to be a
    // dead end — "start one from Your trips, then come back for this day" — which
    // sent the one reader most likely to want this day away from it.
    setTripId((current) =>
      current === NEW_TRIP || result.value.some((trip) => trip.tripId === current)
        ? current
        : (result.value[0]?.tripId ?? NEW_TRIP),
    );
  }, []);

  useEffect(() => {
    if (open) {
      // The latch is scoped to one opening: it must survive a retry, and must
      // NOT let the next opening add a second day to the trip minted for the
      // last one.
      newTrip.current = null;
      void load();
    }
  }, [open, load]);

  async function add() {
    setBusy(true);
    setError(null);

    let target = tripId;
    if (creatingTrip) {
      let latched = newTrip.current;
      if (latched === null) {
        // The day's own name, verbatim: both `SavedDay.name` and `CreateTrip.name`
        // are min 1 / max 200, so it always fits and nothing is truncated.
        const created = await createTrip({ name: dayName });
        if (!created.ok) {
          setBusy(false);
          setError(created.error.message);
          return;
        }
        latched = { tripId: created.value.tripId, datedAs: null };
        newTrip.current = latched;
      }
      // Blank skips step 2 outright rather than sending an empty date. The
      // latch keeps `datedAs: null` for that case, which is what makes the
      // retry path work: submit blank, fail at the insert, type a date, retry —
      // `null !== "2027-04-01"` so the command goes out on the second attempt,
      // where a boolean latch would have swallowed it. Going the other way
      // (dated, then cleared, then retried) deliberately leaves the date on:
      // this dialog has no business un-dating a trip the user already dated.
      if (startDate !== "" && latched.datedAs !== startDate) {
        const dated = await sendTripCommandBatch(latched.tripId, [
          { type: "SetTripStartDate", tripId: latched.tripId, startDate },
        ]);
        if (!dated.ok) {
          setBusy(false);
          setError(dated.error.message);
          return;
        }
        newTrip.current = { ...latched, datedAs: startDate };
      }
      target = latched.tripId;
    }

    const result = await insertSavedDay(target, savedDayId);
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
    router.push(`/trips/${target}`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={`Add “${dayName}” to a trip`}>
      <div className="flex flex-col gap-3.5">
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
            <option value={NEW_TRIP}>Start a new trip</option>
          </NativeSelect>
        </FormField>

        {creatingTrip && (
          <FormField
            id={startDateFieldId}
            label="Start date"
            hint={`Optional. The trip is named “${dayName}”, and this day is day 1.`}
          >
            <Input
              id={startDateFieldId}
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
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
