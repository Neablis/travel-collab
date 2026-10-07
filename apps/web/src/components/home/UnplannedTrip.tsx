import Link from "next/link";
import type { TripSummary } from "@tc/contracts";
import { cn } from "@/lib/cn";
import { formatTripDateWithYear } from "@/lib/formatDate";
import { boardMode, viewerOwnsTrip } from "@/lib/tripRole";
import { tripSettingsHref } from "@/lib/tripSettingsLink";

// M37 D6: a trip with nothing on it gets a designed state on Home rather than
// a card that reads like a full one with the facts missing. Card and hero
// share these so the two never disagree about which trip is unplanned, what
// its meta line says, or who is nudged to invite. The drawn spec is the one
// Mitchell approves on the PR (main session, 2026-10-06).

/**
 * True for a trip with nothing on it: no stops on a day and no ideas in the
 * backlog. Days alone do not count: a dated trip has days from the moment its
 * dates are set, and "5 days · nothing planned yet" is the state the design
 * draws for it. Ideas do count — the trip header's *Add stop* puts its stop in
 * the backlog, so a trip built that way is started, not blank (PR #351 review).
 */
export function isUnplanned(trip: TripSummary): boolean {
  return trip.stopCount === 0 && trip.ideaCount === 0;
}

/** "1 idea" or "N ideas": `noun` with an "s" unless `n` is one. */
function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** "1 day" or "N days"; null at zero, where a length would only say "0 days". */
export function tripLengthLabel(dayCount: number): string | null {
  if (dayCount <= 0) return null;
  return plural(dayCount, "day");
}

/**
 * What is on the trip, for the meta line: "N stops"; "N ideas, none on a day
 * yet" when everything is still in the backlog; "nothing planned yet" when
 * there is neither.
 */
function planLabel(trip: TripSummary): string {
  if (trip.stopCount > 0) return plural(trip.stopCount, "stop");
  if (trip.ideaCount > 0) return `${plural(trip.ideaCount, "idea")}, none on a day yet`;
  return "nothing planned yet";
}

/**
 * The card's and hero's meta line: dates, length, what is planned, joined with
 * " · ". Zero and unknown parts are left out; an unplanned trip says "No dates
 * yet" when it has none. `dates` is the caller's own date text, already
 * formatted, or null.
 */
export function tripMetaLine(trip: TripSummary, dates: string | null): string {
  const parts = [dates ?? (isUnplanned(trip) ? "No dates yet" : null), tripLengthLabel(trip.dayCount), planLabel(trip)];
  return parts.filter((part) => part !== null).join(" · ");
}

/**
 * "Oct 30 – Nov 3, 2026" when the trip's last day is known and differs from
 * its first, and "Dec 28, 2026 – Jan 3, 2027" when the two fall in different
 * years; null otherwise, so the caller keeps its own single-date form.
 */
export function tripDateRange(trip: TripSummary): string | null {
  if (trip.startDate === null || trip.endDate === null || trip.endDate === trip.startDate) return null;
  const [y, m, d] = trip.startDate.split("-").map(Number) as [number, number, number];
  const sameYear = trip.endDate.startsWith(`${trip.startDate.slice(0, 4)}-`);
  const start = sameYear
    ? new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : formatTripDateWithYear(trip.startDate);
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

/** Where *Invite who's coming* goes: the trip, with Trip settings open at People. */
export function inviteHref(tripId: string): string {
  return tripSettingsHref(tripId, "people");
}

/** Where *Choose a cover photo* goes: the trip, with Trip settings open at Cover photo. */
export function coverHref(tripId: string): string {
  return tripSettingsHref(tripId, "cover");
}

/**
 * Whether *Choose a cover photo* is offered: to a reader who may set one (an
 * owner or an editor — the cover routes' line), on a trip that has none yet.
 * Display only; the route decides.
 */
export function offersCover(trip: TripSummary, viewerId: string | null | undefined): boolean {
  if (trip.cover !== null || !viewerId) return false;
  return boardMode(trip.members.find((m) => m.userId === viewerId)?.role) === "write";
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
 * *Invite who's coming* for an owner planning alone, then *Choose a cover
 * photo* for anyone who may set one (`offersCover`). A trip shared with the
 * reader gets no planning actions, only a line saying nothing is planned —
 * the member list carries no names, so it cannot say whose trip it is without
 * a fetch — and, for an editor, the cover. While the reader is unknown
 * (`viewerId` undefined) it renders the owner-alone rows hidden, holding their
 * height; see the note inside.
 */
export function UnplannedTripSteps({
  trip,
  viewerId,
  describedBy,
}: {
  trip: TripSummary;
  viewerId: string | null | undefined;
  /**
   * The id of the trip's title. Every unplanned card offers the same links,
   * so each is described by its trip's name — the name itself stays the
   * visible text alone, which is what a voice user says and a locator matches.
   */
  describedBy?: string;
}) {
  // `undefined` is the session probe still in flight. Rendering the reader's
  // one line until it answered made the commonest card — a new trip, its owner
  // planning alone — grow a row when the answer landed, and push every card
  // below it. So the slot holds the owner-alone rows instead, invisible and
  // out of the accessibility tree and tab order: that answer lands in place.
  // An owner may always set a cover, so the held rows include it when the trip
  // has none. A reader, or an owner with company, still gives a row back when
  // it resolves — a shrink, the less common case, not hidden from anyone.
  if (viewerId === undefined) {
    return (
      <div aria-hidden inert className="invisible">
        <Steps trip={trip} invite cover={trip.cover === null} describedBy={describedBy} />
      </div>
    );
  }
  const cover = offersCover(trip, viewerId);
  if (!viewerOwnsTrip(trip.members, viewerId)) {
    return (
      <>
        <p className="flex min-h-11 items-center text-sm text-slate md:min-h-9">Nothing planned yet.</p>
        {cover && (
          <ul className="flex flex-col">
            <CoverStep trip={trip} describedBy={describedBy} />
          </ul>
        )}
      </>
    );
  }
  return <Steps trip={trip} invite={ownerAlone(trip, viewerId)} cover={cover} describedBy={describedBy} />;
}

/** The owner's next-step rows: the first step, the invite when `invite`, the cover when `cover`. */
function Steps({
  trip,
  invite,
  cover,
  describedBy,
}: {
  trip: TripSummary;
  invite: boolean;
  cover: boolean;
  describedBy?: string;
}) {
  return (
    <ul className="flex flex-col">
      <li>
        <Link
          href={addFirstDayHref(trip.tripId)}
          aria-describedby={describedBy}
          className={cn(ROW, "font-semibold text-brand-pressed")}
        >
          <span aria-hidden className="size-3 shrink-0 rounded-full border-2 border-current" />
          {firstStepLabel(trip)}
        </Link>
      </li>
      {invite && (
        <li>
          <Link href={inviteHref(trip.tripId)} aria-describedby={describedBy} className={cn(ROW, "text-slate")}>
            <span aria-hidden className="size-3 shrink-0 rounded-full border-2 border-current" />
            Invite who&apos;s coming
          </Link>
        </li>
      )}
      {cover && <CoverStep trip={trip} describedBy={describedBy} />}
    </ul>
  );
}

/** The *Choose a cover photo* row. */
function CoverStep({ trip, describedBy }: { trip: TripSummary; describedBy?: string }) {
  return (
    <li>
      <Link href={coverHref(trip.tripId)} aria-describedby={describedBy} className={cn(ROW, "text-slate")}>
        <span aria-hidden className="size-3 shrink-0 rounded-sm border-2 border-current" />
        Choose a cover photo
      </Link>
    </li>
  );
}
