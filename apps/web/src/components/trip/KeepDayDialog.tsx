"use client";

import { useEffect, useId, useState } from "react";
import type { SavedStop, TimeFormat } from "@tc/contracts";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { Text } from "@/components/ui/text";
import { createSavedDay } from "@/lib/apiClient";
import { submitOnEnter } from "@/lib/submitOnEnter";
import { toClockLabel, toClockRange } from "@/lib/time";
import { useTimeFormat } from "@/components/account/PreferencesProvider";
import { formatTripDate } from "@/lib/formatDate";

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
// **M23: the dialog keeps a SEQUENCE, and the picker below is how.** The
// pennant still means "keep this day" and still opens this dialog with that day
// already selected — the one-day keep is unchanged and is still accept-and-Enter
// (the milestone's "one day stays the ordinary case; the single-day call must
// not become harder"). What is new is a strip of the trip's days underneath it,
// where any other day can be toggled in.
//
// **And the strip is behind a button.** Mitchell, preview feedback on #192:
// *"can we make selecting more days the extra experience? Meaning, theres a
// button saying 'Do you want to add more days?' and clicking it adds the
// calendar"*. The picker shipped expanded, which put a grid of every day of the
// trip between the name field and the Save button for the case that is almost
// always what somebody means — keeping the one day they clicked the pennant on.
// Collapsed, the one-day dialog is the dialog M11 shipped plus one line; the
// sequence is one click away and nothing about it is hidden once it is asked
// for. It does not collapse again: re-hiding a strip that has three days
// selected would conceal the thing the dialog is now about.
//
// **Toggles, NOT a range.** Mitchell, 2026-09-19: *"I would really prefer they
// don't have to be sequential days in your trip ... you aren't selecting a
// range."* Days 1, 3 and 5 of a trip make a perfectly good three-day Playbook —
// the days you skipped simply are not in it, and the Playbook renumbers from
// one. A range control would have made the common "weekend plus the good day
// midweek" case impossible to express, and would have implied the gap days were
// being kept as blanks, which is a different thing the model CAN say and this
// selection does not mean.
//
// **The summary states the count before the button acts** — M23 link 4's one
// substantive rule. "Add to trip" appending three days when somebody expected
// one is the failure that rule exists to prevent, and the same honesty is owed
// at the keeping end.
//
// **M27 (SPEC §35.7): the design now matches this dialog**, and adds three
// things to it: the CTA says what it keeps (*Keep this day* / *Keep N days*,
// never a bare *Save*), each day toggle is labelled with its city, and a
// preview lists the stops of every selected day before the button acts — the
// same "say it before it happens" rule the summary follows, one level down.
//
// The prototype's celebrate() choreography — spring, ring burst, sparks, the
// "Kept" pill — is built as of this branch, and fires off `onSaved` below:
// see `KeepDayFlag`. What is still NOT built is where that choreography lands
// in the design — `data-kept="1"`, the pennant resting solid green with "In
// your Playbooks — edit or share". `SavedDay` records `sourceTripId` but no
// `sourceDayId`, so after a reload nothing can answer "is this day kept?".
// ADR-040 is that question.

/** One of the trip's days, as the picker needs it. */
export type KeepDayCandidate = {
  dayId: string;
  /** The derived calendar date, or null when the trip has no start date. */
  date: string | null;
  /**
   * The day's city as its chip names it (`cityFor`), or null when none of its
   * stops says — the toggle then reads `Day N` alone (§35.7).
   */
  city: string | null;
  stops: SavedStop[];
};

/**
 * What is about to be kept, stated before the button acts (M23 link 4).
 *
 * **It leads with the DAY count**, because that is the number the reader is
 * about to be surprised by. A clock range is only offered for a single day: a
 * sequence has no one window, and "09:00–22:00" over three days would be read
 * as a single day's span — the same falsehood `savedDayFacts` now refuses to
 * state for a multi-day Playbook (ADR-048 decision 4).
 *
 * **A sequence that does not start on the trip's day 1 says which day does**
 * (§35.7: *"Day 4 becomes day 1."*). The Playbook renumbers from one, and a
 * reader who picked days 4 and 6 should not have to infer that.
 *
 * **An empty day among several is named, not hidden.** "3 days · 9 stops" is
 * true and still conceals that one of them is blank, and a rest day is a thing
 * you can mean — so it is said out loud, and the model keeps it (a gap in
 * `dayIndex`, counted by `dayCount`).
 *
 * **"Order and gaps kept, no dates." is gone** — Mitchell, preview feedback on
 * #192: *"Drop the Order and gaps kept, no dates"*. It was inherited from the
 * design shell's placeholder, and it describes the storage model rather than
 * this day: every Playbook keeps order and drops dates, so the sentence is the
 * same on every keep anybody will ever do and carries no information about the
 * thing being kept. What is left is only what varies — how many days, how many
 * stops, the clock range when there is one, and which days are rest days.
 */
