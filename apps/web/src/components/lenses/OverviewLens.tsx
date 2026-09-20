"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { PageDoc, PageSummary, TripDetail, TripGlobals } from "@tc/contracts";
import { isOverviewPage } from "@tc/pages";
import { fetchPage, fetchPages } from "@/lib/pagesClient";
import { fetchTripGlobals } from "@/lib/apiClient";
import { DEDUPE, cachedRead } from "@/lib/queryCache";
import { tripKeys } from "@/lib/queryKeys";
import { inspectStoredPageDoc } from "@/components/pages/editor/storedPageDoc";
import { PageEditor } from "@/components/pages/editor/PageEditor";
import { buttonVariants } from "@/components/ui/button";
import { RegionError, Skeleton, SkeletonRegion } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/cn";

// SPEC §25: **Overview IS a notebook page.**
//
// > Not a dashboard, and not a second rendering of the trip. Every trip is
// > created with one notebook page it cannot delete, and the Overview tab
// > renders that page.
//
// Three consequences this component exists to honour:
//
// 1. **No bespoke Overview layout.** It mounts `PageEditor` — the same
//    component the Notebook route mounts — with `editable={false}`, which is
//    already §18's Reading mode. A second renderer would be a second place for
//    a widget to look different, which is the whole thing §25 is avoiding.
// 2. **Editing does not happen on the tab.** *"The tab's one button opens the
//    page in the Notebook, where pages are edited. One editor, one document,
//    two places to read it."* So there is exactly one action here, and it is a
//    link.
// 3. **Nothing here is derived separately from the trip.** The widgets read
//    `detail` — the same `TripDetail` Plan, Calendar and Map read — so an
//    Overview that disagrees with Plan is not merely discouraged, it has no
//    route to disagree.
//
// **Seeding stays lazy, and that is deliberate.** §25 says every trip is
// created with this page; `listPages` creates it on the first read instead, and
// this component reads through that same path. The effect is identical from
// outside — every trip has an Overview, and looking at either surface
// materialises it — and it keeps the seeding race that `listPages` already
// solves (`pages_system_seed_unique`, and the backdating that keeps the order
// stable) in the one place that solves it. Moving the seed to trip creation
// would have to re-solve both, and would leave every trip created before the
// change without one.
export function OverviewLens({ detail, tripId }: { detail: TripDetail; tripId: string }) {
  // Fetched here rather than taken as a prop, the same way `PageScreen` does
  // it: the trip board has never needed the cities projection and asking it to
  // carry one for this tab would put a request on Plan, Calendar and Map to
  // serve Overview. A widget renders without it, one value shorter — the
  // honest degradation `day.rows` already documents — and `open`, the only
  // widget the seeded page carries, does not read it at all.
  const [globals, setGlobals] = useState<TripGlobals | null>(null);
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; page: PageSummary; doc: PageDoc }
    | { status: "unreadable"; page: PageSummary }
  >({ status: "loading" });

  // Read through the cache, because this component is UNMOUNTED whenever you
  // leave the tab — `TripBoardScreen` renders it as `{view === "Overview" &&
  // <OverviewLens/>}` — so before this, a glance at Calendar and back re-ran
  // all three requests below for data that could not have changed in the
  // second you were away. The lens switcher is a search param (ADR-012
  // invariant 2), so this is a remount per tab visit, not per page load.
  //
  // `DEDUPE.DOCUMENT` rather than the shorter navigation window: these are the
  // trip's documents, read far more often than written, and every local write
  // to the trip invalidates them by prefix (`tripKeys.all`) — so the window
  // can only ever hide a REMOTE edit, and only for as long as it lasts.
  // M26 link 7, §3b: **a failed region retries in place.** This nonce is the
  // whole mechanism — bumping it re-runs the effect below, which is the same
  // read the first attempt made. Deliberately not a second code path: a retry
  // that does not repeat the original read is a retry of something else.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    void cachedRead(tripKeys.globals(tripId), () => fetchTripGlobals(tripId), {
      dedupeMs: DEDUPE.DOCUMENT,
    }).then((r) => {
      if (live && r.ok) setGlobals(r.value);
    });
    void (async () => {
      const list = await cachedRead(tripKeys.pages(tripId), () => fetchPages(tripId), {
        dedupeMs: DEDUPE.DOCUMENT,
      });
      if (!live) return;
      if (!list.ok) return setState({ status: "error", message: "Couldn't load this trip's Overview." });
      const summary = list.value.pages.find((p: PageSummary) => isOverviewPage(p.context));
      // A trip whose Overview is genuinely absent: every trip seeded since
      // 2026-09-12 has one, and a trip that was seeded BEFORE it has the two
      // older prose pages instead and will never be re-seeded (`listPages`
      // seeds only into a trip with zero pages). That is a real state and it
      // gets a real answer rather than a spinner that never resolves.
      if (summary === undefined) return setState({ status: "error", message: "This trip has no Overview page." });
      const page = await cachedRead(
        tripKeys.page(tripId, summary.id),
        () => fetchPage(tripId, summary.id),
        { dedupeMs: DEDUPE.DOCUMENT },
      );
      if (!live) return;
      if (!page.ok) return setState({ status: "error", message: "Couldn't load this trip's Overview." });
      // ADR-038 decision 4: whoever mounts `PageEditor` has already been told
      // the document is mountable. A page someone has edited into a shape this
      // build cannot parse must not white-screen the trip's landing tab.
      //
      // `unsupported` mounts here even though the Notebook route refuses it,
      // and the difference is decision 4's own: `unsupported` means the
      // document parsed and carries a node this build's EDITOR cannot mount.
      // This tab does not mount an editor — `editable={false}` — so the node
      // renders as decision 3's inert placeholder and the rest of the page is
      // readable, which is the whole point of a read-only presentation.
      const inspected = inspectStoredPageDoc(page.value.content);
      setState(
        inspected.status === "unreadable"
          ? { status: "unreadable", page: summary }
          : { status: "ready", page: summary, doc: inspected.doc },
      );
    })();
    return () => {
      live = false;
    };
  }, [tripId, attempt]);

  // **The chrome, outside every branch** — §3b, and the artboard draws it that
  // way (`dc.html:1959-1964`: the heading row and *Edit in Notebook* sit ABOVE
  // `loadOvBody`/`failOvBody`, not inside the arrived case). Before this it was
  // built in the `ready` branch and therefore missing from the two states a
  // reader most needs a way out of.
  //
  // **Where it points before the page id is known.** The artboard's action is
  // `openTripHomeDoc`, resolved when it is CLICKED rather than when it is
  // drawn, which is what lets it exist from the first frame. This is the same
  // thing spelled in hrefs: the Notebook index lists the Overview page, one
  // click further away and never wrong. The label is true of both — this is
  // not the placeholder §3b forbids, it is a real control whose destination
  // sharpens as the read lands.
  const pageId = state.status === "ready" || state.status === "unreadable" ? state.page.id : null;
  const openInNotebook = (
    <Link
      href={pageId === null ? `/trips/${tripId}/pages` : `/trips/${tripId}/pages/${pageId}`}
      className={cn(buttonVariants({ variant: "secondary", size: "touch" }), "no-underline")}
    >
      Edit in Notebook
    </Link>
  );

  const body = () => {
    if (state.status === "loading") {
      // The `ovBody` region (dc.html:1966-2013). The proportions are the
      // artboard's, and they are not arbitrary: a loading Overview should read
      // as a trip page — a title, a paragraph, a table of days, some cards —
      // rather than as a blank form.
      return (
        <SkeletonRegion className="flex flex-col gap-6" label="Loading the Overview">
          <div className="flex flex-col gap-2.5">
            <Skeleton className="h-5 w-2/5" />
            <Skeleton circle className="h-3 w-11/12" />
            <Skeleton circle className="h-3 w-10/12" />
            <Skeleton circle className="h-3 w-1/2" delay={2} />
          </div>
          <div className="overflow-hidden rounded-lg border border-hairline">
            {[0, 1, 2, 3].map((row) => (
              <div key={row} className="flex gap-3.5 border-b border-hairline px-3.5 py-3">
                <div className="flex w-34 flex-none flex-col gap-1.5">
                  <Skeleton circle className="h-2.5 w-20" delay={2} />
                  <Skeleton circle className="h-2 w-14" delay={2} />
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-1.5 pt-0.5">
                  <Skeleton circle className="h-2.5 w-10/12" delay={2} />
                  <Skeleton circle className="h-2.5 w-1/2" delay={3} />
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-2.5">
            <Skeleton className="h-5 w-1/3" delay={3} />
            {[0, 1, 2].map((card) => (
              <div key={card} className="flex items-center gap-3.5 rounded-lg border border-hairline px-3.5 py-3">
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <Skeleton circle className="h-3 w-2/5" delay={3} />
                  <Skeleton circle className="h-2 w-2/3" delay={3} />
                </div>
                <Skeleton circle className="h-2.5 w-16" delay={3} />
              </div>
            ))}
          </div>
        </SkeletonRegion>
      );
    }

    if (state.status === "error") {
      // §3b forbids a dead end: this had the message and NO control at all, so
      // a reader whose Overview failed to load could only leave the tab. The
      // retry re-runs the read in place, and the header above it stays.
      return (
        <RegionError
          title={state.message}
          note="Nothing was lost — the trip itself is fine, and the other tabs still work."
          onRetry={() => {
            setState({ status: "loading" });
            setAttempt((n) => n + 1);
          }}
          data-testid="overview-error"
        />
      );
    }

    if (state.status === "unreadable") {
      return (
        <Text variant="muted">
          Something newer is in this page than this app can show. Open it in the Notebook to see what is there.
        </Text>
      );
    }

    return (
      <PageEditor
        detail={detail}
        context={state.page.context}
        globals={globals ?? null}
        value={state.doc}
        // Reading mode never writes. The tab does not edit (§25), so there is
        // no change to carry anywhere and a no-op is the honest handler rather
        // than a missing prop.
        onChange={() => {}}
        editable={false}
      />
    );
  };

  return (
    <div className="flex flex-col gap-4 py-4">
      <div className="flex justify-end">{openInNotebook}</div>
      {body()}
    </div>
  );
}
