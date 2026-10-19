"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { TripMember, TripSummary } from "@tc/contracts";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { usePublishOfferDismissals } from "@/components/account/PreferencesProvider";
import { KeepDayDialog, keepCandidatesFor, type KeepDayCandidate } from "@/components/trip/KeepDayDialog";
import { fetchTripDetail } from "@/lib/apiClient";
import { tripHasEnded } from "@/lib/homeTripOrder";
import { dayPath } from "@/lib/playbookUrls";
import { cachedRead } from "@/lib/queryCache";
import { tripKeys } from "@/lib/queryKeys";
import { boardMode } from "@/lib/tripRole";

type OfferTrip = Pick<TripSummary, "tripId" | "name" | "endDate">;

/**
 * Whether Home may offer this reader the trip's days: the board's own gate for
 * the Keep pennant (`Board` hides it for a viewer and a suggester), read off
 * the list's members. Display only; the keep and the publish are the server's
 * to refuse.
 */
export function viewerKeepsDays(members: readonly TripMember[], viewerId: string | null | undefined): boolean {
  if (viewerId === null || viewerId === undefined) return false;
  return boardMode(members.find((m) => m.userId === viewerId)?.role) === "write";
}

/**
 * *"Turn these days into a playbook?"* — M50 decision 7, on Home's card and
 * at the top of the trip page once the trip is over.
 *
 * Nothing renders until three things are known: today (read in an effect, as
 * `NextTripHero`'s countdown does, so the server pass and hydration agree), the
 * trip being over, and this person's dismissals. Unknown dismissals hide it,
 * because offering again what someone already said no to is the worse error.
 *
 * @param trip - The trip, as much of it as the offer reads
 * @param canPublish - Whether this reader may keep the trip's days
 * @param days - The trip's days, when the caller has them; otherwise they are
 *   read when Publish is pressed
 */
export function PublishTripOffer({
  trip,
  canPublish,
  days,
}: {
  trip: OfferTrip;
  canPublish: boolean;
  days?: KeepDayCandidate[];
}) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
  }, []);
  const dismissals = usePublishOfferDismissals();
  // Hidden at once on Dismiss; the stored list catches up when the save lands.
  const [dismissedHere, setDismissedHere] = useState(false);

  if (
    !canPublish ||
    now === null ||
    !tripHasEnded(trip, now) ||
    dismissals === null ||
    dismissedHere ||
    dismissals.dismissed.includes(trip.tripId)
  ) {
    return null;
  }
  return (
    <Offer
      trip={trip}
      days={days}
      onDismiss={() => {
        setDismissedHere(true);
        dismissals.dismiss(trip.tripId);
      }}
    />
  );
}

/** The visible half, apart so the router is only asked for once there is an offer. */
function Offer({ trip, days, onDismiss }: { trip: OfferTrip; days?: KeepDayCandidate[]; onDismiss: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [read, setRead] = useState<KeepDayCandidate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const candidates = days ?? read;

  async function start() {
    if (candidates !== null) {
      setOpen(true);
      return;
    }
    // Home has the trip's summary, not its days: the same cached read the hero
    // makes, so a hero that already drew its sparkline costs nothing here.
    setBusy(true);
    setError(null);
    const result = await cachedRead(tripKeys.detail(trip.tripId), () => fetchTripDetail(trip.tripId));
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setRead(keepCandidatesFor(result.value));
    setOpen(true);
  }

  return (
    <div
      role="group"
      aria-label="Publish this trip"
      className="flex flex-wrap items-center gap-2 rounded-md border border-hairline bg-paper px-3 py-2"
    >
      <Text as="span" className="mr-auto text-sm">
        Turn these days into a playbook?
      </Text>
      <Button type="button" size="sm" variant="ghost" onClick={onDismiss}>
        Dismiss
      </Button>
      <Button type="button" size="sm" variant="primary" disabled={busy} onClick={() => void start()}>
        Publish
      </Button>
      {error !== null && (
        <Text as="span" role="alert" className="w-full text-xs text-danger-ink">
          {error}
        </Text>
      )}
      {candidates !== null && candidates.length > 0 && (
        <KeepDayDialog
          open={open}
          onOpenChange={setOpen}
          tripId={trip.tripId}
          dayId={candidates[0]!.dayId}
          tripName={trip.name}
          days={candidates}
          publish={{ onPublished: (day) => router.push(dayPath(day)) }}
        />
      )}
    </div>
  );
}
