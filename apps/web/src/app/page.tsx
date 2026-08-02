"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MoreVertical } from "lucide-react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import type { TripSummary } from "@tc/contracts";
import { Heading } from "../components/ui/heading";
import { Text } from "../components/ui/text";
import { DataText } from "../components/ui/data-text";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Card } from "../components/ui/card";
import { FormField } from "../components/ui/form-field";
import { EmptyState } from "../components/ui/empty-state";
import { Popover } from "../components/ui/popover";
import { Dialog, DialogFooter } from "../components/ui/dialog";
import { Toast } from "../components/ui/toast";
import { duplicateTrip, sendTripCommand } from "../lib/apiClient";

export default function Home() {
  const router = useRouter();
  const [trips, setTrips] = useState<TripSummary[] | null>(null);
  const [unauthenticated, setUnauthenticated] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [openMenuTripId, setOpenMenuTripId] = useState<string | null>(null);
  const [confirmTrip, setConfirmTrip] = useState<TripSummary | null>(null);
  const [toast, setToast] = useState<{ tripId: string; name: string } | null>(null);
  // Optimistically-deleted trip ids: filtered from the render the instant the
  // user confirms, before the DeleteTrip request even starts — there's no
  // TripProvider/predictBatch path for this (DeleteTrip is deliberately
  // excluded from BatchableCommand), so this list-level filter is the
  // optimistic mechanism. A failure removes the id again, bringing the row
  // back; a success leaves it removed permanently via the `trips` filter below.
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    const res = await fetch("/api/trips");
    if (res.status === 401) {
      setUnauthenticated(true);
      return;
    }
    const data = (await res.json()) as { trips: TripSummary[] };
    setUnauthenticated(false);
    setTrips(data.trips);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createTrip(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/trips", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      setError(data.error ?? "Something went wrong");
      return;
    }
    setName("");
    await load();
  }

  function requestDelete(trip: TripSummary) {
    setOpenMenuTripId(null);
    setConfirmTrip(trip);
  }

  // Optimistic: drop the row immediately on CONFIRM (before the DeleteTrip
  // request even starts), not on its response. A failure re-adds the id so
  // the row reappears alongside the error; a success removes it from `trips`
  // for good and raises the undo toast. RestoreTrip (below) reconciles via a
  // real reload — the deleted trip is no longer in local state to restore in
  // place.
  async function confirmDelete() {
    const trip = confirmTrip;
    if (!trip) return;
    setConfirmTrip(null);
    setDeletingIds((prev) => new Set(prev).add(trip.tripId));
    const result = await sendTripCommand({ type: "DeleteTrip", tripId: trip.tripId });
    if (!result.ok) {
      setDeletingIds((prev) => {
        const next = new Set(prev);
        next.delete(trip.tripId);
        return next;
      });
      setError(result.error.message);
      return;
    }
    setTrips((prev) => (prev ?? []).filter((t) => t.tripId !== trip.tripId));
    setDeletingIds((prev) => {
      const next = new Set(prev);
      next.delete(trip.tripId);
      return next;
    });
    setToast({ tripId: trip.tripId, name: trip.name });
  }

  async function undoDelete() {
    if (!toast) return;
    const { tripId } = toast;
    setToast(null);
    const result = await sendTripCommand({ type: "RestoreTrip", tripId });
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    await load();
  }

  async function duplicate(trip: TripSummary) {
    setOpenMenuTripId(null);
    const result = await duplicateTrip(trip.tripId);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    router.push(`/trips/${result.value.tripId}`);
  }

  const visibleTrips = (trips ?? []).filter((t) => !deletingIds.has(t.tripId));

  if (unauthenticated) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-8">
        <Heading level={1}>travel-collab</Heading>
        <Link
          href="/api/auth/signin?callbackUrl=/"
          className="mt-4 inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-border-strong bg-surface px-3.5 text-base font-medium text-ink transition-colors hover:bg-moss"
        >
          Sign in
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <SpeedInsights />
      <Heading level={1}>Your trips</Heading>
      <form onSubmit={createTrip} className="mt-4 flex items-end gap-2">
        <FormField id="trip-name" label="Trip name">
          <Input
            id="trip-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Trip name"
            aria-label="Trip name"
          />
        </FormField>
        <Button type="submit" variant="primary">
          Create trip
        </Button>
      </form>
      {error && (
        <Text role="alert" variant="secondary" className="mt-2 text-danger-ink">
          {error}
        </Text>
      )}
      {trips !== null && visibleTrips.length === 0 ? (
        <EmptyState title="Start your first trip" body="No trips yet — create one." />
      ) : (
        <ul className="mt-6 flex flex-col gap-2">
          {visibleTrips.map((t) => (
            <Card key={t.tripId} as="li" className="flex items-center justify-between gap-3">
              <div>
                <Link href={`/trips/${t.tripId}`} className="text-brand font-medium hover:underline">
                  {t.name}
                </Link>
                <div>
                  <DataText>{t.createdAt}</DataText>
                </div>
              </div>
              <Popover
                open={openMenuTripId === t.tripId}
                onOpenChange={(open) => setOpenMenuTripId(open ? t.tripId : null)}
                align="end"
                contentClassName="w-40 p-1"
                trigger={
                  <Button variant="ghost" size="icon" aria-label={`Trip actions for ${t.name}`}>
                    <MoreVertical className="size-3.5" aria-hidden />
                  </Button>
                }
              >
                <div role="menu" className="flex flex-col">
                  <Button
                    role="menuitem"
                    variant="ghost"
                    className="justify-start"
                    onClick={() => void duplicate(t)}
                  >
                    Duplicate
                  </Button>
                  <Button
                    role="menuitem"
                    variant="ghost"
                    className="justify-start text-danger-ink"
                    onClick={() => requestDelete(t)}
                  >
                    Delete
                  </Button>
                </div>
              </Popover>
            </Card>
          ))}
        </ul>
      )}

      <Dialog open={confirmTrip !== null} onOpenChange={(open) => !open && setConfirmTrip(null)} title="Delete trip">
        <Text variant="secondary">
          Delete &quot;{confirmTrip?.name}&quot;? You can undo this from the toast that follows.
        </Text>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setConfirmTrip(null)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => void confirmDelete()}>
            Delete
          </Button>
        </DialogFooter>
      </Dialog>

      {toast && (
        <Toast
          message={`Deleted "${toast.name}"`}
          actionLabel="Undo"
          onAction={() => void undoDelete()}
          onDismiss={() => setToast(null)}
        />
      )}
    </main>
  );
}
