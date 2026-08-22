"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MoreVertical } from "lucide-react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import type { TripSummary } from "@tc/contracts";
import { Heading } from "../components/ui/heading";
import { Text } from "../components/ui/text";
import { Button, buttonVariants } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { FormField } from "../components/ui/form-field";
import { EmptyState } from "../components/ui/empty-state";
import { Popover } from "../components/ui/popover";
import { Dialog, DialogFooter } from "../components/ui/dialog";
import { Toast } from "../components/ui/toast";
import { NextTripHero } from "../components/home/NextTripHero";
import { TripCard } from "../components/home/TripCard";
import { PlaybooksStrip } from "../components/home/PlaybooksStrip";
import { WorthYourAttention } from "../components/home/WorthYourAttention";
import { PREVIEW_PLAYBOOKS, PREVIEW_ATTENTION } from "../components/home/preview-fixtures";
import { Preview } from "../components/ui/preview";
import { ShareButton } from "../components/trip/ShareButton";
import { duplicateTrip, sendTripCommand, fetchTripDetail } from "../lib/apiClient";
import { tripSpend, plannedOfBudgetLine } from "../lib/cost";
import { cn } from "../lib/cn";

export default function Home() {
  const router = useRouter();
  const [trips, setTrips] = useState<TripSummary[] | null>(null);
  const [unauthenticated, setUnauthenticated] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  // New-trip is now a Dialog (page head "New trip" trigger, README §1) rather
  // than an always-visible inline form. Single-step: CreateTrip
  // (packages/contracts/src/trip.ts) only ever carries a name — no
  // destination/dates/pace/tags field exists on the command, so there is
  // nowhere honest to send a multi-step wizard's extra input. See M10 plan
  // Task 13 notes: deliberately deferred, not built, pending a contract change.
  const [newTripOpen, setNewTripOpen] = useState(false);
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
  // Per-card "{planned} planned of {budget}" lines (Task 4.1, M10 Phase 4),
  // keyed by tripId. TripSummary (what /api/trips returns) carries no cost
  // fields at all, so this grid — unlike NextTripHero, which already has its
  // one trip's real TripDetail — fetches each visible trip's own TripDetail
  // itself below and computes the same line via the shared
  // plannedOfBudgetLine helper. A trip whose fetch is still pending or
  // failed simply has no entry here: TripCard already renders nothing for a
  // missing plannedOfBudget prop, so that's honest absence, not a fabricated
  // or stale line.
  const [plannedOfBudgetById, setPlannedOfBudgetById] = useState<Record<string, string>>({});

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
    setNewTripOpen(false);
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
  // "Next trip" (README §1 next-trip hero): TripSummary carries no start
  // date (packages/contracts/src/trip.ts), so there's no real "first
  // upcoming by start date" to compute — per the M10 plan, this uses the
  // first trip in the list instead of adding a server-side date field
  // (presentational-only rule). Revisit once TripSummary gains a start date.
  const nextTrip = visibleTrips[0] ?? null;

  // One TripDetail fetch per visible grid trip (keyed by a joined id string
  // so this only refires when the actual set of visible ids changes, not on
  // every render): TripSummary has no cost fields, and there is no batch
  // endpoint for "cost for these N trips" — accepted N-fetch cost (Task 4.1
  // brief), not something to cache/paginate/batch around here.
  const visibleTripIds = visibleTrips.map((t) => t.tripId).join(",");
  useEffect(() => {
    const ids = visibleTripIds === "" ? [] : visibleTripIds.split(",");
    // Clear synchronously before the async work: a trip-set change always
    // shows honest absence while its round is in flight (consistent with
    // first-load behavior), and a round that never completes (e.g. because
    // one fetch rejects below) can't leave a previous round's data lingering
    // on screen as a stale, mistaken-for-current figure.
    setPlannedOfBudgetById({});
    if (ids.length === 0) return;
    let cancelled = false;
    void Promise.all(
      ids.map(async (tripId) => {
        try {
          const result = await fetchTripDetail(tripId);
          return result.ok
            ? ([tripId, plannedOfBudgetLine(tripSpend(result.value), result.value.currency)] as const)
            : null;
        } catch {
          // A network-level failure (offline, DNS, CORS) rejects rather than
          // resolving with { ok: false }. Promise.all is fail-fast, so one
          // rejection here would otherwise take down every other trip's
          // result in this round. Treat it the same as an HTTP failure.
          return null;
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      const next: Record<string, string> = {};
      for (const entry of entries) {
        if (entry !== null) next[entry[0]] = entry[1];
      }
      setPlannedOfBudgetById(next);
    });
    return () => {
      cancelled = true;
    };
  }, [visibleTripIds]);

  if (unauthenticated) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-8">
        <Heading level={1}>travel-collab</Heading>
        <Link
          href="/api/auth/signin?callbackUrl=/"
          className={cn(buttonVariants({ variant: "secondary" }), "mt-4")}
        >
          Sign in
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <SpeedInsights />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Heading level={1}>Your trips</Heading>
        {/* README §1 head: "New trip" primary + a real (not Preview-wrapped)
            "Start from a Playbook" link — the link itself navigates for
            real; it's the /playbooks route's own content that's the Preview
            seam (Task 18). */}
        <div className="flex items-center gap-2">
          <Link href="/playbooks" className={cn(buttonVariants({ variant: "secondary", size: "md" }))}>
            Start from a Playbook
          </Link>
          <Button type="button" variant="primary" onClick={() => setNewTripOpen(true)}>
            New trip
          </Button>
        </div>
      </div>
      {/* Only rendered while the dialog is closed — while it's open, the
          same `error` state renders inside the Dialog below instead, so a
          failed createTrip (which keeps the dialog open) doesn't leave its
          message stranded behind the Dialog's overlay (Radix Portal renders
          after <main> in DOM order, so a sibling here would paint under it). */}
      {error && !newTripOpen && (
        <Text role="alert" variant="secondary" className="mt-2 text-danger-ink">
          {error}
        </Text>
      )}
      <Dialog open={newTripOpen} onOpenChange={setNewTripOpen} title="New trip">
        <form onSubmit={createTrip} className="flex flex-col gap-3">
          {error && (
            <Text role="alert" variant="secondary" className="text-danger-ink">
              {error}
            </Text>
          )}
          <FormField id="trip-name" label="Trip name">
            <Input
              id="trip-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Trip name"
              aria-label="Trip name"
            />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setNewTripOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary">
              Create trip
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
      {nextTrip && (
        <div className="mt-6">
          <NextTripHero trip={nextTrip} shareSlot={<ShareButton variant="secondary" />} />
        </div>
      )}

      {trips !== null && visibleTrips.length === 0 ? (
        <EmptyState title="Start your first trip" body="No trips yet — create one." />
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {visibleTrips.map((t) => (
            <TripCard
              key={t.tripId}
              trip={t}
              plannedOfBudget={plannedOfBudgetById[t.tripId]}
              menuSlot={
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
              }
            />
          ))}
        </div>
      )}

      {/* Task 16 Preview shells (README §1 home layout): "Your Playbooks"
          strip after the all-trips grid, then "Worth your attention" last.
          The handoff shows both as part of the normal home layout
          regardless of trip count (they're cross-trip surfaces, not
          per-trip ones), so — unlike NextTripHero/the trips grid above —
          these render unconditionally rather than gating on `visibleTrips`.
          Real fixture data + no-op: both are entirely inert inside their
          own <Preview> seam (Task 3), which shields pointer events and
          stamps the "Preview · M9"/"Preview · M11" chip. */}
      <div className="mt-6">
        <Preview id="home-playbooks-strip" size="container">
          <PlaybooksStrip playbooks={PREVIEW_PLAYBOOKS} />
        </Preview>
      </div>

      <div className="mt-6">
        <Preview id="home-worth-attention" size="container">
          <WorthYourAttention items={PREVIEW_ATTENTION} />
        </Preview>
      </div>

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
