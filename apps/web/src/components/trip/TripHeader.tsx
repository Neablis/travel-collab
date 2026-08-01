"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Clock, Pencil, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataText } from "@/components/ui/data-text";
import { Heading } from "@/components/ui/heading";
import { Input } from "@/components/ui/input";
import { Popover } from "@/components/ui/popover";
import { BudgetMeter } from "@/components/ui/budget-meter";
import { Toast } from "@/components/ui/toast";
import { useTrip } from "@/components/trip/context/TripProvider";
import { formatTripDate } from "@/lib/formatDate";
import { sendTripCommand } from "@/lib/apiClient";
import { HistoryPanel } from "@/components/board/HistoryPanel";
import { UndoRedoControls } from "@/components/board/UndoRedoControls";
import { SettingsSheet } from "./SettingsSheet";

// The bounded chrome surface (design-system.md surface vocabulary, Pattern 4):
// trip identity (name, now renameable inline — task A13) + a budget-vs-total
// glance, plus the action affordances (undo/redo, History popover, Settings
// sheet gear). A visual boundary (bg-surface + border-hairline) separates this
// chrome from lens content below (#14). No editable date/budget inputs live
// here — those moved to SettingsSheet (comments 15, 12b); the name is the one
// piece of identity that's directly editable in the chrome itself.
export function TripHeader({ tripId }: { tripId: string }) {
  const { trip, history, status, pending, dispatch, applyOutcome, preview } = useTrip();
  const router = useRouter();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  // A15: the settings sheet's own subtree closes/unmounts on a successful
  // delete, so it can't host its own toast — it reports success here via
  // `onDeleted` and this level raises it. Undo reconciles in place
  // (applyOutcome, same as the undo/redo/revert commands above); dismissing
  // without undo is the "routes back to the trip list" half of the brief —
  // deferred until the toast closes so Undo still has a page to act on.
  //
  // A15-fix: `onDeleted` also applies the delete's own CommandOutcome via
  // `applyOutcome` immediately (same call as the undo path below), so
  // trip.status flips to "deleted" in TripProvider right away instead of
  // staying "active" (and the whole board fully interactive against
  // already-deleted server state) for the entire toast window.
  const [deleteToast, setDeleteToast] = useState<{ tripId: string; name: string } | null>(null);

  if (trip === null || status !== "ready") return null;

  async function undoDelete() {
    if (!deleteToast) return;
    const { tripId: restoreId } = deleteToast;
    setDeleteToast(null);
    const result = await sendTripCommand({ type: "RestoreTrip", tripId: restoreId });
    if (result.ok) applyOutcome(result.value);
  }

  const commitRename = (value: string) => {
    const name = value.trim();
    // Skip the dispatch entirely for a no-op (unchanged or empty) rename —
    // the domain would reject an empty/unchanged name anyway, and a rejected
    // round-trip is worse UX than just not sending it (mirrors the #7HuQy
    // no-op handling in TripProvider).
    if (name !== "" && name !== trip.name) {
      void dispatch({ type: "SetTripName", tripId, name });
    }
    setRenaming(false);
  };

  return (
    <header className="border-b border-hairline bg-surface px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <nav className="flex items-center gap-3">
            <Link href="/" className="text-sm text-slate hover:text-ink">
              ← Your trips
            </Link>
            {/* Notebook is a separate route subtree, not a lens (design spec
                decision 11, refined 2026-07-20) — a nav link here, not a
                TabStrip entry, keeps the lens system projection-only. */}
            <Link href={`/trips/${tripId}/pages`} className="text-sm text-slate hover:text-ink">
              Notebook
            </Link>
          </nav>
          {renaming ? (
            <Input
              aria-label="Trip name"
              defaultValue={trip.name}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.currentTarget.blur();
                } else if (e.key === "Escape") {
                  // Unmounting the input here (no blur event fires when a
                  // focused node is removed from the DOM) reverts to
                  // read-only without ever invoking the onBlur commit below.
                  setRenaming(false);
                }
              }}
              onBlur={(e) => commitRename(e.currentTarget.value)}
              className="w-auto max-w-xs"
            />
          ) : (
            <div className="flex items-center gap-1">
              <Heading level={2}>{trip.name}</Heading>
              <Button variant="ghost" size="icon" aria-label="Rename trip" onClick={() => setRenaming(true)}>
                <Pencil className="size-3.5" aria-hidden />
              </Button>
            </div>
          )}
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
        tripName={trip.name}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        startDate={trip.startDate}
        endDate={trip.days[trip.days.length - 1]?.date ?? null}
        dayCount={trip.days.length}
        currency={trip.currency}
        budget={trip.budget}
        onCommand={(command) => {
          if (command.type !== "CreateTrip") void dispatch(command);
        }}
        onDeleted={(deleted, outcome) => {
          applyOutcome(outcome);
          setSettingsOpen(false);
          setDeleteToast(deleted);
        }}
      />

      {deleteToast && (
        <Toast
          message={`Deleted "${deleteToast.name}"`}
          actionLabel="Undo"
          onAction={() => void undoDelete()}
          onDismiss={() => {
            setDeleteToast(null);
            router.push("/");
          }}
        />
      )}
    </header>
  );
}