function includedSummary(selected: KeepDayCandidate[], all: KeepDayCandidate[], clock: TimeFormat): string {
  const stops = selected.flatMap((d) => d.stops);
  if (selected.length === 0) return "Pick at least one day.";
  if (stops.length === 0) {
    return selected.length === 1
      ? "Nothing yet — this day has no stops."
      : `Nothing yet — none of these ${selected.length} days has a stop.`;
  }
  const count = `${stops.length} stop${stops.length === 1 ? "" : "s"}`;
  if (selected.length > 1) {
    const empty = selected.filter((d) => d.stops.length === 0).length;
    const rest =
      empty === 0
        ? ""
        : ` ${empty === 1 ? "One day has" : `${empty} days have`} no stops — kept as ${empty === 1 ? "a rest day" : "rest days"}.`;
    const firstIndex = all.findIndex((d) => d.dayId === selected[0]!.dayId);
    const renumbered = firstIndex > 0 ? ` Day ${firstIndex + 1} becomes day 1.` : "";
    return `${selected.length} days, ${count}, in order.${renumbered}${rest}`;
  }
  const windows = stops.map((s) => s.timeWindow).filter((w) => w !== null);
  const first = windows[0];
  const last = windows[windows.length - 1];
  if (first === undefined || last === undefined) return `${count}, in order.`;
  return `${count}, ${toClockRange(first.start, last.end, clock)}.`;
}

/**
 * The stops that will lose a calendar-date anchor, said before the button acts
 * (KI-2026-09-24-c), or null when none will.
 *
 * The app's keep drops every `dateRange` anchor on the way in, as
 * `POST /v1/playbooks` does (ADR-050 decision 8): a Playbook has no dates, and
 * "only 3–5 May" carried into October is a conflict on that stop. Weekday,
 * time-of-day and holiday anchors describe the place and are kept, so they are
 * not mentioned. The rule here is the server's `withoutDateAnchors`, restated,
 * because that module is server-only; the server is what decides.
 */
function droppedDatesNote(selected: KeepDayCandidate[]): string | null {
  const titles = selected
    .flatMap((d) => d.stops)
    .filter((s) => s.anchors.some((a) => a.kind === "dateRange"))
    .map((s) => `"${s.title}"`);
  if (titles.length === 0) return null;
  return titles.length === 1
    ? `A Playbook has no dates, so the date anchor on ${titles[0]} won't be kept.`
    : `A Playbook has no dates, so the date anchors on ${titles.length} stops won't be kept: ${titles.join(", ")}.`;
}

/**
 * The name the dialog offers — the day, or the count, and the trip.
 *
 * A default worth keeping is one you can accept without thinking. It follows
 * the selection until the moment the reader types, and then it stops: a default
 * that overwrites what somebody has typed is not a default.
 */
function defaultName(selected: KeepDayCandidate[], all: KeepDayCandidate[], tripName: string): string {
  if (selected.length === 1) {
    const only = all.findIndex((d) => d.dayId === selected[0]!.dayId);
    return `Day ${only + 1} of ${tripName}`;
  }
  return `${selected.length} days of ${tripName}`;
}

/**
 * The stops about to be kept, per selected day (§35.7).
 *
 * A day header only when there is more than one day: it carries the
 * renumbering (`Day 1 · from Day 4 · Kyoto`), which is noise when nothing is
 * renumbered. A blank day says so rather than rendering as a gap, for the same
 * reason the summary names rest days.
 */
function KeepPreview({ selected, all }: { selected: KeepDayCandidate[]; all: KeepDayCandidate[] }) {
  const clock = useTimeFormat();
  return (
    <div className="flex flex-col gap-2.5 rounded-md border border-hairline bg-paper p-3" data-testid="keep-day-preview">
      {selected.map((day, i) => {
        const from = all.findIndex((d) => d.dayId === day.dayId) + 1;
        return (
          <div key={day.dayId}>
            {selected.length > 1 && (
              <Text as="span" className="mb-1 block text-2xs tracking-wider text-slate uppercase">
                Day {i + 1} · from Day {from}
                {day.city === null ? "" : ` · ${day.city}`}
              </Text>
            )}
            {day.stops.length === 0 ? (
              <Text as="span" className="block py-0.75 text-sm text-slate">
                Rest day — no stops
              </Text>
            ) : (
              day.stops.map((stop, k) => (
                <div key={k} className="flex gap-2.5 py-0.75 text-sm">
                  <span className="w-21 flex-none pt-0.5 font-mono text-2xs text-slate">
                    {stop.timeWindow === null ? "" : toClockLabel(stop.timeWindow.start, clock)}
                  </span>
                  <span className="text-ink">{stop.title}</span>
                </div>
              ))
            )}
          </div>
        );
      })}
    </div>
  );
}

