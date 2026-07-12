"use client";

import type { Money, TripCommand } from "@tc/contracts";
import { Sheet } from "@/components/ui/sheet";
import { TripDateControl } from "@/components/lenses/TripDateControl";
import { TripMoneySettings } from "@/components/board/TripMoneySettings";

// Trip-global edits, re-homed out of the always-visible header (Pattern 4,
// comment 12b): budget/currency and the start date are set-once/rare operations, so
// they belong in a raised Sheet, not permanent chrome. TripDateControl and
// TripMoneySettings keep their existing handlers/aria-labels and dispatch
// logic byte-identical — this is just a new host surface for them.
export function SettingsSheet({
  tripId,
  open,
  onOpenChange,
  startDate,
  currency,
  budget,
  onCommand,
}: {
  tripId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  startDate: string | null;
  currency: string;
  budget: Money | null;
  onCommand: (command: TripCommand) => void;
}) {
  return (
    <Sheet title="Trip settings" open={open} onOpenChange={onOpenChange}>
      <div className="flex flex-col gap-5">
        <TripDateControl tripId={tripId} startDate={startDate} onCommand={onCommand} />
        <TripMoneySettings tripId={tripId} currency={currency} budget={budget} onCommand={onCommand} />
      </div>
    </Sheet>
  );
}
