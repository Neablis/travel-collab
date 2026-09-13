"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { PageDoc, PageSummary, TripDetail, TripGlobals } from "@tc/contracts";
import { isOverviewPage } from "@tc/pages";
import { fetchPage, fetchPages } from "@/lib/pagesClient";
import { fetchTripGlobals } from "@/lib/apiClient";
import { inspectStoredPageDoc } from "@/components/pages/editor/storedPageDoc";
import { PageEditor } from "@/components/pages/editor/PageEditor";
import { buttonVariants } from "@/components/ui/button";
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

  useEffect(() => {
    let live = true;
    void fetchTripGlobals(tripId).then((r) => {
      if (live && r.ok) setGlobals(r.value);
    });
    void (async () => {
      const list = await fetchPages(tripId);
      if (!live) return;
      if (!list.ok) return setState({ status: "error", message: "Couldn't load this trip's Overview." });
      const summary = list.value.pages.find((p: PageSummary) => isOverviewPage(p.context));
      // A trip whose Overview is genuinely absent: every trip seeded since
      // 2026-09-12 has one, and a trip that was seeded BEFORE it has the two
      // older prose pages instead and will never be re-seeded (`listPages`
      // seeds only into a trip with zero pages). That is a real state and it
      // gets a real answer rather than a spinner that never resolves.
      if (summary === undefined) return setState({ status: "error", message: "This trip has no Overview page." });
      const page = await fetchPage(tripId, summary.id);
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
  }, [tripId]);

  if (state.status === "loading") {
    return (
      <div className="py-10" role="status" aria-live="polite">
        <Text variant="muted">Loading the Overview…</Text>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="py-10">
        <Text variant="muted">{state.message}</Text>
      </div>
    );
  }

  const openInNotebook = (
    <Link
      href={`/trips/${tripId}/pages/${state.page.id}`}
      className={cn(buttonVariants({ variant: "secondary", size: "touch" }), "no-underline")}
    >
      Edit in Notebook
    </Link>
  );

  if (state.status === "unreadable") {
    return (
      <div className="flex flex-col items-start gap-3 py-10">
        <Text variant="muted">
          Something newer is in this page than this app can show. Open it in the Notebook to see what is there.
        </Text>
        {openInNotebook}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 py-4">
      <div className="flex justify-end">{openInNotebook}</div>
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
    </div>
  );
}