export function KeepDayDialog({
  open,
  onOpenChange,
  tripId,
  dayId,
  tripName,
  days,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tripId: string;
  /** The day the pennant was clicked on — the anchor, selected when this opens. */
  dayId: string;
  tripName: string;
  /** Every day of the trip, in trip order — what the picker offers. */
  days: KeepDayCandidate[];
  /** Called once the keep lands, with how many days went into it. */
  onSaved?: (dayCount: number) => void;
}) {
  const clock = useTimeFormat();
  const nameId = useId();
  const includedId = useId();
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // The picker is opt-in — see the header. False on every open, including an
  // open on a day whose dialog was expanded last time: the anchor day is the
  // question being asked, and a strip of twelve days is not part of it.
  const [showDays, setShowDays] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // **Selection is kept in TRIP ORDER, never click order.** The array's order
  // becomes each stop's `dayIndex` (`stopsForDays`), so it decides what the
  // Playbook's day 1 is — and the picker is a calendar strip, which can show
  // that a day is chosen but cannot show when it was chosen. Honouring click
  // order would make two identical-looking selections produce two different
  // Playbooks. Reordering days is not a feature M23 ships.
  const selected = days.filter((d) => selectedIds.includes(d.dayId));

  // Reset on every open, so a dialog reopened on a different day does not offer
  // the previous day's selection or its name.
  useEffect(() => {
    if (open) {
      setSelectedIds([dayId]);
      setShowDays(false);
      setNameTouched(false);
      setError(null);
    }
  }, [open, dayId]);

  // The name follows the selection until the reader types. `nameTouched` is the
  // whole of that rule: after it flips, nothing here writes to `name` again.
  useEffect(() => {
    if (!open || nameTouched) return;
    setName(defaultName(days.filter((d) => selectedIds.includes(d.dayId)), days, tripName));
  }, [open, nameTouched, selectedIds, days, tripName]);

  // Nothing to save is the WHOLE selection being empty — one blank day among
  // three is a rest day and is perfectly keepable. `saveDay` draws the same
  // line on the server, which is the boundary that actually decides.
  const droppedDates = droppedDatesNote(selected);
  const nothingToSave = selected.length === 0 || selected.every((d) => d.stops.length === 0);

  function toggle(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id],
    );
  }

  async function save() {
    const trimmed = name.trim();
    if (selected.length === 0) {
      setError("Pick at least one day to keep.");
      return;
    }
    if (trimmed === "") {
      setError("Give it a name you'll recognise later.");
      return;
    }
    setBusy(true);
    setError(null);
    // Trip order, from `selected` — see the note where it is derived.
    const result = await createSavedDay({ name: trimmed, tripId, dayIds: selected.map((d) => d.dayId) });
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    onOpenChange(false);
    onSaved?.(selected.length);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={selected.length > 1 ? "Keep these days" : "Keep this day"}>
      <div className="flex flex-col gap-3">
        <FormField id={nameId} label="Name">
          {/* **Opens focused, so the one-day keep is "accept it and press
              Enter".** `autoFocus` is what makes that true. Without it Radix
              focuses the first tabbable node in `DialogContent` — the header's
              Close button — so a bare Enter on open closed the dialog and saved
              nothing (KI-2026-09-19-d, measured on a preview 2026-09-19). Radix
              only does that when nothing inside the content already has focus,
              and React's `autoFocus` lands first, so the field wins without
              touching the shared `Dialog`.
              Enter is guarded the same way the Keep button is: a selection with
              nothing in it cannot be kept, and `save()` itself refuses a blank
              name with the same message either way. */}
          <Input
            id={nameId}
            autoFocus
            value={name}
            onChange={(e) => {
              setNameTouched(true);
              setName(e.target.value);
            }}
            onKeyDown={submitOnEnter(() => {
              if (busy || nothingToSave) return;
              void save();
            })}
            placeholder="e.g. A day in Nakameguro"
          />
        </FormField>
        {showDays ? (
          <div className="flex flex-col gap-1.75">
            {/* §35.7's helper, in place of a "Days" label: it answers the one
                question the grid raises — do they have to be consecutive? —
                before anybody has to find out by trying. */}
            <Text as="span" variant="muted">
              Days — any, not just ones in a row
            </Text>
            {/* A strip of the trip's days, each one a toggle. NOT a range — see
                the header. The anchor day arrives selected, so the one-day keep
                is untouched; every other day is one click away and they need not
                be adjacent. `aria-pressed` rather than checkboxes because these
                are buttons that change what the dialog is about, and a screen
                reader should hear the state on the control itself. */}
            {/* **A grid, so every day is the same width and the same height.**
                Mitchell, preview feedback on #192: *"Make these a Table, they
                should fit the longest text, but also all be aligned in height and
                width"*. `flex-wrap` sized each chip to its own label, so a row
                lined up on nothing — "Day 1 / no stops" next to "Day 12 / Sep 14
                · 6 stops".
                Implemented as a CSS grid rather than a real `<table>`: these are
                toggle buttons in a `role="group"`, and wrapping them in table
                semantics would tell a screen reader they are tabular data. The
                grid gives the alignment the feedback is about; the roles stay
                honest.
                **Two columns at every width, and the number is measured
                rather than chosen.** This shipped as `grid-cols-2
                sm:grid-cols-3` with a comment asserting that three columns
                "fits the longest label this can produce". Measured on the
                preview: it does not. At 1280px the group is 408px, so a
                3-column cell is `(408 - 2×6) / 3 = 132px` with a 114px content
                box — and the widest label this can render, `Day 3` over
                `Wed, Sep 16 · 10 stops`, is **124.19px**. It does not wrap
                (`whitespace-nowrap`) and does not ellipsise (`overflow:
                visible`), so it simply spilled: 10 of 12 chips ate all 8px of
                their right padding and the worst crossed the 1px border by
                1.19px.
                The label needs 124.19 + 16 padding + 2 border = **142.19px**.
                Two columns give 201px at desktop and 182.5px at 411px —
                +58.81 and +40.31 of slack, enough for a three-digit stop count
                and any month abbreviation. Three columns were short by 10.19px
                at desktop and 22.52px on a phone, so `sm:grid-cols-3` was never
                right at any width; the `sm` branch only hid it on the screen
                nobody was measuring.
                **The date is what makes the label long.** A dateless trip
                renders `6 stops` (39.48px) and had 74px of slack at three
                columns — which is why every earlier fixture looked fine and
                only a trip with a start date showed the overflow.
                A fixed count rather than an `auto-fill` track because the
                obvious spelling, `grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))]`,
                is an arbitrary Tailwind value and `check-color-wall` refuses
                those (design-system.md: tokens only). It was right to: the
                dialog is `max-w-md`, so the track count was never responsive to
                anything but a width this control already knows.
                Equal `1fr` columns give the width half of the ask; grid items
                stretch by default, so the heights agree without being asked —
                and that half was already correct, at 132.00px × 12 and
                42.38px × 12 before this change.
                **The `Day N · City` label (M27, §35.7) may wrap; the meta
                may not.** A city name has no length bound, so the label
                is the one line allowed to break — and grid items stretch,
                so a two-line chip makes its whole row taller rather than
                misaligning it. */}
            <div
              className="grid grid-cols-2 gap-1.5"
              role="group"
              aria-label="Days to keep"
            >
              {days.map((day, index) => {
                const on = selectedIds.includes(day.dayId);
                return (
                  <ToggleChip key={day.dayId} pressed={on} onClick={() => toggle(day.dayId)}>
                    <span className="text-sm font-semibold">
                      Day {index + 1}
                      {day.city === null ? "" : ` · ${day.city}`}
                    </span>
                    <span className="whitespace-nowrap opacity-80">
                      {day.date === null ? "" : `${formatTripDate(day.date)} · `}
                      {day.stops.length === 0
                        ? "no stops"
                        : `${day.stops.length} stop${day.stops.length === 1 ? "" : "s"}`}
                    </span>
                  </ToggleChip>
                );
              })}
            </div>
          </div>
        ) : (
          days.length > 1 && (
            /* **The ask, not a disclosure triangle.** It reads as a question
               and answers with the picker, which is how the feedback put it —
               and it is absent altogether on a one-day trip, where there is no
               other day to add and the question would be a dead end.
               `variant="secondary"` and full width: it sits between two form
               fields, and a ghost button there reads as a hint rather than as
               something to press. */
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              onClick={() => setShowDays(true)}
            >
              Do you want to add more days?
            </Button>
          )
        )}
        <FormField id={includedId} label="What's included">
          <Text as="span" id={includedId} className="text-sm text-ink">
            {includedSummary(selected, days, clock)}
          </Text>
        </FormField>
        {selected.length > 0 && <KeepPreview selected={selected} all={days} />}
        {droppedDates !== null && (
          <Text as="span" className="text-xs text-slate" data-testid="keep-day-dropped-dates">
            {droppedDates}
          </Text>
        )}
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
          disabled={busy || nothingToSave}
          onClick={() => void save()}
        >
          {selected.length > 1 ? `Keep ${selected.length} days` : "Keep this day"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
