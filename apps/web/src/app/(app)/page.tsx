"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MoreVertical } from "lucide-react";
import type { TripSummary } from "@tc/contracts";
import { Heading } from "@/components/ui/heading";
import { useIsPhone } from "@/components/lenses/useIsPhone";
import { Text } from "@/components/ui/text";
import { DataText } from "@/components/ui/data-text";
import { Button, buttonVariants } from "@/components/ui/button";
import { Popover } from "@/components/ui/popover";
import { Toast } from "@/components/ui/toast";
import { PageContainer } from "@/components/ui/page-container";
import { formatTripDateLong } from "@/lib/formatDate";
import { NextTripHero } from "@/components/home/NextTripHero";
import { NextTripHeroSkeleton, TripGridSkeleton } from "@/components/home/HomeSkeletons";
import { RegionError } from "@/components/ui/skeleton";
import { TripCard } from "@/components/home/TripCard";
import { NewTripWizard } from "@/components/home/NewTripWizard";
import { FirstTripStart } from "@/components/home/FirstTripStart";
import { ImportTripButton } from "@/components/home/ImportTripButton";

/** The inline first-run composer, so the page head's "New trip" can focus it. */
const FIRST_TRIP_COMPOSER_ID = "first-trip-composer";
import { ShareButton } from "@/components/trip/ShareButton";
import { duplicateTrip, createTrip as createTripApi, sendTripCommand, fetchTripDetail } from "@/lib/apiClient";
import { DEMO_TRIP_ID } from "@/lib/demoTrip";
import { takeDemoClone } from "@/lib/pendingDemoClone";
import { tripSpend, plannedOfBudgetLine } from "@/lib/cost";
import { cn } from "@/lib/cn";

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
  // in the viewer's actual local date once it's safe to read. Kept as the
  // raw ISO (not the pre-formatted label) so the rendered <time> can carry
  // an honest machine-readable `dateTime`, not just human-readable text
  // (CodeRabbit, PR #35).
  const [dateIso, setDateIso] = useState<string | null>(null);
  useEffect(() => {
    setDateIso(todayIso());
  }, []);
  const [trips, setTrips] = useState<TripSummary[] | null>(null);
  const [unauthenticated, setUnauthenticated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Why this is separate from `error` above: `error` is delete/duplicate
  // feedback about a trip that is already on screen, and the page around it
  // still works. This one says the list itself never arrived, which is the
  // only thing on the page worth reading — so it carries its own retry and
  // survives independently of a later delete failure clearing the other.
  const [loadError, setLoadError] = useState<string | null>(null);
  // New-trip is now the 4-step NewTripWizard (page head "New trip" trigger,
  // Phase 7 Task 7.2), hosted in the same Sheet-in-a-Dialog-slot this single
  // field Dialog used to be. CreateTrip itself still only ever carries a name
  // (packages/contracts/src/trip.ts) — the wizard's other real fields
  // (dates, budget/currency) apply as separate SetTripDates/SetTripBudget/
  // SetTripCurrency commands against the tripId CreateTrip returns, per the
  // phase doc's sequence. Everything else the design's wizard shows is
  // Preview-wrapped (see NewTripWizard.tsx and preview-registry.ts).
  // SPEC §32.2 — the new-trip conversation owns the whole frame on a phone.
  const isPhone = useIsPhone();
  const [newTripOpen, setNewTripOpen] = useState(false);
  // True while the "Make this trip mine" copy this page inherited from `/demo`
  // is in flight — see `lib/pendingDemoClone.ts` for why the intent arrives
  // here at all. It also holds the first-run wizard shut — both while it is
  // open (the effect below force-closes it the moment cloning starts) and
  // against being opened — because a submit of that wizard while the clone
  // request is in flight creates an extra trip nobody asked for (CodeRabbit,
  // pull request 104): the wizard's own `createTrip` has no idea a copy is already
  // headed for this same list. Both launchers into the wizard — the page-head
  // "New trip" button and the first-run conversation's own "Create empty" — are disabled
  // below for the same reason.
  const [cloningDemo, setCloningDemo] = useState(false);
  const [openMenuTripId, setOpenMenuTripId] = useState<string | null>(null);
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

  // Computed above the effects that read it, not beside the render — "does
  // this person have any trips" is what decides whether the first run fires,
  // and hooks cannot read a value declared below them.
  const visibleTrips = (trips ?? []).filter((t) => !deletingIds.has(t.tripId));
  const hasNoTrips = trips !== null && visibleTrips.length === 0;
  // **Three states, named once.** `trips === null` used to mean both "still
  // reading" and "the read failed" to every branch below, which is exactly why
  // a failure rendered a title row and nothing else forever. `loadError` is
  // what separates them, so the placeholder is drawn only while an answer is
  // genuinely still coming.
  const loading = trips === null && loadError === null;

  // **One composer, and an open sheet wins it.**
  //
  // "New trip" is pressable while `trips` is still null, so the sheet can be
  // open when the list lands empty and the first-run screen appears under it.
  // Two earlier shapes were tried here and both were wrong. Rendering both was
  // the original defect — two fields with one accessible name. Closing the
  // sheet when `hasNoTrips` flipped (the guard CodeRabbit's round 2 produced)
  // fixed that and introduced a worse one: it threw away whatever the reader
  // had already typed INTO the sheet, leaving a permanently disabled "Create
  // empty" over an empty inline field. `createEmptyTripViaWizard` hung on
  // exactly that for its full 30s timeout (e2e, 2026-09-18).
  //
  // So the sheet opens whenever it is asked to, and `FirstTripStart` yields
  // its conversation while it is open (`showConversation`). Nothing latches,
  // because nothing is ever requested-but-hidden — which also retires the
  // resurfacing case that guard existed for: a reader cannot create a first
  // trip inline while the sheet is up, so there is no moment for it to
  // reappear over.

  /**
   * **"New trip" opens the sheet — unless the conversation is already on the
   * page**, which it is on a Home with no trips, where `FirstTripStart` renders
   * it inline. Opening the sheet there would put a second composer with the
   * same accessible name on one screen: ambiguous to a screen reader, and a
   * strict-mode violation for any test that addresses the field by its label.
   * So here the button moves the cursor into the conversation that exists.
   */
  function startNewTrip() {
    if (!hasNoTrips) {
      setNewTripOpen(true);
      return;
    }
    // `focus()` only — **`scrollIntoView` is banned repo-wide** (SPEC §30.6,
    // KI-2026-09-13-a): it scrolls every scrollable ancestor, which is the bug
    // `usePinToBottom` exists to avoid on this very flow. Focusing a form
    // control brings it into view natively, so the ban costs nothing here.
    document.getElementById(FIRST_TRIP_COMPOSER_ID)?.focus();
  }

  // Every render branch below is gated on `trips !== null`, so "the read
  // failed" and "the read has not finished" are the same state to them —
  // which is why a failure that leaves `trips` null renders a title row, a
  // "New trip" button and nothing else, forever, with only an unhandled
  // rejection in the console to say so. This is the third site of the class
  // the 2026-08-28 review named (§1.1); `TripProvider.load` got its try/catch
  // then and this one did not (KI-2026-09-05-y / F-G03). Two things escape
  // without it: `res.json()` on a non-JSON 500 body, and the `fetch` itself
  // rejecting (offline, DNS) — both are covered here.
  //
  // Only a 401 means `/welcome`. A 500 is not "you are signed out", and
  // sending someone to the front door on one would log them out of a working
  // session.
  // LAST WRITER WINS, AND THE LAST WRITER IS THE LAST REQUEST — not the last
  // response. `load` is called from the first-run effect, from Try again, and
  // after a create or a restore, so two can be in flight at once; without this
  // a slow earlier call settling second would reinstate a stale error over a
  // good result, or overwrite newer trips with older ones (CodeRabbit, PR #155).
  // A monotonic ticket rather than an AbortController because the loser here
  // must not CANCEL the winner's work — both may legitimately be running, only
  // one may write.
  const loadTicket = useRef(0);
  const load = useCallback(async () => {
    const ticket = ++loadTicket.current;
    const isStale = () => ticket !== loadTicket.current;
    try {
      const res = await fetch("/api/trips");
      if (isStale()) return;
      if (res.status === 401) {
        setUnauthenticated(true);
        return;
      }
      if (!res.ok) {
        setLoadError("Could not load your trips.");
        return;
      }
      const data = (await res.json()) as { trips: TripSummary[] };
      // Re-checked AFTER the second await: `res.json()` is its own suspension
      // point, and a newer load can win during it.
      if (isStale()) return;
      setUnauthenticated(false);
      setLoadError(null);
      setTrips(data.trips);
    } catch {
      if (isStale()) return;
      // Deliberately not the thrown message: a `TypeError: Failed to fetch`
      // or a JSON parse error is about the transport, not about anything the
      // reader can act on. The retry is the actionable half.
      setLoadError("Could not load your trips.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Finish the copy somebody asked for on `/demo` before they had an account.
  //
  // Here rather than only on `/demo`, because this is the page every
  // successful sign-in actually reaches: a refusal round trip
  // (`/signup?error=…`) is built server-side and cannot carry a callback, and
  // the sign-in ⇄ sign-up swap dropped the callback too until this branch's
  // `AuthScreen` change. `takeDemoClone` reads AND clears, so StrictMode's
  // double-invoked effect finds nothing on its second pass and the ref below
  // is belt to that braces.
  //
  // Gated on `trips !== null`: it must not race the first `/api/trips` read,
  // whose 401 is what sends an expired session to `/welcome`. Running the copy
  // first would fire a duplicate request that 401s and leaves the marker spent.
  const demoCloneAttempted = useRef(false);
  useEffect(() => {
    if (demoCloneAttempted.current || trips === null || unauthenticated) return;
    if (!takeDemoClone()) return;
    demoCloneAttempted.current = true;
    setCloningDemo(true);
    // The wizard may already be open (page-head button, or the first-run
    // card) when this fires — `takeDemoClone` only resolves once `/api/trips`
    // has answered, and someone can click "New trip" in that same window. A
    // trip they're actively naming is about to be blown away by a navigation
    // to the demo copy, so close it rather than let the submit race the
    // clone (CodeRabbit, pull request 104).
    setNewTripOpen(false);
    void duplicateTrip(DEMO_TRIP_ID).then((result) => {
      if (result.ok) {
        // Left true across the navigation on purpose: `router.push` does not
        // unmount synchronously, and flipping this back would flash the empty
        // state — or the first-run sheet — on the way out.
        router.push(`/trips/${result.value.tripId}`);
        return;
      }
      setCloningDemo(false);
      // Not fatal and not silent. The trip list is a perfectly good place to
      // be; they simply did not get the copy, and the demo is still one link
      // away. Reusing the page's own error line rather than a second surface.
      setError("We could not take a copy of the example trip. Open the demo and press it again.");
    });
  }, [trips, unauthenticated, router]);

  // **SPEC §27: the card goes on the CLICK, and there is no confirm dialog.**
  //
  // > Delete is optimistic. The card goes on the click; the toast carries a
  // > single Undo that restores it. **The undo window is a toast, not a trash
  // > view** — that is the one thing the design asserts beyond the contract.
  //
  // The dialog that used to sit here asked "Delete <name>? You can undo this
  // from the toast that follows", which is a modal whose own copy explains that
  // the action is reversible — a confirm step for something that does not need
  // confirming. The recovery is real and immediate (`RestoreTrip`, below, is a
  // command the server already has), so the toast IS the safety net and the
  // dialog was a second one charging for the first.
  async function deleteTrip(trip: TripSummary) {
    setOpenMenuTripId(null);
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

  // M15 (ADR-023): `src/proxy.ts` now handles *arrival* — a signed-out
  // visitor hitting `/` is redirected to `/welcome` before this page ever
  // renders, so this branch no longer fires on first load. What it still
  // covers is *expiry-in-place*: a session that lapses while this page is
  // already open produces a 401 the next time `load()` fetches /api/trips
  // (a manual refresh, a background poll, etc.), and that visitor should
  // still be sent to the front door rather than left looking at a stuck or
  // broken authenticated view. The landing page lives at /welcome, outside
  // this route group's AppHeader shell. `replace`, not `push`, so the back
  // button doesn't bounce them straight back into a page that will only
  // redirect them again.
  useEffect(() => {
    if (unauthenticated) router.replace("/welcome");
  }, [unauthenticated, router]);

  if (unauthenticated) return null;

  const tripCountLabel = `${visibleTrips.length} trip${visibleTrips.length === 1 ? "" : "s"}`;

  return (
    <PageContainer as="main" width="content" className="home-rhythm">
      <div className="home-stack">
        <div>
          {/* Task 8.5: a mono uppercase date line above the page title —
              the codebase's established "uppercase label" convention
              (NextTripHero's own "Shape of the trip" label, table.tsx's
              column headers) is text-xs/tracking-wide/text-slate; DataText
              already supplies the mono digits + slate color that pattern
              wants, so this reuses it rather than hand-rolling a new
              combination for one line. */}
          <DataText
            as="time"
            size="xs"
            data-testid="page-date-line"
            className="uppercase tracking-wide"
            dateTime={dateIso ?? undefined}
          >
            {dateIso !== null ? formatTripDateLong(dateIso) : null}
          </DataText>
          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-3">
            <Heading level={1}>Your trips</Heading>
            {/* README §1 head: "New trip" primary + "Start from a Playbook".
                The link was already real; as of M11b so is what it opens —
                Discover, over other people's published days. This is also the
                home page's whole Playbooks surface now: the "Your Playbooks"
                strip below it was a `<Preview>` shell over six fabricated
                cards, and M11b deletes those shells rather than re-pointing
                them. Your own days are the `Yours` scope on Discover, which is
                where §15 puts them (a filter on that page, never a second
                page). */}
            <div className="flex flex-wrap items-center gap-2">
              <Link href="/playbooks" className={cn(buttonVariants({ variant: "secondary", size: "md" }))}>
                Start from a Playbook
              </Link>
              {/* **Import sits beside the other two ways a trip starts** (M25
                  link 2). A file is a third origin for a trip, not a setting,
                  so it belongs where "New trip" and "Start from a Playbook"
                  already are rather than behind a menu.

                  **Not on the first-run screen, where `FirstTripStart` carries
                  it instead.** Three controls is one more than this row was
                  built for: at 375px it wrapped onto an extra line and pushed
                  that card's composer out of the viewport, which
                  `responsive.spec.ts:917` asserts against. It failed in CI and
                  passed locally in both lanes — the assertion sits close enough
                  to the fold that rendering decides it — so the fix is to give
                  the row back its height rather than to trust the margin.

                  `hasNoTrips` is what makes this exactly one control on either
                  screen rather than two on one. */}
              {!hasNoTrips && <ImportTripButton disabled={cloningDemo} />}
              <Button
                type="button"
                variant="primary"
                disabled={cloningDemo}
                onClick={startNewTrip}
              >
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

        {/* Said out loud, because this page is about to navigate away on its
            own and an unexplained pause on somebody's very first authenticated
            screen reads as the app hanging. */}
        {cloningDemo && (
          <Text role="status" variant="secondary">
            Taking your copy of the example trip…
          </Text>
        )}

        <NewTripWizard
          // Open whenever it is asked for — see the note by `hasNoTrips`
          // above. The inline conversation is what yields, because it is not
          // the surface the reader is typing into.
          open={newTripOpen}
          onOpenChange={setNewTripOpen}
          createTrip={createTripApi}
          dispatch={sendTripCommand}
          // **Full screen on a phone, the rail above it** (SPEC §32.2: *"the
          // phone gets the flow… full-screen conversation"*). A 390px-wide rail
          // is a rail in name only — it is already the whole width — and the
          // `max-w-measure` cap it carries buys nothing there while the
          // rounded, inset chrome costs real room for a conversation somebody
          // is typing into.
          //
          // **`useIsPhone()` is the right tool here and the wrong one for
          // chrome.** It starts `false` on the server and the first client
          // paint, which is why `PhoneTabBar` uses `md:hidden` instead — but
          // this sheet only renders after somebody presses New trip, long after
          // that first paint, and the size is a discrete class set that CSS
          // cannot switch between.
          //
          // The first-run framing that used to ride on this prop is gone and
          // not coming back: `open` is gated on `!hasNoTrips`, so it was
          // unreachable, and first run is the inline conversation now (§32.1).
          size={isPhone ? "full" : "rail"}
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

        {/* **The two regions Home paints before its list lands** — M26 link 7,
            §3b, `LOAD_PLAN.home`. Before this the page drew its date line, its
            heading and its three buttons and then NOTHING, for as long as the
            read took, and on failure added one danger-coloured line at the top
            whose *Try again* re-ran everything. That is the dead screen §3b
            forbids.

            **They resolve together, and that is not a stagger faked.** The
            artboard lands `homeHero` at 320ms and `homeTrips` at 680ms because
            its prototype invents the timings; here both are the ONE
            `/api/trips` read, so they arrive in the same frame. Painting both
            SHAPES is "a page paints its own shape immediately"; making one
            appear before the other would be inventing a seam that does not
            exist, which §3b names as the thing not to do. The page's real
            second wave is per-card — `plannedOfBudgetById` and the hero's own
            `TripDetail` — and both of those already degrade to honest absence.

            Not drawn while `loadError` is set: the region below says what
            happened instead, and a breathing placeholder above a failure
            notice promises an arrival that is not coming. */}
        {loading ? (
          <NextTripHeroSkeleton />
        ) : (
          nextTrip && <NextTripHero trip={nextTrip} shareSlot={<ShareButton tripId={nextTrip.tripId} variant="secondary" />} />
        )}

        <div className="flex flex-col gap-3.5">
          {/* The failed region, in place. The heading and the three buttons
              above are untouched — that is the whole difference from the
              page-level line this replaces, and `RegionError`'s second
              sentence is what tells the reader so. */}
          {loadError !== null && (
            <RegionError
              title={loadError}
              onRetry={() => void load()}
              data-testid="home-trips-error"
            />
          )}
          {loading ? (
            <TripGridSkeleton />
          ) : trips !== null && visibleTrips.length === 0 ? (
            /* M15's first-run moment, rebuilt. Mitchell, 2026-09-01: *"The
               first time walkthrough to build a trip when you have no trips is
               not working, i get the empty landing screen 'Plan your first
               trip' which is pretty underwhelming on first login"*, alongside
               *"building a trip from total scratch is a rough experience"*.

               What stood here was an `EmptyState` card — a title, a sentence,
               and one button — which is the component this app uses for "this
               filter matched nothing". A person's first authenticated screen is
               not an empty filter, and the one route it offered was the hardest
               one: invent a trip from a blank field.

               `FirstTripStart` replaces it with the three ways in that actually
               exist (name it, take somebody's day, look around the example
               trip) and says what the wizard is about to ask. The wizard it
               opens is the same one the page-head button opens — and it opens
               full screen here, because there is nothing behind it to keep
               context with (`SheetSize`).

               Deliberately NOT auto-opened. A modal that opens itself would
               cover the page-head "New trip" button and Radix's overlay would
               swallow the click — and whether it opened at all would depend on
               whether this account happens to have a trip yet, which in the e2e
               suite is a function of which spec ran first. A first run that is
               one obvious click away is worth more than one that is sometimes
               a trap. */
            <FirstTripStart
              createTrip={createTripApi}
              dispatch={sendTripCommand}
              composerId={FIRST_TRIP_COMPOSER_ID}
              disabled={cloningDemo}
              showConversation={!newTripOpen}
              // **SPEC §32.1's `ntLand()` is already satisfied here, and
              // widening it would break nine e2e specs.** §32.1 says finishing
              // a first run has to land you in an app, and names the two exits
              // that do it: *Create with this* and *Open the trip*. Both pass
              // `navigate: true`, so both already push. `Create empty` is not
              // one of them — it is this build's own escape hatch from the old
              // single-field dialog, and making IT navigate is the precise
              // regression CI caught on PR #32: `createEmptyTripViaWizard`
              // reaches this component on an empty list and then asserts the
              // new trip's link on THIS page. The prototype needs `ntLand`
              // because its first-run screen has no app behind it; ours
              // re-renders Home with the new trip's card on it, which is an
              // app, and is not "staring at nothing".
              onDone={(tripId, navigate) => {
                if (tripId !== null && navigate) {
                  router.push(`/trips/${tripId}`);
                } else {
                  void load();
                }
              }}
            />
          ) : trips === null ? null : (
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
                            onClick={() => void deleteTrip(t)}
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
      </div>

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
