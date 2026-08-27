"use client";

import { useEffect, useId, useState } from "react";
import type { SavedStop } from "@tc/contracts";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { createSavedDay } from "@/lib/apiClient";
import { toClockRange } from "@/lib/time";

// Handoff README §"Keep this day": the pennant flag opens this dialog. Real as
// of M11 link 6 — it was `<Preview id="keep-day-dialog">`, three inert fields
// and a Confirm with no onClick.
//
// Two deliberate departures from the shell, both because the shell described a
// feature this milestone does not have:
//
// 1. "What's included" was a text INPUT with the placeholder "Stops, order,
//    gaps and notes — no dates". It is a statement about what gets saved, not
//    a question — so it is a read-only summary of the actual day now. A field
//    that looked editable but changed nothing would be the same species of
//    dishonesty the Preview seam exists to avoid.
// 2. "Visibility" (Only me / Trip collaborators / Anyone with the link) is
//    gone, replaced by one line saying saved days are private. Two of those
//    three options are surfaces this milestone does not build — a link-shared
//    fragment is a second public-read path, and M12 Community, which owns
//    discovery and everything that quarantines, is explicitly out of scope
//    (ADR-029). A select with one real option is worse than a sentence.
//
// The prototype's celebrate() choreography — spring, ring burst, sparks, the
// "Kept" pill — is not built. The save is real; the confetti is not.

function includedSummary(stops: SavedStop[]): string {
  if (stops.length === 0) return "Nothing yet — this day has no stops.";
  const count = `${stops.length} stop${stops.length === 1 ? "" : "s"}`;
  const windows = stops.map((s) => s.timeWindow).filter((w) => w !== null);
  const first = windows[0];
  const last = windows[windows.length - 1];
  if (first === undefined || last === undefined) return `${count}, in order. No dates.`;
  return `${count}, ${toClockRange(first.start, last.end)}. Order and gaps kept, no dates.`;
}

export function KeepDayDialog({
  open,
  onOpenChange,
  tripId,
  dayId,
  dayIndex,
  tripName,
  stops,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tripId: string;
  dayId: string;
  dayIndex: number;
  tripName: string;
  stops: SavedStop[];
  onSaved?: (name: string) => void;
}) {
  const nameId = useId();
  const includedId = useId();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A default worth keeping is one you can accept without thinking: the day
  // and the trip it came from. Reset on every open so a dialog reopened for a
  // different day does not offer the previous day's name.
  useEffect(() => {
    if (open) {
      setName(`Day ${dayIndex + 1} of ${tripName}`);
      setError(null);
    }
  }, [open, dayIndex, tripName]);

  async function save() {
    const trimmed = name.trim();
    if (trimmed === "") {
      setError("Give it a name you'll recognise later.");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await createSavedDay({ name: trimmed, tripId, dayId });
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    onOpenChange(false);
    onSaved?.(result.value.name);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Keep this day">
      <div className="flex flex-col gap-3">
        <FormField id={nameId} label="Name">
          <Input
            id={nameId}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. A day in Nakameguro"
          />
        </FormField>
        <FormField id={includedId} label="What's included">
          <Text as="span" id={includedId} className="text-sm text-ink">
            {includedSummary(stops)}
          </Text>
        </FormField>
        <Text as="span" className="text-xs text-slate">
          Saved days are private to you. Add one to any trip you can edit.
        </Text>
        {error !== null && (
          <Text as="span" className="text-xs text-danger-ink">
            {error}
          </Text>
        )}
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="primary"
          disabled={busy || stops.length === 0}
          onClick={() => void save()}
        >
          Save
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
