"use client";

import { useState } from "react";
import Link from "next/link";
import { Clock, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataText } from "@/components/ui/data-text";
import { Heading } from "@/components/ui/heading";
import { Popover } from "@/components/ui/popover";
import { BudgetMeter } from "@/components/ui/budget-meter";
import { useTrip } from "@/components/trip/context/TripProvider";
import { formatTripDate } from "@/lib/formatDate";
import { HistoryPanel } from "@/components/board/HistoryPanel";
import { UndoRedoControls } from "@/components/board/UndoRedoControls";
import { SettingsSheet } from "./SettingsSheet";

// The bounded chrome surface (design-system.md surface vocabulary, Pattern 4):
// read-only trip identity + a budget-vs-total glance, plus the action
// affordances (undo/redo, History popover, Settings sheet gear). A visual
// boundary (bg-surface + border-hairline) separates this chrome from lens
// content below (#14). No editable date/budget inputs live here — those moved
// to SettingsSheet (comments 15, 12b); this header is genuinely read-only for identity.
export function TripHeader({ tripId }: { tripId: string }) {
  const { trip, history, status, pending, dispatch, preview } = useTrip();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  if (trip === null || status !== "ready") return null;

  return (
    <header className="border-b border-hairline bg-surface px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <nav>
            <Link href="/" className="text-sm text-slate hover:text-ink">
              ← Your trips
            </Link>
          </nav>
          <Heading level={2}>{trip.name}</Heading>
          <div className="flex flex-wrap items-center gap-3">
            {trip.startDate !== null && (
              <DataText size="sm">{formatTripDate(trip.startDate)}</DataText>
            )}
            {trip.budget !== null && (
              <BudgetMeter cost={trip.tripCostTotal} budget={trip.budget.amountMinor} currency={trip.currency} />
            )}
          </div>
        </div>

        <div className="flex items-center gap-0.5">
          {preview.seq === null && (
            <UndoRedoControls
              canUndo={history?.canUndo ?? false}
              canRedo={history?.canRedo ?? false}
              onUndo={() => void dispatch({ type: "UndoLastChange", tripId })}
              onRedo={() => void dispatch({ type: "RedoChange", tripId })}
              isBusy={pending}
            />
          )}
          {/* The Popover stays mounted during preview (not gated on
              preview.seq === null like undo/redo/settings) — HistoryPanel's
              "Viewing version N (read-only)" banner and its Revert/Back-to-now
              controls must remain reachable while previewing a past state. */}
          <Popover
            open={historyOpen || preview.seq !== null}
            // #18: dismissing the popover (outside-click or Escape) while
            // previewing a past state also exits the preview ("back to now"),
            // so you never end up with a closed popover still pinned to an old
            // version. The wider content gives the entries + preview controls
            // room (#16/#17).
            onOpenChange={(open) => {
              setHistoryOpen(open);
              if (!open && preview.seq !== null) preview.exit();
            }}
            align="end"
            contentClassName="w-96"
            trigger={
              <Button variant="ghost" aria-label="History">
                <Clock className="size-3.5" aria-hidden />
                History
              </Button>
            }
          >
            <HistoryPanel
              history={history}
              previewSeq={preview.seq}
              onPreview={(seq) => void preview.enter(seq)}
              onExitPreview={preview.exit}
              onRevert={(toSeq) => void dispatch({ type: "RevertToState", tripId, toSeq })}
            />
          </Popover>
          {preview.seq === null && (
            <Button variant="ghost" size="icon" aria-label="Trip settings" onClick={() => setSettingsOpen(true)}>
              <Settings className="size-3.5" aria-hidden />
            </Button>
          )}
        </div>
      </div>

      <SettingsSheet
        tripId={tripId}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        startDate={trip.startDate}
        currency={trip.currency}
        budget={trip.budget}
        onCommand={(command) => {
          if (command.type !== "CreateTrip") void dispatch(command);
        }}
      />
    </header>
  );
}
