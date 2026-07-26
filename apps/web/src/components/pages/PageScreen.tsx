"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { DayRef, Page, PageContent, TripDetail } from "@tc/contracts";
import { fetchPage, updatePage } from "@/lib/pagesClient";
import { fetchTripDetail } from "@/lib/apiClient";
import { debounce } from "@/lib/debounce";
import { PageContainer } from "@/components/ui/page-container";
import { Heading } from "@/components/ui/heading";
import { PageEditor } from "@/components/pages/editor/PageEditor";
import { DayBindingControl, DAY_BINDING_SELECT_ID } from "@/components/pages/DayBindingControl";
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
// data) and wires `PageEditor`'s `value`/`onChange`/`onBindDay` to
// `pagesClient.updatePage` — content debounced, the day binding immediate
// (a discrete selection, not continuous typing).
export function PageScreen({ tripId, pageId }: { tripId: string; pageId: string }) {
  const [page, setPage] = useState<Page | null>(null);
  const [trip, setTrip] = useState<TripDetail | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
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
        <Link href={`/trips/${tripId}/pages`}>← Notebook</Link>
      </PageContainer>
    );
  }

  const handleContentChange = (content: PageContent) => {
    setPage((prev) => (prev === null ? prev : { ...prev, content }));
    saveContent(content);
  };

  const handleBindDay = (dayRef: DayRef | undefined) => {
    const context = { ...page.context, dayRef };
    setPage((prev) => (prev === null ? prev : { ...prev, context }));
    void updatePage(tripId, pageId, { context });
  };

  const focusDayBinding = () => {
    document.getElementById(DAY_BINDING_SELECT_ID)?.focus();
  };

  return (
    <PageContainer>
      <div className="mb-2">
        <Link href={`/trips/${tripId}/pages`} className="text-sm text-slate hover:text-ink">
          ← Notebook
        </Link>
      </div>
      <Heading level={2}>{page.title}</Heading>
      <div className="my-3">
        <DayBindingControl trip={trip} dayRef={page.context.dayRef} onChange={handleBindDay} />
      </div>
      <div className="mb-3">
        <ComposePanel tripId={tripId} surface="page" pageContext={page.context} onApply={handleContentChange} />
      </div>
      <PageEditor
        detail={trip}
        context={page.context}
        value={page.content}
        onChange={handleContentChange}
        onBindDay={focusDayBinding}
      />
    </PageContainer>
  );
}
