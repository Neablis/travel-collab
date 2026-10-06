import Link from "next/link";
import type { TripSummary } from "@tc/contracts";
import { cn } from "@/lib/cn";
import { formatTripDateWithYear } from "@/lib/formatDate";
import { viewerOwnsTrip } from "@/lib/tripRole";

// M37 D6: a trip with nothing on it gets a designed state on Home rather than
// a card that reads like a full one with the facts missing. Card and hero
// share these so the two never disagree about which trip is unplanned, what
// its meta line says, or who is nudged to invite. The drawn spec is the one
// Mitchell approves on the PR (main session, 2026-10-06).

/**
 * True for a trip with no stops on its plan. Days alone do not count: a dated
 * trip has days from the moment its dates are set, and "5 days · nothing
 * planned yet" is the state the design draws for it.
 */
export function isUnplanned(trip: TripSummary): boolean {
  return trip.stopCount === 0;
}

/** "1 day" or "N days"; null at zero, where a length would only say "0 days". */
export function tripLengthLabel(dayCount: number): string | null {
  if (dayCount <= 0) return null;
  return `${dayCount} day${dayCount === 1 ? "" : "s"}`;
}

/**
 * The card's and hero's meta line: dates, length, stops, joined with " · ".
 * Zero and unknown parts are left out; an unplanned trip says so instead of
 * a stop count, and says "No dates yet" when it has none. `dates` is the
 * caller's own date text, already formatted, or null.
 */
export function tripMetaLine(trip: TripSummary, dates: string | null): string {
  const unplanned = isUnplanned(trip);
  const parts = [
    dates ?? (unplanned ? "No dates yet" : null),
    tripLengthLabel(trip.dayCount),
    unplanned ? "nothing planned yet" : `${trip.stopCount} stop${trip.stopCount === 1 ? "" : "s"}`,
  ];
  return parts.filter((part) => part !== null).join(" · ");
}

/**
 * "Oct 30 – Nov 3, 2026" when the trip's last day is known and differs from
 * its first; null otherwise, so the caller keeps its own single-date form.
 */
export function tripDateRange(trip: TripSummary): string | null {
  if (trip.startDate === null || trip.endDate === null || trip.endDate === trip.startDate) return null;
  const [y, m, d] = trip.startDate.split("-").map(Number) as [number, number, number];
  const start = new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${start} – ${formatTripDateWithYear(trip.endDate)}`;
}

/**
 * Whether the reader owns the trip and is its only member — who the invite
 * nudge is for. The member list is what `GET /api/trips` merges with accepted
 * invites, so a pending invite does not end it: the trip is still planned alone.
 */
export function ownerAlone(trip: TripSummary, viewerId: string | null | undefined): boolean {
  return trip.members.length === 1 && viewerOwnsTrip(trip.members, viewerId);
}

/**
 * Where *Add the first day* goes: the Plan view, because a bare `/trips/<id>`
 * lands on Overview, which is read-only, and *Add a day* lives on the Board —
 * the same reason the hero's decisions link says `?view=Plan`.
 */
export function addFirstDayHref(tripId: string): string {
  return `/trips/${tripId}?view=Plan`;
}

/**
 * Where *Invite who's coming* goes: the trip, not Trip settings → People. The
 * sheet opens at People only from the header's avatar stack (`TripHeader`'s
 * `settingsAtPeople`), and no URL reaches that state yet.
 */
export function inviteHref(tripId: string): string {
  return `/trips/${tripId}`;
}

/**
 * The first step's label: *Add the first day*, or *Add the first stop* once
 * the trip has days — setting dates makes them, and a link offering a first
 * day to a trip that has five would be wrong.
 */
export function firstStepLabel(trip: TripSummary): string {
  return trip.dayCount === 0 ? "Add the first day" : "Add the first stop";
}

const ROW = "flex min-h-11 items-center gap-2 text-sm no-underline hover:underline md:min-h-9";

/**
 * An unplanned card's next steps, one row each: `firstStepLabel`, and
 * *Invite who's coming* for an owner planning alone. A trip shared with the
 * reader gets no actions, only a line saying nothing is planned — the member
 * list carries no names, so it cannot say whose trip it is without a fetch.
 */
export function UnplannedTripSteps({ trip, viewerId }: { trip: TripSummary; viewerId: string | null | undefined }) {
  if (!viewerOwnsTrip(trip.members, viewerId)) {
    return <p className="flex min-h-11 items-center text-sm text-slate md:min-h-9">Nothing planned yet.</p>;
  }
  return (
    <ul className="flex flex-col">
      <li>
        <Link href={addFirstDayHref(trip.tripId)} className={cn(ROW, "font-semibold text-brand-pressed")}>
          <span aria-hidden className="size-3 shrink-0 rounded-full border-2 border-current" />
          {firstStepLabel(trip)}
        </Link>
      </li>
      {ownerAlone(trip, viewerId) && (
        <li>
          <Link href={inviteHref(trip.tripId)} className={cn(ROW, "text-slate")}>
            <span aria-hidden className="size-3 shrink-0 rounded-full border-2 border-current" />
            Invite who&apos;s coming
          </Link>
        </li>
      )}
    </ul>
  );
}
