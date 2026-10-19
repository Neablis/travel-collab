"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { TripDetail, TripMember, TripSummary } from "@tc/contracts";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { usePublishOfferDismissals } from "@/components/account/PreferencesProvider";
import { KeepDayDialog, keepCandidatesFor, type KeepDayCandidate } from "@/components/trip/KeepDayDialog";
import { fetchTripDetail, type ApiResult } from "@/lib/apiClient";
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
  // Set once the dismissal is saved, not on the press: a save that fails
  // leaves the offer up with its error, since it would be back on reload.
  const [dismissed, setDismissed] = useState(false);
  // Dismiss unmounts the button that has focus, which would drop it to `body`
  // and send a keyboard reader back to the top of Home. Focus moves to a note
  // in the offer's place instead, which stays, so Tab carries on from here.
  const note = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (dismissed) note.current?.focus();
  }, [dismissed]);

  if (dismissed) {
    return (
      <p ref={note} tabIndex={-1} role="status" className="text-xs text-slate">
        {`Won't offer to publish ${trip.name} again.`}
      </p>
    );
  }
  if (
    !canPublish ||
    now === null ||
    !tripHasEnded(trip, now) ||
    dismissals === null ||
    dismissals.dismissed.includes(trip.tripId)
  ) {
    return null;
  }
  return (
    <Offer
      trip={trip}
      days={days}
      onDismiss={async () => {
        const result = await dismissals.dismiss(trip.tripId);
        if (result.ok) setDismissed(true);
        return result;
      }}
      // Published, the trip is not offered again: a second yes would make a
      // second public Playbook of the same trip.
      onPublished={() => void dismissals.dismiss(trip.tripId)}
    />
  );
}

/**
 * The offer at the top of the trip page, for the trip the page has loaded. Its
 * end is its last day's date, as the summary's `endDate` is on Home.
 *
 * @param trip - The trip on the page
 * @param canPublish - Whether this reader may keep the trip's days: the board's
 *   gate for the Keep pennant, so a viewer and a suggester are not offered it
 */
export function TripPageOffer({ trip, canPublish }: { trip: TripDetail; canPublish: boolean }) {
  const days = useMemo(() => keepCandidatesFor(trip), [trip]);
  return (
    <PublishTripOffer
      trip={{ tripId: trip.tripId, name: trip.name, endDate: trip.days.at(-1)?.date ?? null }}
      canPublish={canPublish}
      days={days}
    />
  );
}

/** The visible half, apart so the router is only asked for once there is an offer. */
function Offer({
  trip,
  days,
  onDismiss,
  onPublished,
}: {
  trip: OfferTrip;
  days?: KeepDayCandidate[];
  onDismiss: () => Promise<ApiResult<unknown>>;
  onPublished: () => void;
}) {
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

  async function dismiss() {
    setError(null);
    const result = await onDismiss();
    if (!result.ok) setError(result.error.message);
  }

  return (
    <div
      role="group"
      // Named for the trip: on Home every card carries one, and a list of
      // identical "Dismiss" / "Publish" pairs says nothing about which is which.
      aria-label={`Publish ${trip.name} as a playbook`}
      className="flex flex-wrap items-center gap-2 rounded-md border border-hairline bg-paper px-3 py-2"
    >
      <Text as="span" className="mr-auto text-sm">
        Turn these days into a playbook?
      </Text>
      <Button type="button" size="sm" variant="ghost" aria-label={`Dismiss publishing ${trip.name}`} onClick={() => void dismiss()}>
        Dismiss
      </Button>
      <Button
        type="button"
        size="sm"
        variant="primary"
        aria-label={`Publish ${trip.name}`}
        disabled={busy}
        onClick={() => void start()}
      >
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
          publish={{
            onPublished: (day) => {
              onPublished();
              router.push(dayPath(day));
            },
          }}
        />
      )}
    </div>
  );
}
