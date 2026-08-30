import Link from "next/link";
import type { ReactNode } from "react";
import type { TripSummary, TripStatus } from "@tc/contracts";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Heading } from "@/components/ui/heading";
import { DataText } from "@/components/ui/data-text";
import { dayAccents, type AccentFamily } from "@/lib/dayAccent";
import { initialsFor } from "@/lib/initials";
import { cn } from "@/lib/cn";

export type TripCardProps = {
  trip: TripSummary;
  // The Duplicate/Delete Popover menu, fully built and owned by the caller
  // (page.tsx keeps every bit of open/duplicate/delete state and their
  // handlers unchanged) — this component only renders whatever slot it's
  // given, so behavior is identical to the pre-restyle row.
  menuSlot?: ReactNode;
  // Already-formatted "{planned} planned of {budget}" (or "No budget yet")
  // line. TripSummary — all this card ever gets — carries no cost fields at
  // all, so TripCard cannot derive this itself: the caller is page.tsx,
  // which fetches each visible trip's own TripDetail and computes the same
  // line NextTripHero computes for its single trip, via the shared
  // plannedOfBudgetLine helper (lib/cost.ts). An absent prop renders nothing
  // rather than a fabricated line (Task 4.1, M10 Phase 4).
  plannedOfBudget?: string;
};

// Same static-map pattern as Sparkline.tsx's BAR_BG / badge.tsx's variant
// map: Tailwind's JIT scanner can't see a template-interpolated `bg-${x}`.
const ACCENT_BAR_BG: Record<AccentFamily, string> = {
  brand: "bg-brand",
  info: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  neutral: "bg-slate",
};

const STATUS_BADGE_VARIANT: Record<TripStatus, "success" | "neutral"> = {
  active: "success",
  deleted: "neutral",
};

