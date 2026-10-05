"use client";

import { Fragment, useState } from "react";
import type { Money, TripAccess, TripCommand, TripDetail } from "@tc/contracts";
import { Sheet } from "@/components/ui/sheet";
import { Button, buttonVariants } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { DataText } from "@/components/ui/data-text";
import { BudgetMeter } from "@/components/ui/budget-meter";
import { Banner } from "@/components/ui/banner";
import { Popover } from "@/components/ui/popover";
import { PeopleSection } from "@/components/trip/people/PeopleSection";
import { ShareButton } from "@/components/trip/ShareButton";
import type { TripCounts } from "@/components/trip/TripMetaPill";
import { TripMoneySettings } from "@/components/board/TripMoneySettings";
import { TripDateControl } from "@/components/lenses/TripDateControl";
import { formatInstantLong, formatTripDate } from "@/lib/formatDate";
import { isDemoTripId } from "@/lib/demoTrip";
import { formatMoney } from "@/lib/formatMoney";
import { committedLine, type TripSpend } from "@/lib/cost";

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <Text as="span" className="mb-2.5 block text-xs font-semibold uppercase tracking-wider text-slate">
      {children}
    </Text>
  );
}

// A callback ref rather than an effect on `open`: Radix mounts the sheet's
// content a render after `open` turns true, so an effect would find no anchor.
// Optional-called because jsdom has no `scrollIntoView`.
function scrollIntoView(el: HTMLElement | null) {
  el?.scrollIntoView?.({ block: "start" });
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
  counts,
  currency,
  budget,
  spend,
  forkedFrom,
  createdAt,
  readOnly,
  canEditBoard,
  onInvitesChanged,
  access,
  onAccessChanged,
  scrollToPeople = false,
  onCommand,
}: {
  tripId: string;
  tripName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  startDate: string | null;
  endDate: string | null;
  // Days, stops and cities, from `tripCounts`, the one function that derives
  // them (TripMetaPill.tsx). The pill itself states only the dates since SPEC
  // §35.3, so this is now the one place they are shown. They came here
  // because that pill is hidden below 768px: Mitchell asked whether
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
  // TripProvider's `readOnly`, passed down by TripHeader: true for a viewer
  // and a suggester (W8, default closed), false while the role is unknown
  // (W21). ADVISORY: the server refuses every write a role does not permit
  // regardless; this is so the sheet does not OFFER one. Taken from the
  // provider rather than recomputed from the role (review of #309), so the
  // sheet and the header are one rule and cannot disagree.
  readOnly: boolean;
  // TripProvider's `canEditBoard`, from the same place for the same reason:
  // the trip fields — name, dates, currency, budget — opt in to suggest mode
  // (W8), so a suggester's change joins their draft. Share does not.
  canEditBoard: boolean;
  // TripProvider's `noteInvites`, handed to the People section (W73).
  onInvitesChanged?: (pending: boolean) => void;
  // TripProvider's `access`, re-read when the poll's `accessRev` moves, for
  // the People section to adopt while it is open (KI-2026-10-04-b).
  access?: TripAccess | null;
  // A member write moved who is on the trip or who travels, and with it the
  // trip's per-person totals: TripProvider's `refreshAccess` (W15).
  onAccessChanged?: () => void;
  // Opened from the header's avatar stack (D10): land on People, not on the
  // sheet's top.
  scrollToPeople?: boolean;
  onCommand: (command: TripCommand) => void;
}) {
  // Dispatch is severed at the SOURCE, not at each control. The individual
  // controls are disabled below so a viewer is not offered something that
  // silently does nothing — but a future control added to this sheet would
  // otherwise leak a command past that per-control gating, and this is the
  // one line that cannot be forgotten (CodeRabbit, PR #70, on the same class
  // as the delete handler). The server refuses these regardless; this is
  // about not offering them.
  const dispatch = canEditBoard ? onCommand : () => undefined;
  const [datesOpen, setDatesOpen] = useState(false);

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
  // Committed vs estimate is the stop's kind (ADR-060 decision 5): only a
  // total with a pending stop's guess in it earns the line.
  const split = committedLine(spend, currency);

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
            disabled={!canEditBoard}
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
              disabled={!canEditBoard}
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

            The strings are the ones the pill used to carry ("3 days",
            "12 stops", "2 cities"). Since SPEC §35.3 the pill shows only
            the dates at every width, so this section is where the counts
            live, not a phone-only mirror of them. */}
        <div>
          <SectionHeading>Trip overview</SectionHeading>
          {/* A dot between the three (Mitchell, PR #269 preview: "Can there be
              a more distinct seperator between 14 days, 69 stops, x cities?").
              A 16px gap alone read as one run of numbers. The dot is the
              separator the rest of the app already uses between facts on
              one line, and it is `aria-hidden` so a screen reader hears the
              three figures, not the punctuation. */}
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1" data-testid="trip-overview-counts">
            {[`${counts.days} days`, `${counts.stops} stops`, `${counts.cities} cities`].map((fact, i) => (
              <Fragment key={fact}>
                {i > 0 && (
                  <span aria-hidden className="text-slate">
                    ·
                  </span>
                )}
                <DataText size="sm">{fact}</DataText>
              </Fragment>
            ))}
          </div>
        </div>

        <div>
          <SectionHeading>Budget</SectionHeading>
          <TripMoneySettings
            tripId={tripId}
            currency={currency}
            budget={budget}
            disabled={!canEditBoard}
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

            {/* The mocked breakdown by kind that sat here (`budget-breakdown`,
                M19) is gone: Mitchell, 2026-09-26, *"Lets remove it there, and
                implement it as a PIE chart widget for notebooks"* — it is the
                "Spend by kind" widget (`cost.breakdown`) now, on real kinds. */}
            {split !== null && (
              <Text as="span" className="text-xs text-slate" data-testid="budget-committed">
                {split}
              </Text>
            )}
            <Text as="span" className="text-xs text-slate">
              {spend.unpriced} stop{spend.unpriced === 1 ? "" : "s"} with no cost yet
            </Text>
          </div>
        </div>

        {/* **People** (travellers spec §4), its own section with its own
            heading — which `PeopleSection` draws, because the count in it is
            that section's to know. `id="people"` is the anchor the trip
            header's avatar stack opens this sheet at (D10); `scroll-mt-4`
            keeps the heading off the sheet's top edge when it lands there.

            The section does its own `/api/trips/:id/access` read, because
            that read carries names, emails and the invite list — none of
            which live on TripDetail, and none of which should (they are
            Identity and Access data — packages/contracts/src/access.ts). */}
        <div id="people" ref={scrollToPeople ? scrollIntoView : undefined} className="scroll-mt-4">
          <PeopleSection
            tripId={tripId}
            access={access}
            onInvitesChanged={onInvitesChanged}
            onAccessChanged={onAccessChanged}
          />
        </div>

        {/* **Read-only snapshots, under People and apart from it** (spec §4).
            Share used to sit inside "Who is invited", under the invite form
            (Mitchell, 2026-09-06: *"Put share in the trip settings under
            invite someone, both here and in mobile"*) — the same question at
            a different strength. With inviting moved into People's own
            dialog, a second list of copyable links in the same section read
            as more invites, so it gets a heading and one line on how the two
            differ. It is still the only Share for the trip at every width.

            `!readOnly` is TripProvider's own `readOnly` handed down by the
            header, so the gate here and in the header are one value. It also
            keeps ADR-031's /demo behaviour: a demo visitor resolves as a
            `viewer`, so they lose Share here as everywhere. The heading goes
            with it — a heading over nothing is a promise of a control. */}
        {!readOnly && (
          <div>
            <SectionHeading>Read-only snapshots</SectionHeading>
            <Text as="span" variant="muted" className="mb-2 block">
              A snapshot is the plan as it is now, for anyone with the link to read. Unlike an invite, it adds nobody
              to the trip.
            </Text>
            <ShareButton tripId={tripId} size="sm" />
          </div>
        )}

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
          {/* **One button, no prose** — Mitchell, Vercel Toolbar comment on the
              PR #196 preview, 2026-09-20: *"in trip settings, drop all the
              extra text for download a trip, and just have button at bottom
              that says 'Download Trip'"*.

              **This reverses link 6d, which is his call to make and is recorded
              rather than quietly applied.** 6d gave Download a `Take it with
              you` heading and a sentence — *"A download carries the plan — your
              days and activities. Its history does not travel: an imported trip
              starts fresh, with no undo, redo or revert."* — on the reasoning
              that the fact was real and buried in a comment
              (`bundle/fromTrip.ts`) where only the next developer would read
              it. The fact is still true and still only in that comment.
              Flagged to him on the thread; if it should come back it wants a
              place that is not three lines above the button, and that is a
              design question rather than a revert.

              Duplicate and Delete are still not here (link 6a, DRIFT D13, SPEC
              §34.2 and §27) — see the note below. */}
          {/* **A plain anchor, which is the whole of link 2** (M25).
              `GET /api/v1/trips/{tripId}/export` is the same endpoint an API
              caller uses, and a session cookie satisfies every scope on a `v1`
              route (`public-api/actor.ts`) — so the browser needs no token, no
              `apiClient` helper, no MSW handler and no second route. The server
              sets `Content-Disposition: attachment`, so the navigation is a
              download rather than a page.

              **Free to every plan, and there is nothing here enforcing that.**
              The absence IS the feature: no entitlement check exists anywhere
              on this path, because `api.tokens` gates minting and verifying a
              TOKEN, not a session. A `free` account meets no paywall between
              this control and the file.

              Not a `Button` because it is a navigation, and a `<button>` that
              navigates is a control a reader cannot open in a new tab, copy the
              address of, or reach with their browser's own download handling.
              `buttonVariants` is how the rest of this app styles exactly that
              (`OverviewLens`, `TokensSection`).

              **Not on `/demo`** (Mitchell, 2026-10-01): "a session cookie
              satisfies every scope" is exactly why it fails there — a demo
              visitor has no session, so the link was a 401 posing as a
              download. Hidden, not disabled, like every other control the demo
              has no session for (`TripHeader`, KI-64). Decided by the trip, not
              the role: a signed-in viewer keeps it (ADR-028 decision 3). */}
          {isDemoTripId(tripId) ? null : (
            <a
              href={`/api/v1/trips/${tripId}/export`}
              download
              className={buttonVariants({ variant: "secondary" }) + " no-underline"}
            >
              Download Trip
            </a>
          )}
          {/* **Duplicate and Delete are not here** — M26 link 6a, DRIFT D13,
              SPEC §34.2 and §27. They live on the trip card's popover on Home,
              which is where they already worked, and a trip you are INSIDE is
              not where you delete it. Two homes for one verb is how the two
              drift; the design's call stands (project rule 4).

              Deleting them took the confirm dialog with them, which was
              arguing against itself: its body read *"You can undo this from
              the toast that follows"* — a modal whose own copy explains the
              action is reversible, which is the exact thing §27 gives as the
              reason not to have one. */}
        </div>
      </div>

    </Sheet>
  );
}
