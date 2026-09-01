"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Money, TripCommand, TripDetail, TripRole } from "@tc/contracts";
import { Sheet } from "@/components/ui/sheet";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { DataText } from "@/components/ui/data-text";
import { BudgetMeter } from "@/components/ui/budget-meter";
import { Banner } from "@/components/ui/banner";
import { Preview } from "@/components/ui/preview";
import { Popover } from "@/components/ui/popover";
import { TravelersPanel } from "@/components/trip/TravelersPanel";
import { ShareButton } from "@/components/trip/ShareButton";
import type { TripCounts } from "@/components/trip/TripMetaPill";
import { TripMoneySettings } from "@/components/board/TripMoneySettings";
import { TripDateControl } from "@/components/lenses/TripDateControl";
import { formatInstantLong, formatTripDate } from "@/lib/formatDate";
import { formatMoney } from "@/components/lenses/formatMoney";
import type { TripSpend } from "@/lib/cost";
import { duplicateTrip, sendTripCommand, type CommandOutcome } from "@/lib/apiClient";

// The four category rows in the "unbacked" budget breakdown are illustrative
// only (Preview id="budget-breakdown", M11 — no field on TripDetail
// classifies a cost into a category yet). Weights are just a plausible
// split of spend.total for the mock, not read from any real data.
const BREAKDOWN_CATEGORIES = [
  { label: "Booked", weight: 0.45 },
  { label: "Holds", weight: 0.2 },
  { label: "Travel", weight: 0.25 },
  { label: "Other", weight: 0.1 },
] as const;

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <Text as="span" className="mb-2.5 block text-xs font-semibold uppercase tracking-wider text-slate">
      {children}
    </Text>
  );
}

function datesLabel(startDate: string | null, endDate: string | null): string {
  if (startDate === null) return "No dates set";
  if (endDate === null || endDate === startDate) return formatTripDate(startDate);
  return `${formatTripDate(startDate)} – ${formatTripDate(endDate)}`;
}

