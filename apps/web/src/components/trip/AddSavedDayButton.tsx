"use client";

import { Button } from "@/components/ui/button";
import { Preview } from "@/components/ui/preview";

// Handoff §2 trip header action cluster: secondary "Add a saved day" is the
// trigger for InsertPlaybookDialog.tsx (choosing one of the user's kept
// Playbooks days and inserting it into this trip) — wiring that open/close
// state is M11's job, not this shell's. Self-wrapped in its own
// <Preview id="add-saved-day"> (Task 3's seam) so TripHeader doesn't have to
// repeat the wrap. Deliberately no onClick: it stays inert either way, since
// the Preview shield swallows the click regardless.
export function AddSavedDayButton() {
  return (
    <Preview id="add-saved-day">
      <Button type="button" variant="secondary">
        Add a saved day
      </Button>
    </Preview>
  );
}
