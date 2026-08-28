"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { SharedTripView } from "@tc/contracts";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataText } from "@/components/ui/data-text";
import { Heading } from "@/components/ui/heading";
import { Text } from "@/components/ui/text";
import { FrontDoorHeader } from "@/components/front/FrontDoorHeader";
import { formatMoney } from "@/components/lenses/formatMoney";
import { formatTripDate } from "@/lib/formatDate";
import { toClockRange } from "@/lib/time";
import { cloneSharedTrip, fetchSharedTrip } from "@/lib/apiClient";
import { cn } from "@/lib/cn";

// The read side of M11 link 4. Read-only by construction rather than by
// disabling things: there is no dispatch, no TripProvider and no command
// client anywhere in this subtree, so a control that mutates the trip cannot
// be added here by accident.

function dayLabel(index: number, date: string | null): string {
  return date === null ? `Day ${index + 1}` : `Day ${index + 1} · ${formatTripDate(date)}`;
}

function timeLabel(window: SharedTripView["activities"][string]["timeWindow"]): string | null {
  return window === null ? null : toClockRange(window.start, window.end);
}

export function SharedTripScreen({ token }: { token: string }) {
  const router = useRouter();
  const [trip, setTrip] = useState<SharedTripView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cloneError, setCloneError] = useState<string | null>(null);
  const [cloning, setCloning] = useState(false);

  // M11's third user story: "Clone a trip someone shared with me into my own,
  // where it is editable because it is now mine." What gets copied is the
  // PINNED state — what this page is showing — not whatever the source has
  // become since (ADR-028).
  //
  // The page itself is public, so the button is offered to everyone and a
  // signed-out visitor is sent to sign in and brought straight back here,
  // reusing the same `callbackUrl` machinery M15 built. Hiding the button
  // until you sign in would mean the one thing this page is for is invisible
  // to exactly the people it is trying to win over.
  async function clone() {
    setCloning(true);
    setCloneError(null);
    const result = await cloneSharedTrip(token);
    // Released only on the paths that STAY on this page. `router.push` does
    // not unmount synchronously, so clearing it before navigating re-enables
    // the button while the shared page is still on screen — and a second
    // click there is a second trip in the visitor's list, not a no-op
    // (CodeRabbit, PR #71).
    if (result.ok) {
      router.push(`/trips/${result.value.tripId}`);
      return;
    }
    if (result.error.status === 401) {
      router.push(`/signin?callbackUrl=${encodeURIComponent(`/s/${token}`)}`);
      return;
    }
    setCloning(false);
    setCloneError(result.error.message);
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await fetchSharedTrip(token);
      if (cancelled) return;
      if (result.ok) setTrip(result.value);
      else setError(result.error.message);
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (error !== null) {
    return (
      <div className="min-h-screen bg-canvas">
        <FrontDoorHeader />
        <div className="mx-auto flex w-full max-w-155 flex-col gap-4 px-7 pt-14">
          <Heading level={1}>Nothing to see here</Heading>
          <Text variant="secondary">{error}</Text>
          <div>
            <Link href="/signup" className={cn(buttonVariants({ variant: "primary" }), "no-underline")}>
              Start a trip
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (trip === null) {
    return (
      <div className="min-h-screen bg-canvas">
        <FrontDoorHeader />
        <div className="mx-auto w-full max-w-155 px-7 pt-14">
          <Text variant="secondary">Opening this trip…</Text>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-canvas">
      <FrontDoorHeader
        actions={
          <Link href="/signup" className={cn(buttonVariants({ variant: "primary" }), "no-underline")}>
            Plan your own
          </Link>
        }
      />
      <main className="mx-auto flex w-full max-w-285 flex-col gap-5 px-7 pt-8 pb-16">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div className="flex flex-wrap items-baseline gap-3">
            <Heading level={1}>{trip.name}</Heading>
            <Badge variant="neutral">Read only</Badge>
          </div>
          <Button variant="secondary" disabled={cloning} onClick={() => void clone()}>
            Make this my trip
          </Button>
        </div>

        {cloneError !== null && (
          <Text as="span" className="text-xs text-danger-ink">
            {cloneError}
          </Text>
        )}

        <div className="flex flex-wrap items-center gap-4">
          <Text as="span" variant="secondary">
            {trip.days.length} day{trip.days.length === 1 ? "" : "s"}
          </Text>
          <Text as="span" variant="secondary">
            {trip.travellerCount} traveller{trip.travellerCount === 1 ? "" : "s"}
          </Text>
          {trip.tripCostTotal > 0 && (
            <DataText size="sm">{formatMoney(trip.tripCostTotal, trip.currency)}</DataText>
          )}
        </div>

        {/* The whole point of the feature, said out loud. A pinned link keeps
            showing what was shared, so a reader who is also a traveller needs
            to know when that is no longer the current plan. */}
        <Banner variant="info">
          {trip.stale
            ? `Shared on ${formatTripDate(trip.sharedAt.slice(0, 10))} — this is the plan as it was then. It has changed since.`
            : `Shared on ${formatTripDate(trip.sharedAt.slice(0, 10))} — this is the plan as it was then.`}
        </Banner>

        <div className="flex flex-col gap-3">
          {trip.days.map((day, index) => (
            <Card key={day.dayId} className="flex flex-col gap-2.5 p-4">
              <div className="flex items-baseline justify-between gap-3">
                <Text as="span" className="font-display text-md font-semibold text-ink">
                  {dayLabel(index, day.date)}
                </Text>
                {day.costSubtotal > 0 && (
                  <DataText size="sm">{formatMoney(day.costSubtotal, trip.currency)}</DataText>
                )}
              </div>
              {day.activityIds.length === 0 ? (
                <Text as="span" variant="muted">
                  Nothing planned.
                </Text>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {day.activityIds.map((activityId) => {
                    const activity = trip.activities[activityId];
                    if (activity === undefined) return null;
                    const time = timeLabel(activity.timeWindow);
                    return (
                      <li key={activityId} className="flex items-baseline gap-2.5">
                        {time !== null && <DataText size="sm">{time}</DataText>}
                        <Text as="span" className="flex-1 text-sm text-ink">
                          {activity.title}
                        </Text>
                        {activity.location !== null && (
                          <Text as="span" variant="muted">
                            {activity.location.name}
                          </Text>
                        )}
                        {activity.cost !== null && (
                          <DataText size="sm">
                            {formatMoney(activity.cost.amountMinor, activity.cost.currency)}
                          </DataText>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          ))}
        </div>

        {trip.backlog.length > 0 && (
          <Card className="flex flex-col gap-2.5 p-4">
            <Text as="span" className="font-display text-md font-semibold text-ink">
              Not scheduled yet
            </Text>
            <ul className="flex flex-col gap-1.5">
              {trip.backlog.map((activityId) => {
                const activity = trip.activities[activityId];
                if (activity === undefined) return null;
                return (
                  <li key={activityId}>
                    <Text as="span" className="text-sm text-ink">
                      {activity.title}
                    </Text>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </main>
    </div>
  );
}