// Trip-global edits, re-homed out of the always-visible header (Pattern 4,
// comment 12b): budget/currency and the start date are set-once/rare operations, so
// they belong in a raised Sheet, not permanent chrome.
//
// Redesign (Task 4.2, current/…dc.html:849-900) shipped the Dates row as
// read-only, leaving TripDateControl (the only way to actually change dates)
// with no mount point anywhere in the app — an unintentional capability loss,
// not a deliberate deferral (product-owner ruling, 2026-08-22, superseding
// the D-2 known-issues entry). Fix: the Dates row is now a real trigger —
// clicking it opens a Popover containing TripDateControl, the same
// click-a-row/open-a-small-control idiom TripHeader's own History popover
// uses (TripHeader.tsx, ~line 181). TripMoneySettings keeps its existing
// handlers/aria-labels and dispatch logic byte-identical — this task only
// touches the Dates row.
//
// A15: Delete/Duplicate mirror the trip-list row menu (page.tsx), but dispatch
// via `sendTripCommand`/`duplicateTrip` directly rather than through
// `onCommand` — `onCommand` runs through TripProvider's optimistic queue,
// which is the wrong shape for a command that's immediately followed by
// leaving the page (queued-but-unsent risk if the tree unmounts before the
// queue's effect fires). Delete also can't raise its own toast: this sheet's
// subtree is what closes/unmounts on success, so it reports success via
// `onDeleted` and leaves the toast to the caller (TripHeader), same as the
// list's local Toast in page.tsx but one level up. `onDeleted` also forwards
// the successful command's CommandOutcome so TripHeader can feed it straight
// into `applyOutcome` (A15-fix) — without that, TripProvider's local
// `trip.status` would stay "active" until the toast closed, leaving the whole
// board fully interactive against already-deleted server state.
export function SettingsSheet({
  tripId,
  tripName,
  open,
  onOpenChange,
  startDate,
  endDate,
  // Re-mounted use (this task): TripDateControl no longer computes
  // newDayIds — Task 8b.6 made the end date derived, not picked. dayCount is
  // still threaded through because the derived-end hint copy needs N ("The
  // end follows the N days in your plan").
  dayCount,
  counts,
  currency,
  budget,
  spend,
  forkedFrom,
  createdAt,
  myRole,
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
  // Days, stops and cities — the same three figures TripMetaPill states, from
  // `tripCounts`, the one function that derives them (TripMetaPill.tsx). They
  // are here because that pill is hidden below 768px: Mitchell asked whether
  // the header's three crowded columns would "still be accessible in trip
  // settings" if hidden, and these two counts were the part of the answer that
  // was no. Passed in already-derived rather than handing this sheet the whole
  // `TripDetail` — every other field here arrives as a scalar the caller read
  // off the trip, and a `detail` prop would invite the next control to derive
  // its own version of something.
  counts: TripCounts;
  currency: string;
  budget: Money | null;
  spend: TripSpend;
  // Where this trip came from, or null if it started from nothing (M11 link
  // 5). Genesis-only and immutable, so it is displayed and never edited.
  forkedFrom: TripDetail["forkedFrom"];
  /**
   * The trip's genesis, which for a copy IS the moment it was taken — lineage
   * is captured at genesis and never mutated (ADR-028), so no new field is
   * needed to date the copy.
   */
  createdAt: string;
  // The signed-in user's role on this trip, or null while it is still loading
  // or the read failed (M11 link 3). ADVISORY: the server refuses every write
  // a role does not permit regardless. It is here so this sheet does not OFFER
  // an action it knows will be refused — `handleDelete` and `handleDuplicate`
  // call the API directly rather than through TripProvider's queue (see A15
  // below), so TripProvider's read-only gate never sees them and cannot help.
  myRole: TripRole | null;
  onCommand: (command: TripCommand) => void;
  // The outcome is forwarded alongside the {tripId, name} summary so the
  // caller (TripHeader) can call TripProvider's applyOutcome with it —
  // mirroring the RestoreTrip/undo path — and reconcile trip.status to
  // "deleted" immediately, rather than leaving the board's local state
  // (and thus its full interactivity) stale for the whole toast window.
  onDeleted: (trip: { tripId: string; name: string }, outcome: CommandOutcome) => void;
}) {
  const router = useRouter();
  // `DeleteTrip` is owner-only in accessPolicy.ts's MINIMUM_ROLE table, so an
  // editor clicking Delete got the same silent nothing a viewer did —
  // `handleDelete` only acts `if (result.ok)`. Gate on the rank the server
  // actually enforces rather than merely hiding it from viewers.
  const canDelete = myRole === "owner";
  // A viewer holds read access and executes no planning command at all —
  // accessPolicy.ts's MINIMUM_ROLE table has no `viewer` entry.
  const readOnly = myRole === "viewer";
  // Dispatch is severed at the SOURCE, not at each control. The individual
  // controls are disabled below so a viewer is not offered something that
  // silently does nothing — but a future control added to this sheet would
  // otherwise leak a command past that per-control gating, and this is the
  // one line that cannot be forgotten (CodeRabbit, PR #70, on the same class
  // as the delete handler). The server refuses these regardless; this is
  // about not offering them.
  const dispatch = readOnly ? () => undefined : onCommand;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [datesOpen, setDatesOpen] = useState(false);

  async function handleDelete() {
    setBusy(true);
    const result = await sendTripCommand({ type: "DeleteTrip", tripId });
    setBusy(false);
    setConfirmOpen(false);
    if (result.ok) {
      onOpenChange(false);
      onDeleted({ tripId, name: tripName }, result.value);
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

  // Null only for an unparseable timestamp, which is a projection bug rather
  // than a state to word around — the line just drops the date rather than
  // rendering "Invalid Date" at somebody.
  const copiedOn = formatInstantLong(createdAt);

  const statusLine =
    spend.budget === null
      ? "No budget set"
      : spend.over
        ? `${formatMoney(Math.abs(spend.remaining ?? 0), currency)} over budget`
        : `${formatMoney(spend.remaining ?? 0, currency)} left`;

  return (
    <Sheet title="Trip settings" open={open} onOpenChange={onOpenChange}>
      <div className="flex flex-col gap-4 pt-1">
        <FormField id="trip-name-setting" label="Trip name" description="Everyone invited sees this name.">
          {/* Editable, and now the ONLY way to rename a trip. This row used to
              be read-only because the header carried an inline rename behind a
              pencil icon; PR #55's preview feedback removed that pencil and
              made the title open this sheet instead, which would have left the
              app with no rename at all if this row had stayed read-only.
              `defaultValue` + commit-on-blur, not a controlled value, so
              typing isn't a command per keystroke. */}
          <Input
            id="trip-name-setting"
            defaultValue={tripName}
            disabled={readOnly}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              // Escape restores the last committed name and drops focus, so
              // the blur below sees an unchanged value and sends nothing.
              else if (e.key === "Escape") {
                e.currentTarget.value = tripName;
                e.currentTarget.blur();
              }
            }}
            onBlur={(e) => {
              const name = e.currentTarget.value.trim();
              // Same no-op guard the header's inline rename had: the domain
              // rejects an empty or unchanged name, and a rejected round-trip
              // is worse than not sending one. Put the field back to the
              // committed name so it never shows a value the trip doesn't have.
              if (name === "" || name === tripName) {
                e.currentTarget.value = tripName;
                return;
              }
              // Show what was actually saved. `name` is trimmed but the field
              // still holds the raw text, so renaming to "  Japan  " would
              // dispatch "Japan" and leave the input displaying the spaces —
              // a field disagreeing with the trip it just renamed (CodeRabbit,
              // PR #55). The guard above already does this for the two no-op
              // cases; this is the third.
              e.currentTarget.value = name;
              dispatch({ type: "SetTripName", tripId, name });
            }}
          />
        </FormField>

        {/* Clickable dates row (this task, restoring TripDateControl's mount
            point) — same 1px hairline border, 8px radius, 10px/12px padding
            the read-only row had, now as a Popover trigger Button so the row
            looks unchanged except for the added interactive affordance.
            aria-label is set explicitly (not derived from datesLabel) so the
            e2e specs' getByRole("button", { name: "Dates" }) stays stable
            regardless of the displayed date value. */}
        <Popover
          open={datesOpen}
          onOpenChange={setDatesOpen}
          align="end"
          trigger={
            <Button
              variant="ghost"
              aria-label="Dates"
              disabled={readOnly}
              className="w-full justify-between rounded-lg border border-hairline px-3 py-2.5 text-left"
            >
              <Text as="span" className="text-xs text-slate">
                Dates
              </Text>
              <DataText size="sm" className="text-ink">
                {datesLabel(startDate, endDate)}
              </DataText>
            </Button>
          }
        >
          <TripDateControl
            tripId={tripId}
            startDate={startDate}
            endDate={endDate}
            dayCount={dayCount}
            onCommand={(command) => {
              dispatch(command);
              setDatesOpen(false);
            }}
            onClose={() => setDatesOpen(false)}
          />
        </Popover>

        {/* The header's meta pill, in words rather than as a pill. The pill is
            hidden below 768px (TripHeader), and Mitchell's question about
            hiding it — "would they still be accessible in trip settings?" —
            had exactly two honest answers: the dates were already here (the
            row above), and the day/stop/city counts were nowhere. This is the
            "nowhere" being fixed, and it is the reason this section exists at
            all, so it sits directly under Dates: together they are the same
            "what is this trip" answer the pill gives in one line.

            Read-only on purpose. Every figure here is derived from the plan —
            you change them by adding a day or a stop, not by typing a number
            into settings — so this is a statement, not a form field, and it
            renders as text rather than as three disabled inputs.

            The strings are the pill's own ("3 days", "12 stops", "2 cities"),
            not re-worded: this is meant to be recognisable as the thing that
            is no longer on screen, and a test that asserts one wording in two
            places is cheaper than two vocabularies drifting. */}
        <div>
          <SectionHeading>Trip overview</SectionHeading>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <DataText size="sm">{counts.days} days</DataText>
            <DataText size="sm">{counts.stops} stops</DataText>
            <DataText size="sm">{counts.cities} cities</DataText>
          </div>
        </div>

        <div>
          <SectionHeading>Budget</SectionHeading>
          <TripMoneySettings
            tripId={tripId}
            currency={currency}
            budget={budget}
            disabled={readOnly}
            onCommand={dispatch}
          />

          <div className="mt-3 flex flex-col gap-3">
            <div className="flex items-center gap-3">
              {spend.budget !== null && (
                <BudgetMeter cost={spend.total} budget={spend.budget} currency={currency} />
              )}
              <Text as="span" className="text-xs text-slate">
                {statusLine}
              </Text>
            </div>

            {spend.over && (
              <Banner variant="warning">
                This trip is over budget by {formatMoney(Math.abs(spend.remaining ?? 0), currency)}.
              </Banner>
            )}

            {/* Unbacked mock breakdown (M11 — no field classifies a cost into
                a category yet): the whole block is Preview-disabled, the
                honest total/meter/banner/unpriced count above and below stay
                real and outside it. */}
            <Preview id="budget-breakdown" size="container">
              <div className="flex flex-col gap-2.5">
                {BREAKDOWN_CATEGORIES.map((row) => {
                  const amount = Math.round(spend.total * row.weight);
                  const pct = spend.total > 0 ? Math.min(100, (amount / spend.total) * 100) : 0;
                  return (
                    <div key={row.label} className="flex items-center gap-2.5">
                      <Text
                        as="span"
                        // eslint-disable-next-line no-restricted-syntax -- the redesign's 150px breakdown-label column has no token equivalent, matching BudgetChip's computed-geometry pattern
                        style={{ flex: "0 0 150px" }}
                        className="text-xs text-ink"
                      >
                        {row.label}
                      </Text>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-moss">
                        <div
                          className="h-full rounded-full bg-brand"
                          // eslint-disable-next-line no-restricted-syntax -- fill width is a spend/budget percentage, not expressible as a token (BudgetChip's own pattern)
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <DataText size="sm">{formatMoney(amount, currency)}</DataText>
                    </div>
                  );
                })}
              </div>
            </Preview>

            <Text as="span" className="text-xs text-slate">
              {spend.unpriced} stop{spend.unpriced === 1 ? "" : "s"} with no cost yet
            </Text>
          </div>
        </div>

        <div>
          {/* Share sits with "Who is invited" because it answers the same
              question that section does — who can see this trip — and because
              the alternative homes are worse: under Budget it is a non
              sequitur, and beside Duplicate/Delete it reads as a destructive
              trip-level operation, which a read link is not. It is a *second*
              way in, not a move: the header still shows Share at >=768px.
              Below that the header's copy is hidden and this is the only one
              left, which is the whole reason it is here — Mitchell asked
              whether the header's three columns would still be reachable in
              settings if hidden, and Share was the flat NO. ShareButton was
              mounted in exactly two places (this header and the home page's
              NextTripHero), so hiding it on a phone would have left a phone
              user no way at all to share the trip they are looking at.

              This heading row was already a `justify-between` flex with one
              child — the slot the design left for a control on the right, now
              filled.

              `!readOnly`, which is this file's existing `myRole === "viewer"`
              and NOT a second rule: TripProvider derives the header's own
              `readOnly` from the identical comparison, so the gate here and
              the gate in the header cannot disagree. It also keeps ADR-031's
              /demo behaviour intact for free — `requireTripAccess` resolves a
              demo visitor as a `viewer` (server/access/trip-access.ts), so a
              signed-out reader loses Share in this sheet exactly as they
              already lose it in the header, at every width.

              Nested overlays are fine here: the Popover renders through its
              own Radix portal with `.overlay-layer` (globals.css, KI-17), the
              same z-index the Sheet carries, and being opened later it is
              appended later in <body> and paints above. The Dates row above
              is the same nesting, already proven by e2e
              (m3-place-and-time.spec.ts opens Trip settings, then Dates, then
              drives TripDateControl inside the popover). */}
          <div className="flex items-center justify-between">
            <SectionHeading>Who is invited</SectionHeading>
            {!readOnly && <ShareButton tripId={tripId} size="sm" />}
          </div>
          {/* Real as of M11 link 3: TravelersPanel lists the effective members
              (the log's owner plus everyone who accepted an invite), and — for
              the owner — creates, copies and revokes invite links. The
              <Preview id="trip-invites"> shell it replaces, and the mocked
              "Invite someone" button inside it, are gone.

              The `members` prop this sheet used to take went with it: the
              panel does its own /api/trips/:id/access read, because that read
              also carries names, emails and the invite list — none of which
              live on TripDetail, and none of which should (they are Identity
              and Access data — packages/contracts/src/access.ts). */}
          <TravelersPanel tripId={tripId} />
        </div>

        {/* The visible half of clone-with-lineage. The ancestor's name is a
            snapshot taken at fork time and stored in the genesis event, so it
            survives the original being renamed, deleted, or never having been
            readable by whoever holds this copy — which is the normal case when
            the copy came from a share link (ADR-028). It is deliberately not a
            link for the same reason: there is no guarantee this person can
            open the trip it names. */}
        {forkedFrom !== null && (
          <div>
            <SectionHeading>Where this came from</SectionHeading>
            {/* The DATE, not the ancestor's sequence number. "as it was at
                change 89" was an internal coordinate leaking onto a settings
                screen — nobody outside this codebase knows what change 89 was,
                and the person reading it wants to know when they took the copy
                (Mitchell, 2026-09-01). `atSeq` is still on `forkedFrom` and
                still what a future "show me the ancestor at that point" would
                use; it is just not something to render at a reader. */}
            <Text as="span" className="text-xs text-slate">
              Copied from &ldquo;{forkedFrom.name}&rdquo;
              {copiedOn === null ? "." : `, on ${copiedOn}.`}
            </Text>
          </div>
        )}

        <div className="flex flex-col gap-2 border-t border-hairline pt-4">
          <Button variant="secondary" disabled={busy} onClick={() => void handleDuplicate()}>
            Duplicate trip
          </Button>
          {canDelete && (
            <Button variant="destructive" disabled={busy} onClick={() => setConfirmOpen(true)}>
              Delete trip
            </Button>
          )}
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
