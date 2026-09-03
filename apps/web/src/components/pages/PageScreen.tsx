"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import type { Page, PageDoc, TripDetail } from "@tc/contracts";
import { fetchPage, updatePage } from "@/lib/pagesClient";
import { fetchTripDetail } from "@/lib/apiClient";
import { debounce } from "@/lib/debounce";
import { PageContainer } from "@/components/ui/page-container";
import { Heading } from "@/components/ui/heading";
import { Banner } from "@/components/ui/banner";
import { PageEditor } from "@/components/pages/editor/PageEditor";
import { ReadOnlyPageDoc } from "@/components/pages/editor/ReadOnlyPageDoc";
import {
  inspectStoredPageDoc,
  toStoredPageDoc,
  type StoredPageDoc,
} from "@/components/pages/editor/storedPageDoc";
import { ComposePanel } from "@/components/pages/ai/ComposePanel";

type Status = "loading" | "ready" | "error";

// Debounce delay for content autosave. A `setTimeout`-based debounce (no
// existing utility in this repo — checked `lib/debounce.ts` didn't exist
// before adding it) is all this needs: keystrokes coalesce into one
// `updatePage` call ~1s after the user stops typing.
const AUTOSAVE_DELAY_MS = 800;

// Why this screen is the place ADR-038 decision 4 lives: it owns the autosave.
// The loss the ADR is about is not a bad migration, it is this component
// writing `getJSON()` back over a document the editor never understood, 800 ms
// after mounting it. The refusal has to happen before `PageEditor` renders,
// because by the time TipTap has fallen back to an empty document the content
// is already gone from memory.
//
// `Banner` rather than a hand-rolled box: it already carries `role="status"`
// and the palette's own `warning` tokens. The first draft of this used
// `bg-amber-50`, which renders as nothing at all — `globals.css` sets
// `--color-*: initial`, so Tailwind's default palette does not exist here.
function LockedNotice({ children }: { children: ReactNode }) {
  return <Banner variant="warning" className="mb-3">{children}</Banner>;
}

// Renders one page's editor. Fetches the page + the trip's detail (the same
// `fetchTripDetail` the board/lens system uses — pages don't need
// `TripProvider`'s optimistic-update machinery, they never write planning
// data) and wires `PageEditor`'s `value`/`onChange` to
// `pagesClient.updatePage`, debounced.
export function PageScreen({ tripId, pageId }: { tripId: string; pageId: string }) {
  const [page, setPage] = useState<Page | null>(null);
  const [trip, setTrip] = useState<TripDetail | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  // The verdict on the document AS LOADED, taken once. It is deliberately not
  // recomputed from `page.content` as the user types: the question decision 4
  // asks is "was the thing we were handed safe to open", and re-asking it of
  // the editor's own output would let a session that started locked silently
  // unlock itself the moment TipTap emitted a document we happen to like.
  const [stored, setStored] = useState<StoredPageDoc | null>(null);
  // Set when the editor hands back something `PageDoc` cannot parse. It latches
  // for the session: whatever produced one unstorable document will produce the
  // next one too, and a screen that resumes autosaving after a single refusal
  // is a screen that eventually writes one.
  const [unstorable, setUnstorable] = useState(false);

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
      setStored(inspectStoredPageDoc(pageResult.value.content));
      setTrip(tripResult.value);
      setStatus("ready");
    });
    return () => {
      cancelled = true;
    };
  }, [tripId, pageId]);

  const saveContent = useMemo(
    () =>
      debounce((content: PageDoc) => {
        void updatePage(tripId, pageId, { content });
      }, AUTOSAVE_DELAY_MS),
    [tripId, pageId],
  );
  const saveContentRef = useRef(saveContent);
  saveContentRef.current = saveContent;
  useEffect(() => () => saveContentRef.current.cancel(), []);

  if (status === "loading") return <PageContainer>Loading…</PageContainer>;
  if (status === "error" || page === null || trip === null || stored === null) {
    return (
      <PageContainer>
        <p role="alert">{error ?? "Something went wrong"}</p>
        <Link href={`/trips/${tripId}/pages`}>← Notebooks</Link>
      </PageContainer>
    );
  }

  // `getJSON()` in, a storable document out — or nothing written at all. The
  // parse is not a formality: it stamps `v` (decision 2) and it is the last
  // place a document the editor mangled can be stopped.
  const handleContentChange = (content: unknown) => {
    const storable = toStoredPageDoc(content);
    if (storable === null) {
      saveContent.cancel();
      setUnstorable(true);
      return;
    }
    setPage((prev) => (prev === null ? prev : { ...prev, content: storable }));
    saveContent(storable);
  };

  const backLink = (
    <div className="mb-2">
      <Link href={`/trips/${tripId}/pages`} className="text-sm text-slate hover:text-ink">
        ← Notebooks
      </Link>
    </div>
  );

  // Read-only, and every write path off: no autosave (nothing calls
  // `saveContent`), and no ComposePanel, because applying a composed document
  // would overwrite exactly the content we just refused to risk.
  if (stored.status !== "mountable") {
    return (
      <PageContainer>
        {backLink}
        <Heading level={2}>{page.title}</Heading>
        <div className="mb-3 mt-3">
          {stored.status === "unsupported" ? (
            <LockedNotice>
              This notebook uses something this version of the app doesn&apos;t know how to edit
              ({stored.unsupportedTypes.join(", ")}). You can read it here — editing is off so
              nothing gets overwritten. Reloading once the app updates should bring it back.
            </LockedNotice>
          ) : (
            <LockedNotice>
              This notebook is stored in a format this version of the app can&apos;t read, so
              it&apos;s locked to protect it. Nothing has been lost. Reloading once the app
              updates should bring it back.
            </LockedNotice>
          )}
        </div>
        {stored.status === "unsupported" ? <ReadOnlyPageDoc doc={stored.doc} /> : null}
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      {backLink}
      <Heading level={2}>{page.title}</Heading>
      {unstorable ? (
        <div className="mt-3">
          <LockedNotice>
            Your last change produced something this version of the app can&apos;t save, so saving
            has stopped to protect what&apos;s already here. Copy anything new before reloading.
          </LockedNotice>
        </div>
      ) : null}
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
        value={stored.doc}
        onChange={handleContentChange}
      />
    </PageContainer>
  );
}
