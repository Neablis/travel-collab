"use client";

import { useCallback, useState } from "react";
import { Toast } from "@/components/ui/toast";
import { KeepDayDialog, type KeepDayCandidate } from "@/components/trip/KeepDayDialog";
import { PennantButton, usePennantCelebration } from "@/components/ui/pennant";
import { ACCENT_INK_TEXT, type AccentFamily } from "@/lib/dayAccent";

// Handoff README "Keep this day": an icon-only pennant, 30px circle,
// `--color-surface` background, glyph tinted in the day's ink color. The
// circle, its wave and its celebration are `PennantButton`'s since the notebook
// grew a pennant of its own (Mitchell, PR #269 preview); their history moved
// with them.
//
// Real as of M11 link 6 — the caller used to wrap this in
// <Preview id="keep-day-flag">, which shielded the click and stamped a chip.
// The onClick was already wired against the day this would eventually save;
// what the shell was missing was somewhere to save it to.
//
// Disabled on an empty day rather than hidden: the pennant is part of the
// day's row furniture and a row that loses a control as its last stop is
// removed is worse than one whose control greys out. `title` says why.

/**
 * Provides a share pennant for saving a trip day and displays save confirmation feedback.
 *
 * @param dayIndex - The zero-based index of the day.
 * @param accent - The accent family used to style the control.
 * @param tripId - The identifier of the trip containing the day.
 * @param dayId - The identifier of the day to save.
 * @param tripName - The name of the trip.
 * @param stops - The stops included in the day.
 */
export function KeepDayFlag({
  dayIndex,
  accent,
  tripId,
  dayId,
  tripName,
  days,
}: {
  dayIndex: number;
  accent: AccentFamily;
  tripId: string;
  dayId: string;
  tripName: string;
  /**
   * Every day of the trip, in trip order — the dialog's picker offers all of
   * them and arrives with `dayId` selected (M23 link 4).
   *
   * The flag is still about ONE day: `dayIndex` labels this pennant, and
   * `dayId` is the anchor the dialog opens on. The rest of the trip travels
   * with it because the dialog lets you add other days, and the alternative was
   * for the dialog to fetch a trip the board already has in hand.
   */
  days: KeepDayCandidate[];
}) {
  const [open, setOpen] = useState(false);
  /** How many days the last keep held, while its toast is up. */
  const [saved, setSaved] = useState<number | null>(null);
  // The design's `celebrate()` (`dc.html:4871`), which the build shipped
  // without — KeepDayDialog.tsx used to say so in as many words: "the save is
  // real; the confetti is not".
  const { run, celebrate } = usePennantCelebration();
  // **Still the ANCHOR day's emptiness, deliberately** (M23). The dialog can now
  // keep several days, so a blank day is no longer unkeepable in principle —
  // but the pennant on a blank day is a bad door into that: "keep this day"
  // offered on a day holding nothing, to be answered by picking two other days,
  // is a control that does not mean what it says. Start from a day with
  // something in it and add the blank one as a rest day, which the picker shows
  // and names.
  const empty = (days.find((d) => d.dayId === dayId)?.stops.length ?? 0) === 0;

  // Both halves of the outcome: the toast says what was kept and is what a
  // screen reader hears; the pennant shows it, decoratively.
  const onSaved = useCallback(
    (dayCount: number) => {
      setSaved(dayCount);
      celebrate();
    },
    [celebrate],
  );

  return (
    <>
      <PennantButton
        label={`Keep day ${dayIndex + 1}`}
        title={empty ? "Add a stop to this day first" : "Keep this day"}
        disabled={empty}
        inkClassName={ACCENT_INK_TEXT[accent]}
        run={run}
        celebrationTestId="keep-day-celebration"
        onPress={() => setOpen(true)}
      />
      <KeepDayDialog
        open={open}
        onOpenChange={setOpen}
        tripId={tripId}
        dayId={dayId}
        tripName={tripName}
        days={days}
        onSaved={onSaved}
      />
      {saved !== null && (
        // §35.7's words. It says WHERE the keep went rather than echoing the
        // name just typed, and a sequence is said to be one Playbook — the
        // thing a reader who picked three days might otherwise doubt.
        <Toast
          message={saved > 1 ? `${saved} days kept in your Playbooks as one` : "Kept in your Playbooks"}
          onDismiss={() => setSaved(null)}
        />
      )}
    </>
  );
}
