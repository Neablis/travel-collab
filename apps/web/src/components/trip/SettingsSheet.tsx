"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Money, TripCommand, TripMember } from "@tc/contracts";
import { Sheet } from "@/components/ui/sheet";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { DataText } from "@/components/ui/data-text";
import { Badge } from "@/components/ui/badge";
import { BudgetMeter } from "@/components/ui/budget-meter";
import { Banner } from "@/components/ui/banner";
import { Preview } from "@/components/ui/preview";
import { Popover } from "@/components/ui/popover";
import { TripMoneySettings } from "@/components/board/TripMoneySettings";
import { TripDateControl } from "@/components/lenses/TripDateControl";
import { formatTripDate } from "@/lib/formatDate";
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
  currency,
  budget,
  spend,
  members,
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
  spend: TripSpend;
  members: TripMember[];
  onCommand: (command: TripCommand) => void;
  // The outcome is forwarded alongside the {tripId, name} summary so the
  // caller (TripHeader) can call TripProvider's applyOutcome with it —
  // mirroring the RestoreTrip/undo path — and reconcile trip.status to
  // "deleted" immediately, rather than leaving the board's local state
  // (and thus its full interactivity) stale for the whole toast window.
  onDeleted: (trip: { tripId: string; name: string }, outcome: CommandOutcome) => void;
}) {
  const router = useRouter();
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
              onCommand({ type: "SetTripName", tripId, name });
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
              onCommand(command);
              setDatesOpen(false);
            }}
            onClose={() => setDatesOpen(false)}
          />
        </Popover>

        <div>
          <SectionHeading>Budget</SectionHeading>
          <TripMoneySettings tripId={tripId} currency={currency} budget={budget} onCommand={onCommand} />

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
          <div className="flex items-center justify-between">
            <SectionHeading>Who is invited</SectionHeading>
          </div>
          <div className="flex items-start justify-between gap-3">
            {/* Real: every member's actual userId, listed outside the
                Preview below. */}
            <div className="flex flex-col gap-1.5">
              {members.map((member) => (
                <Text key={member.userId} as="span" className="text-xs text-ink">
                  {member.userId}
                </Text>
              ))}
            </div>
            {/* Unbacked (M13 — TripMember.role is literal "owner", and there
                is no invite flow yet): the roles column and the "Invite
                someone" action are both mocked/disabled together. */}
            <Preview id="trip-invites" size="container" className="flex items-center gap-3">
              <div className="flex flex-col gap-1.5">
                {members.map((member) => (
                  <Badge key={member.userId} variant="neutral">
                    {member.role}
                  </Badge>
                ))}
              </div>
              <Button variant="secondary" size="sm">
                Invite someone
              </Button>
            </Preview>
          </div>
        </div>

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
