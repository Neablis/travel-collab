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
import { Button, buttonVariants } from "../components/ui/button";
import { EmptyState } from "../components/ui/empty-state";
import { Popover } from "../components/ui/popover";
import { Dialog, DialogFooter } from "../components/ui/dialog";
import { Toast } from "../components/ui/toast";
import { PageContainer } from "../components/ui/page-container";
import { formatTripDateLong } from "../lib/formatDate";
import { NextTripHero } from "../components/home/NextTripHero";
import { TripCard } from "../components/home/TripCard";
import { NewTripWizard } from "../components/home/NewTripWizard";
import { PlaybooksStrip } from "../components/home/PlaybooksStrip";
import { WorthYourAttention } from "../components/home/WorthYourAttention";
import { PREVIEW_PLAYBOOKS, PREVIEW_ATTENTION } from "../components/home/preview-fixtures";
import { Preview } from "../components/ui/preview";
import { ShareButton } from "../components/trip/ShareButton";
import { duplicateTrip, createTrip as createTripApi, sendTripCommand, fetchTripDetail } from "../lib/apiClient";
import { tripSpend, plannedOfBudgetLine } from "../lib/cost";
import { cn } from "../lib/cn";

// Today's calendar date as YYYY-MM-DD in local time, so formatTripDateLong
// (which expects a calendar date, not an instant — see lib/formatDate.ts)
// never mis-renders across a UTC offset the way `new Date().toISOString()`
// would near midnight.
function todayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export default function Home() {
  const router = useRouter();
  // `todayIso()` reads the wall clock, so evaluating it during render would
  // make the server's render (server's local time) and the browser's
  // hydration render (the actual viewer's local time) disagree whenever
  // they're in different timezones — a real hydration mismatch, not just a
  // cosmetic one, since it can also just be a WRONG date until some later,
  // unrelated re-render happens to overwrite it (CodeRabbit, PR #35).
  // `null` until the client's own effect runs keeps the server and the
  // client's first paint identical (both render nothing here), then fills
  // in the viewer's actual local date once it's safe to read.
  const [dateLabel, setDateLabel] = useState<string | null>(null);
  useEffect(() => {
    setDateLabel(formatTripDateLong(todayIso()));
  }, []);
  const [trips, setTrips] = useState<TripSummary[] | null>(null);
  const [unauthenticated, setUnauthenticated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // New-trip is now the 4-step NewTripWizard (page head "New trip" trigger,
  // Phase 7 Task 7.2), hosted in the same Sheet-in-a-Dialog-slot this single
  // field Dialog used to be. CreateTrip itself still only ever carries a name
  // (packages/contracts/src/trip.ts) — the wizard's other real fields
  // (dates, budget/currency) apply as separate SetTripDates/SetTripBudget/
  // SetTripCurrency commands against the tripId CreateTrip returns, per the
  // phase doc's sequence. Everything else the design's wizard shows is
  // Preview-wrapped (see NewTripWizard.tsx and preview-registry.ts).
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

  const tripCountLabel = `${visibleTrips.length} trip${visibleTrips.length === 1 ? "" : "s"}`;

  return (
    <PageContainer as="main" width="content" className="home-rhythm">
      <SpeedInsights />
      <div className="home-stack">
        <div>
          {/* Task 8.5: a mono uppercase date line above the page title —
              the codebase's established "uppercase label" convention
              (NextTripHero's own "Shape of the trip" label, table.tsx's
              column headers) is text-xs/tracking-wide/text-slate; DataText
              already supplies the mono digits + slate color that pattern
              wants, so this reuses it rather than hand-rolling a new
              combination for one line. */}
          <DataText as="time" size="xs" data-testid="page-date-line" className="uppercase tracking-wide">
            {dateLabel}
          </DataText>
          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-3">
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
        </div>

        {/* The wizard's own createTrip/Create-empty failures render their own
            inline alert inside the Sheet (NewTripWizard.tsx) — this top-level
            `error` is now exclusively delete/duplicate-trip feedback, so no
            newTripOpen gate is needed to avoid a stranded duplicate. */}
        {error && (
          <Text role="alert" variant="secondary" className="text-danger-ink">
            {error}
          </Text>
        )}

        <NewTripWizard
          open={newTripOpen}
          onOpenChange={setNewTripOpen}
          createTrip={createTripApi}
          dispatch={sendTripCommand}
          // Only the full wizard (dates/budget applied) navigates straight to
          // the new trip, matching the phase doc's own "create... apply
          // dates and budget... then navigate" sequence. "Create empty" is
          // the old single-field dialog's escape hatch and keeps that
          // dialog's exact behavior — close, refresh the list, stay put — so
          // e2e specs built around it can still find the new trip's own card
          // on this page rather than having already been navigated away from
          // it (CI, PR #32).
          onCreated={(tripId, { navigate }) => {
            if (navigate) {
              router.push(`/trips/${tripId}`);
            } else {
              void load();
            }
          }}
        />

        {nextTrip && <NextTripHero trip={nextTrip} shareSlot={<ShareButton variant="secondary" />} />}

        <div>
          {trips !== null && visibleTrips.length === 0 ? (
            <EmptyState title="Start your first trip" body="No trips yet — create one." />
          ) : (
            <>
              {visibleTrips.length > 0 && (
                <div className="mb-3 flex items-baseline justify-between gap-3">
                  <Heading level={3}>All trips</Heading>
                  <Text variant="secondary">{tripCountLabel}</Text>
                </div>
              )}
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
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
            </>
          )}
        </div>

        {/* Task 16 Preview shells (README §1 home layout): "Your Playbooks"
            strip after the all-trips grid, then "Worth your attention" last.
            The handoff shows both as part of the normal home layout
            regardless of trip count (they're cross-trip surfaces, not
            per-trip ones), so — unlike NextTripHero/the trips grid above —
            these render unconditionally rather than gating on `visibleTrips`.
            Real fixture data + no-op: both are entirely inert inside their
            own <Preview> seam (Task 3), which shields pointer events and
            stamps the "Preview · M9"/"Preview · M11" chip. */}
        <Preview id="home-playbooks-strip" size="container">
          <PlaybooksStrip playbooks={PREVIEW_PLAYBOOKS} />
        </Preview>

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
    </PageContainer>
  );
}
