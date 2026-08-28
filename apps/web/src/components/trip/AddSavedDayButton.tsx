"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { SavedDaysDialog } from "@/components/trip/SavedDaysDialog";
import { useTrip } from "@/components/trip/context/TripProvider";

// Handoff §2's "Add a saved day", real as of M11 link 6. It was
// <Preview id="add-saved-day"> — an inert button in a file the app did not
// even render, parked in `preview-registry.test.ts`'s PARKED escape hatch
// since M10 Wave 2 moved the action out of the trip header (KI-31).
//
// It comes back where the design put it: in the plan flow, at the end of the
// trip — NOT in the header. EndOfTrip mounts it beside its own "Add a day",
// outside the still-shelled <Preview id="insert-playbook"> that carries the
// Playbook shortcuts (those are M11 Playbooks, a separate scope, still unbuilt).
//
// Reads `applyOutcome` from TripProvider rather than taking a callback prop:
// the insert is a real command batch and returns the authoritative detail and
// history, so the board reconciles from the response with no refetch — the
// same path the AI planning batch and undo/redo already take.
export function AddSavedDayButton() {
  const { tripId, applyOutcome, readOnly } = useTrip();
  const [open, setOpen] = useState(false);

  // A viewer cannot add a day to someone else's trip, and the server refuses
  // it (`editor` on the insert route). Not rendering the button at all is
  // better than one that always fails.
  if (readOnly) return null;

  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        Add a saved day
      </Button>
      <SavedDaysDialog
        open={open}
        onOpenChange={setOpen}
        tripId={tripId}
        onInserted={applyOutcome}
      />
    </>
  );
}
