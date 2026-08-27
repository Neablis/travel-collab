"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Heading } from "@/components/ui/heading";
import { Popover } from "@/components/ui/popover";
import { Toast } from "@/components/ui/toast";
import { useTrip } from "@/components/trip/context/TripProvider";
import { useEditor } from "@/components/trip/context/EditorHost";
import { tripSpend } from "@/lib/cost";
import { sendTripCommand } from "@/lib/apiClient";
import { HistoryPanel } from "@/components/board/HistoryPanel";
import { UndoRedoControls, useUndoRedoShortcuts } from "@/components/board/UndoRedoControls";
import { SettingsSheet } from "./SettingsSheet";
import { ShareButton } from "./ShareButton";
import { TripMetaPill } from "./TripMetaPill";
import { BudgetChip } from "./BudgetChip";

// The bounded chrome surface (design-system.md surface vocabulary, Pattern 4):
// trip identity (name + status) on one row with Share / Add stop / sync /
// History, then the meta pill and budget chip together on the next. A visual
// boundary (bg-surface + border-hairline) separates this chrome from lens
// content below (#14).
//
// Nothing in the header edits the trip directly any more. The title is the
// door to Trip settings, and every field — name included — is edited in
// there; the inline rename Input, its pencil, and the separate settings cog
// are all gone (Mitchell, preview feedback on PR #55). Undo/redo moved into
// the History popover in the same pass, keeping its ⌘Z binding out here where
// it stays mounted.
export function TripHeader({ tripId, children }: { tripId: string; children?: React.ReactNode }) {
  // Render from `activeTrip`, not `trip`: `trip` is the server-confirmed
  // detail only, while `activeTrip` folds in TripProvider's optimistic
  // pending queue (the same value TripBoardScreen/ActivityEditorSheet already
  // render from). Reading `trip` here meant a rename/date/budget edit sat in
  // the optimistic queue correctly but never became visible until the server
  // round-trip confirmed it. `trip` is kept only for the existence/loading gate.
  const { trip, activeTrip, history, status, pending, dispatch, applyOutcome, preview, readOnly, myRole } = useTrip();
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

  // Above the early return, because it owns a useEffect and hooks cannot run
  // conditionally — and because the whole point of splitting it out is that it
  // stays mounted when the History popover (which now holds the buttons) is
  // closed. Gated on `preview.seq === null` so ⌘Z is inert while previewing a
  // past version, exactly as it was when the buttons carried the binding.
  useUndoRedoShortcuts({
    canUndo: preview.seq === null && (history?.canUndo ?? false),
    canRedo: preview.seq === null && (history?.canRedo ?? false),
    onUndo: () => void dispatch({ type: "UndoLastChange", tripId }),
    onRedo: () => void dispatch({ type: "RedoChange", tripId }),
    isBusy: pending,
  });

  if (trip === null || activeTrip === null || status !== "ready") return null;

  async function undoDelete() {
    if (!deleteToast) return;
    const { tripId: restoreId } = deleteToast;
    setDeleteToast(null);
    const result = await sendTripCommand({ type: "RestoreTrip", tripId: restoreId });
    if (result.ok) applyOutcome(result.value);
  }

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
          {/* The title IS the way into Trip settings, and the only way:
              Mitchell, preview feedback on PR #55 — "In the designs, removed
              the pencil, and made the trip title clickable to open the Trip
              edit display the cog currently opens, already remove the cog".
              Renaming therefore happens in that sheet's own "Trip name"
              field, which already existed; the inline Input this replaced is
              gone with the pencil.

              The accessible name deliberately carries BOTH — a bare
              aria-label="Trip settings" would announce the control and
              swallow the trip's name, and the trip name alone never says
              what the button does. Playwright's getByRole name matching is
              substring-and-case-insensitive, so the e2e specs that click
              { name: "Trip settings" } keep working against this. */}
          <div className="flex items-center gap-2">
            {/* The button goes INSIDE the h2, not around it. The other way
                round renders `<button><h2>…</h2></button>`, which is invalid
                (a button's content model is phrasing content) and, worse,
                silently costs the trip its heading: a button's descendants
                are presentational in the accessibility tree, so the h2's role
                is dropped and the name disappears from heading navigation
                entirely. e2e caught it — m8-make-it-real asserts
                getByRole("heading", { level: 2 }) on the trip name.

                Nested this way both roles survive: h2 for structure, button
                for the action. The type classes are restated on the button
                because buttonVariants sets its own `font-medium` + size
                `text-base`, which would otherwise shrink the title inside its
                own heading. */}
            <Heading level={2}>
              <Button
                variant="ghost"
                onClick={() => setSettingsOpen(true)}
                aria-label={`${activeTrip.name} — Trip settings`}
                title="Trip settings"
                className="h-auto justify-start p-0 text-left font-display text-xl font-semibold text-ink hover:bg-transparent hover:underline"
              >
                {activeTrip.name}
              </Button>
            </Heading>
            <Badge variant="neutral">{statusLabel}</Badge>
            {/* M11 link 3: a viewer's trip is theirs to read, not to change.
                The server refuses their writes either way (accessPolicy.ts);
                this is what stops them finding that out by dragging a card. */}
            {readOnly && <Badge variant="info">View only</Badge>}
          </div>
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
              {/* Handoff §2 action cluster: ghost "Share" · primary "Add stop".
                  Real as of M11 link 4 — ShareButton was an inert
                  <Preview id="share-button"> and is now a popover that mints,
                  copies and turns off pinned share links. It needs the tripId
                  it is sharing; everything else about this call site is
                  unchanged. */}
              <ShareButton tripId={tripId} />
              <Button variant="primary" onClick={() => openCreate()}>
                Add stop
              </Button>
            </div>

            <div className="flex items-center gap-0.5">
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
                {/* Undo/redo live here now, not out in the header row —
                    Mitchell, preview feedback on PR #55: "In the designs, the
                    next/previous history button was moved into the history
                    dropdown at the top". Hidden while previewing a past
                    version, same gate they had in the header: the panel's own
                    Revert / back-to-now controls are what act then. The ⌘Z
                    shortcut does NOT live with them (see
                    useUndoRedoShortcuts, called above) — popover content
                    unmounts when closed, and undo must keep working. */}
                {preview.seq === null && (
                  <div className="mb-2 flex justify-end border-b border-hairline pb-2">
                    <UndoRedoControls
                      canUndo={history?.canUndo ?? false}
                      canRedo={history?.canRedo ?? false}
                      onUndo={() => void dispatch({ type: "UndoLastChange", tripId })}
                      onRedo={() => void dispatch({ type: "RedoChange", tripId })}
                      isBusy={pending}
                    />
                  </div>
                )}
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
        </div>
      </div>

      {/* The meta pill and the budget chip are one row, not one-per-column:
          Mitchell, preview feedback on PR #55 — "The Budget card should be
          same height, and aligned with the left side Date / Days / Stops /
          cities Card". `items-stretch` is what makes them equal height (the
          budget chip is the taller of the two — it carries a progress bar
          under its amount — so the meta pill grows to meet it rather than
          either being pinned to a hardcoded height). This is also what the
          2026-08-24 design does: both sit in its `grid-row: 2`, spread by a
          justify-between. */}
      <div className="mt-2 flex flex-wrap items-stretch justify-between gap-3">
        <TripMetaPill detail={activeTrip} onOpenSettings={() => setSettingsOpen(true)} />
        <BudgetChip spend={tripSpend(activeTrip)} currency={activeTrip.currency} onOpenSettings={() => setSettingsOpen(true)} />
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
        forkedFrom={activeTrip.forkedFrom}
        myRole={myRole}
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
