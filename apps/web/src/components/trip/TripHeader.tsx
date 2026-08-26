"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Clock, Pencil, Settings } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Heading } from "@/components/ui/heading";
import { Input } from "@/components/ui/input";
import { Popover } from "@/components/ui/popover";
import { Toast } from "@/components/ui/toast";
import { useTrip } from "@/components/trip/context/TripProvider";
import { useEditor } from "@/components/trip/context/EditorHost";
import { tripSpend } from "@/lib/cost";
import { sendTripCommand } from "@/lib/apiClient";
import { HistoryPanel } from "@/components/board/HistoryPanel";
import { UndoRedoControls } from "@/components/board/UndoRedoControls";
import { SettingsSheet } from "./SettingsSheet";
import { SyncIndicator } from "./SyncIndicator";
import { ShareButton } from "./ShareButton";
import { TripMetaPill } from "./TripMetaPill";
import { BudgetChip } from "./BudgetChip";

// The bounded chrome surface (design-system.md surface vocabulary, Pattern 4):
// trip identity (name, now renameable inline — task A13) + a budget-vs-total
// glance, plus the action affordances (undo/redo, History popover, Settings
// sheet gear). A visual boundary (bg-surface + border-hairline) separates this
// chrome from lens content below (#14). No editable date/budget inputs live
// here — those moved to SettingsSheet (comments 15, 12b); the name is the one
// piece of identity that's directly editable in the chrome itself.
export function TripHeader({ tripId, children }: { tripId: string; children?: React.ReactNode }) {
  // Render from `activeTrip`, not `trip`: `trip` is the server-confirmed
  // detail only, while `activeTrip` folds in TripProvider's optimistic
  // pending queue (the same value TripBoardScreen/ActivityEditorSheet already
  // render from). Reading `trip` here meant a rename/date/budget edit sat in
  // the optimistic queue correctly but never became visible until the server
  // round-trip confirmed it. `trip` is kept only for the existence/loading gate.
  const { trip, activeTrip, history, status, pending, sync, dispatch, applyOutcome, preview } = useTrip();
  const router = useRouter();
  // Task 9: "Add stop" is a real trigger for the same portable activity
  // editor Board's own "+ Add activity" button opens (Board.tsx) — no
  // dayId prefill, identical to that button's own openCreate() call.
  // TripHeader now renders inside EditorHost (trips/[tripId]/page.tsx wraps
  // TripBoardScreen, which mounts TripHeader, in <EditorHost>), so this hook
  // is always safe to call here.
  const { openCreate } = useEditor();
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

  if (trip === null || activeTrip === null || status !== "ready") return null;

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
    if (name !== "" && name !== activeTrip.name) {
      void dispatch({ type: "SetTripName", tripId, name });
    }
    setRenaming(false);
  };

  // Handoff §2: "neutral `Badge` state" next to the trip name — just a
  // display of activeTrip.status ("active" | "deleted", contracts/trip.ts),
  // capitalized for display. Not a new capability, purely presentational.
  const statusLabel = activeTrip.status.charAt(0).toUpperCase() + activeTrip.status.slice(1);

  return (
    <header aria-label="Trip" className="sticky top-14 z-10 border-b border-hairline bg-surface px-6 pt-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <nav className="flex items-center gap-3">
            <Link href="/" className="text-xs text-slate hover:text-ink">
              ← Your trips
            </Link>
            {/* Notebook is a separate route subtree, not a lens (design spec
                decision 11, refined 2026-07-20) — a nav link here, not a
                TabStrip entry, keeps the lens system projection-only. */}
            <Link href={`/trips/${tripId}/pages`} className="text-xs text-slate hover:text-ink">
              Notebook
            </Link>
          </nav>
          {renaming ? (
            <Input
              aria-label="Trip name"
              defaultValue={activeTrip.name}
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
            <div className="flex items-center gap-2">
              <Heading level={2}>{activeTrip.name}</Heading>
              <Badge variant="neutral">{statusLabel}</Badge>
              <Button variant="ghost" size="icon" aria-label="Rename trip" onClick={() => setRenaming(true)}>
                <Pencil className="size-3.5" aria-hidden />
              </Button>
            </div>
          )}
          {/* Handoff `current/…dc.html:255-296`: the meta pill (dates, day/
              stop/city counts, crew) replaces the bare start date + BudgetMeter
              glance — TripMetaPill.tsx (Task 1.4). */}
          <TripMetaPill detail={activeTrip} onOpenSettings={() => setSettingsOpen(true)} />
        </div>

        {/* Right side: the handoff action cluster (ghost Trip settings · ghost
            Share · primary Add stop), then the pre-existing sync/undo-redo/
            history cluster, then the BudgetChip underneath — a column so the
            outer row keeps its two-child justify-between split (info block vs.
            everything else) as it wraps at narrow widths. "Add a saved day"
            moved out of the header entirely (Task 1.4) — the design moved it
            into the plan flow; Phase 6 rebuilds it there. */}
        <div className="flex flex-col items-end gap-2">
          {/* `sm:flex-nowrap`, not a bare flex-wrap removal: this row's own
              content (settings/share/add-stop + sync/undo/history) never
              needs more than ~433px, but a nested flex item's own content
              width isn't what decides whether the OUTER row (the
              title/right-cluster split above) wraps — that uses the right
              cluster's unwrapped intrinsic size, so this row can still get
              squeezed narrower than its content while staying on the
              outer row's first line, and its own `flex-wrap` would then
              split "settings/share/add stop" from "sync/undo/history"
              internally rather than the whole cluster dropping below the
              title (confirmed live by forcing this row's parent narrower
              than its content). `flex-wrap` stays as the floor below `sm`
              (640px) — comfortably above the ~480px this row's content
              needs — so genuinely narrow viewports keep the old two-line
              fallback instead of overflowing. */}
          <div className="flex flex-wrap items-center gap-4 sm:flex-nowrap">
            <div className="flex flex-wrap items-center gap-2">
              {preview.seq === null && (
                <Button variant="ghost" size="icon" aria-label="Trip settings" onClick={() => setSettingsOpen(true)}>
                  <Settings className="size-3.5" aria-hidden />
                </Button>
              )}
              {/* Handoff §2 action cluster: ghost "Share" · primary "Add stop".
                  Share is self-wrapped in its own <Preview> internally
                  (ShareButton.tsx, Task 18), so this header just mounts it like
                  any other control — no local Preview wrap or onClick needed
                  here. */}
              <ShareButton />
              <Button variant="primary" onClick={() => openCreate()}>
                Add stop
              </Button>
            </div>

            <div className="flex items-center gap-0.5">
              {/* KI-36: fed from the queue's own state — `sync.unsent` is the
                  live count of units the server has not accepted, and
                  `sync.retry` re-sends the retained head. Not `pending`, which
                  is a boolean and cannot tell "saving" from "couldn't save". */}
              <SyncIndicator
                unsent={sync.unsent}
                failure={sync.failure}
                onRetry={sync.retry}
                className="mr-2"
              />
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
            </div>
          </div>

          <BudgetChip spend={tripSpend(activeTrip)} currency={activeTrip.currency} onOpenSettings={() => setSettingsOpen(true)} />
        </div>
      </div>

      {/* Handoff `current/…dc.html:249`: the tab strip and the day-chips row
          live INSIDE the sticky container, not after it. Before this they
          scrolled away while the header kept 147px of chrome pinned, so the two
          rows you actually navigate with were the first things to disappear. */}
      {children !== undefined && <div className="flex flex-col gap-3 pt-3 pb-3">{children}</div>}

      <SettingsSheet
        tripId={tripId}
        tripName={activeTrip.name}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        startDate={activeTrip.startDate}
        endDate={activeTrip.days[activeTrip.days.length - 1]?.date ?? null}
        dayCount={activeTrip.days.length}
        currency={activeTrip.currency}
        budget={activeTrip.budget}
        spend={tripSpend(activeTrip)}
        members={activeTrip.members}
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