function statusLabel(status: TripStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

// README §1 "All trips" grid: each Card gets a 46x6px accent bar. dayAccents
// was built to key off a day's city (Task 2), but TripSummary — all this grid
// ever fetches — has no city field (that's TripDetail-only, and fetching
// TripDetail per card would turn one list request into an N+1 fan-out, a
// bigger behavioral change than a restyle warrants). Keyed off tripId instead:
// still a real, stable identity per trip, so the same trip always gets the
// same accent across renders/reloads, just not a per-city one. This card
// colors independently of any other card in the grid (Task 8.2, Group B), so
// it resolves as a single-element dayAccents() call rather than batching
// against the rest of the list.
export function TripCard({ trip, menuSlot, plannedOfBudget }: TripCardProps) {
  const accent = dayAccents([trip.tripId])[0]!;

  // TripSummary carries no start date, length, or cost (those live on
  // TripDetail) — the one date-shaped field it does have is createdAt, an
  // ISO instant. formatTripDate/-Long (lib/formatDate.ts) parse calendar
  // dates (YYYY-MM-DD) and would mis-parse an instant string, so this
  // mirrors NextTripHero's own createdAt formatting (Task 6) rather than
  // misusing that helper.
  const created = new Date(trip.createdAt);
  const createdLabel = Number.isNaN(created.getTime())
    ? null
    : created.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  return (
    // data-testid: the card is the anchor for its own actions menu, and the
    // cost line below lands asynchronously (page.tsx's per-card TripDetail
    // fan-out). KI-28 needs a way to wait for *this* card to stop growing
    // before opening that menu, and the trigger's aria-label alone gives no
    // handle on the row it belongs to.
    <Card data-testid="trip-card" className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div
          data-testid="accent-bar"
          aria-hidden
          className={cn("h-1.5 rounded-full", ACCENT_BAR_BG[accent.solid])}
          // eslint-disable-next-line no-restricted-syntax -- 46px accent bar width has no token equivalent, matching TimelineLens/MapLens/ActivityCard's computed-geometry pattern
          style={{ width: "46px" }}
        />
        {menuSlot}
      </div>

      <div>
        <Link href={`/trips/${trip.tripId}`} className="hover:underline">
          <Heading level={3}>{trip.name}</Heading>
        </Link>
        {createdLabel && (
          <div className="mt-1">
            <DataText size="sm">Created {createdLabel}</DataText>
          </div>
        )}
        {/* KI-28: the slot is reserved (mt-1 + min-h-5, exactly one text-sm
            line; leading-5 pins the FILLED line box to that same 20px, which
            takes the residual difference between the two states from ~0.3px
            to ~0.2px) whether or not the line has landed, so a card NEVER
            changes height when its caller's TripDetail fetch resolves. The card is the
            anchor for its own actions menu, and Radix positions that menu with
            `strategy: "fixed"` + `shift({ limiter: limitShift() })` — an open
            menu follows its anchor instead of repositioning, so every pixel a
            row (or a row above it) grows underneath an open menu moves the
            menu's items out from under the pointer. Measured before this:
            24px per card, and up to 75px of cumulative drift at the menu,
            enough to land the point aimed at "Delete" on "Duplicate" instead.
            Reserving the space removes the cause rather than reacting to it
            (candidate (b) in KI-28). Still honest absence, not a fabricated
            line: an unresolved or failed fetch renders empty space, never a
            number.

            KI-56: one reserved line holds only while the string FITS on one
            line, and below ~380px it does not. `plannedOfBudgetLine` emits
            "{planned} planned of {budget}" — two money figures and four words
            — and the slot narrows with the card. Measured in a production
            build at 13px IBM Plex Mono (what DataText size="sm" resolves to),
            as slot height per slot WIDTH; 20px = one line, 40px = two:

              slot width                            180 222 246 260 277 301+
              "$9,085.00 planned of $16,400.00"      40  40  20  20  20  20
              "¥1,234,567 planned of ¥5,000,000"     40  40  40  20  20  20
              "¥12,345,678 planned of ¥50,000,000"   40  40  40  40  20  20

            So a plain USD figure already wraps at a 320px viewport — the hero
            was measured growing 20px there with its real seeded line, no
            exotic currency needed — and a large JPY figure wraps up to a
            ~375px viewport. Two lines are reserved below `sm`, not one.
            Nothing reaches THREE lines: the widest string above still renders
            two at a 180px slot, narrower than any reachable card, so
            `min-h-10` bounds the slot at every real width rather than only at
            the ones measured.

            This is candidate (2) from the KI entry, and its cost is the one
            the entry names: below `sm` the slot keeps 20px of blank space
            even when the line is short or absent. That is the deliberate
            trade. `truncate` (candidate 1) would render "planned of ¥5,00…",
            hiding the budget on the screens with least room to recover it;
            shortening the string (candidate 3) is a `lib/cost.ts` change and
            a product-visible choice about how money reads. Both change what
            the user can see; a fixed height does not.

            The breakpoint is `md` (768px), NOT `sm`, and that is the one
            genuinely counter-intuitive thing here. A card's slot does not
            widen monotonically with the viewport, because this grid is
            `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` — every column-count
            increase makes each card NARROWER again. Measured slot widths:

              viewport   341  500  640  1024  1440
              slot        246  426  263   290   322
                                    ^ sm: 2 columns
                                          ^ lg: 3 columns

            So the slot is narrower at 640px (263) than at 500px (426), and
            263 is below the 277 the widest figure needs — reserving one line
            at `sm` reintroduced exactly this defect in a ~640-670px band, the
            first measurement of the fix caught it, and `md` is what closes
            it: by 768px the two-column slot is back above 277, and the `lg`
            three-column minimum (290 at 1024) clears it too.

            NextTripHero takes the same reservation at `sm` rather than `md`
            because its own slot IS monotonic below `lg` — 402px already at a
            500px viewport, 542px at 640px — so it has no such band. */}
        <div className="mt-1 min-h-10 leading-5 md:min-h-5">
          {plannedOfBudget && <DataText size="sm">{plannedOfBudget}</DataText>}
        </div>
      </div>

      <div className="mt-auto flex items-center justify-between pt-1">
        <div
          className="flex flex-wrap items-center"
          role="group"
          aria-label={`${trip.members.length} traveler${trip.members.length === 1 ? "" : "s"}`}
        >
          {trip.members.map((member, i) => (
            <div
              key={member.userId}
              aria-hidden
              className={cn(
                "grid size-6 place-items-center rounded-full border-2 border-surface bg-brand-tint font-semibold text-brand-pressed",
                i > 0 && "-ml-2",
              )}
              // eslint-disable-next-line no-restricted-syntax -- 9px initials text has no token equivalent (below text-xs/12px), matching TimelineLens/MapLens/ActivityCard's computed-geometry pattern
              style={{ fontSize: "9px" }}
            >
              {initialsFor(member.userId)}
            </div>
          ))}
        </div>
        <Badge variant={STATUS_BADGE_VARIANT[trip.status]}>{statusLabel(trip.status)}</Badge>
      </div>
    </Card>
  );
}
