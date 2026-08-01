"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Money, TripCommand } from "@tc/contracts";
import { Sheet } from "@/components/ui/sheet";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { TripDateControl } from "@/components/lenses/TripDateControl";
import { TripMoneySettings } from "@/components/board/TripMoneySettings";
import { duplicateTrip, sendTripCommand } from "@/lib/apiClient";

// Trip-global edits, re-homed out of the always-visible header (Pattern 4,
// comment 12b): budget/currency and the start date are set-once/rare operations, so
// they belong in a raised Sheet, not permanent chrome. TripDateControl and
// TripMoneySettings keep their existing handlers/aria-labels and dispatch
// logic byte-identical — this is just a new host surface for them.
//
// A15: Delete/Duplicate mirror the trip-list row menu (page.tsx), but dispatch
// via `sendTripCommand`/`duplicateTrip` directly rather than through
// `onCommand` — `onCommand` runs through TripProvider's optimistic queue,
// which is the wrong shape for a command that's immediately followed by
// leaving the page (queued-but-unsent risk if the tree unmounts before the
// queue's effect fires). Delete also can't raise its own toast: this sheet's
// subtree is what closes/unmounts on success, so it reports success via
// `onDeleted` and leaves the toast to the caller (TripHeader), same as the
// list's local Toast in page.tsx but one level up.
export function SettingsSheet({
  tripId,
  tripName,
  open,
  onOpenChange,
  startDate,
  endDate,
  dayCount,
  currency,
  budget,
  onCommand,
  onDeleted,
}: {
  tripId: string;
  tripName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  startDate: string | null;
  endDate: string | null;
  dayCount: number;
  currency: string;
  budget: Money | null;
  onCommand: (command: TripCommand) => void;
  onDeleted: (trip: { tripId: string; name: string }) => void;
}) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleDelete() {
    setBusy(true);
    const result = await sendTripCommand({ type: "DeleteTrip", tripId });
    setBusy(false);
    setConfirmOpen(false);
    if (result.ok) {
      onOpenChange(false);
      onDeleted({ tripId, name: tripName });
    }
  }

  async function handleDuplicate() {
    setBusy(true);
    const result = await duplicateTrip(tripId);
    setBusy(false);
    if (result.ok) {
      router.push(`/trips/${result.value.tripId}`);
    }
  }

  return (
    <Sheet title="Trip settings" open={open} onOpenChange={onOpenChange}>
      <div className="flex flex-col gap-5">
        <TripDateControl
          tripId={tripId}
          startDate={startDate}
          endDate={endDate}
          dayCount={dayCount}
          onCommand={onCommand}
        />
        <TripMoneySettings tripId={tripId} currency={currency} budget={budget} onCommand={onCommand} />
        <div className="flex flex-col gap-2 border-t border-hairline pt-4">
          <Button variant="secondary" disabled={busy} onClick={() => void handleDuplicate()}>
            Duplicate trip
          </Button>
          <Button variant="destructive" disabled={busy} onClick={() => setConfirmOpen(true)}>
            Delete trip
          </Button>
        </div>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen} title="Delete trip">
        <Text variant="secondary">
          Delete &quot;{tripName}&quot;? You can undo this from the toast that follows.
        </Text>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={busy} onClick={() => void handleDelete()}>
            Delete
          </Button>
        </DialogFooter>
      </Dialog>
    </Sheet>
  );
}
