"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Page, PageContent, TripDetail, TripGlobals, UserPreferences } from "@tc/contracts";
import { fetchPage, updatePage } from "@/lib/pagesClient";
import { fetchTripDetail, fetchPreferences, fetchTripGlobals } from "@/lib/apiClient";
import { debounce } from "@/lib/debounce";
import { PageContainer } from "@/components/ui/page-container";
import { Heading } from "@/components/ui/heading";
import { PageEditor } from "@/components/pages/editor/PageEditor";
import { ComposePanel } from "@/components/pages/ai/ComposePanel";

type Status = "loading" | "ready" | "error";

// Debounce delay for content autosave. A `setTimeout`-based debounce (no
// existing utility in this repo — checked `lib/debounce.ts` didn't exist
// before adding it) is all this needs: keystrokes coalesce into one
// `updatePage` call ~1s after the user stops typing.
const AUTOSAVE_DELAY_MS = 800;

// Renders one page's editor. Fetches the page + the trip's detail (the same
// `fetchTripDetail` the board/lens system uses — pages don't need
// `TripProvider`'s optimistic-update machinery, they never write planning
// data) and wires `PageEditor`'s `value`/`onChange` to
// `pagesClient.updatePage`, debounced.
export function PageScreen({ tripId, pageId }: { tripId: string; pageId: string }) {
  const [page, setPage] = useState<Page | null>(null);
  const [trip, setTrip] = useState<TripDetail | null>(null);
  // The account, for account-scope widgets (ADR-037 open question 2). It is
  // fetched ALONGSIDE the page rather than gating it: a notebook that will not
  // open because a preferences request failed is a worse outcome than one
  // widget rendering "not set up", so a failure here leaves this `null` and the
  // page loads regardless. That is why it is not in the `Promise.all` below,
  // whose failures are page failures.
  const [user, setUser] = useState<UserPreferences | null>(null);
  // Same fail-soft rule as `user` above, and for the same reason.
  const [globals, setGlobals] = useState<TripGlobals | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchPreferences().then((r) => {
      if (!cancelled && r.ok) setUser(r.value);
    });
    void fetchTripGlobals(tripId).then((r) => {
      if (!cancelled && r.ok) setGlobals(r.value);
    });
    void Promise.all([fetchPage(tripId, pageId), fetchTripDetail(tripId)]).then(([pageResult, tripResult]) => {
      if (cancelled) return;
      if (!pageResult.ok) {
        setError(pageResult.error.message);
        setStatus("error");
        return;
      }
      if (!tripResult.ok) {
        setError(tripResult.error.message);
        setStatus("error");
        return;
      }
      setPage(pageResult.value);
      setTrip(tripResult.value);
      setStatus("ready");
    });
    return () => {
      cancelled = true;
    };
  }, [tripId, pageId]);

  const saveContent = useMemo(
    () =>
      debounce((content: PageContent) => {
        void updatePage(tripId, pageId, { content });
      }, AUTOSAVE_DELAY_MS),
    [tripId, pageId],
  );
  const saveContentRef = useRef(saveContent);
  saveContentRef.current = saveContent;
  useEffect(() => () => saveContentRef.current.cancel(), []);

  if (status === "loading") return <PageContainer>Loading…</PageContainer>;
  if (status === "error" || page === null || trip === null) {
    return (
      <PageContainer>
        <p role="alert">{error ?? "Something went wrong"}</p>
        <Link href={`/trips/${tripId}/pages`}>← Notebooks</Link>
      </PageContainer>
    );
  }

  const handleContentChange = (content: PageContent) => {
    setPage((prev) => (prev === null ? prev : { ...prev, content }));
    saveContent(content);
  };

  return (
    <PageContainer>
      <div className="mb-2">
        <Link href={`/trips/${tripId}/pages`} className="text-sm text-slate hover:text-ink">
          ← Notebooks
        </Link>
      </div>
      <Heading level={2}>{page.title}</Heading>
      {/* `mt-3` replaces the margin the day-binding control used to contribute.
          That control sat between the title and this panel in a `my-3` wrapper,
          so deleting it (SPEC §18 — a page has no scope) took the panel's only
          top margin with it: `Heading` computes `margin: 0`, and the panel's
          border ended up 1px under the title while the seams either side of it
          are 8px and 12px. Caught on the preview walk, not by any test — no
          layer we have asserts vertical rhythm. */}
      <div className="mb-3 mt-3">
        <ComposePanel tripId={tripId} pageId={pageId} onApply={handleContentChange} />
      </div>
      <PageEditor
        detail={trip}
        context={page.context}
        user={user}
        globals={globals}
        value={page.content}
        onChange={handleContentChange}
      />
    </PageContainer>
  );
}
