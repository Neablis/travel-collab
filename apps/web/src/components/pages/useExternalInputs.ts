"use client";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { TripWeather } from "@tc/contracts";
import type { ExternalInputs, ExternalNeed, NotebookIndex, Slot } from "@tc/pages";
import { fetchTripWeather } from "@/lib/apiClient";
import { fetchPages } from "@/lib/pagesClient";
import { cachedRead, DEDUPE } from "@/lib/queryCache";
import { tripKeys } from "@/lib/queryKeys";

const PENDING: Slot<TripWeather> = { state: "pending" };
const NOTEBOOKS_PENDING: Slot<NotebookIndex> = { state: "pending" };

// **The notebook list, re-read when this tab changes it.** A link card that
// adds the notebook it points at (`MissingNotebookBlock`) has moved the list
// under every other card on the page, and nothing else here would notice: the
// read below runs once per trip. A counter rather than the new list handed
// over, so there is still one read and one place that shapes it.
let notebooksRevision = 0;
const notebookListeners = new Set<() => void>();
const subscribeToNotebooks = (listener: () => void) => {
  notebookListeners.add(listener);
  return () => void notebookListeners.delete(listener);
};

/** Tell every mounted page that this trip's notebooks changed, after a write that added or removed one. */
export function notebooksChanged(): void {
  notebooksRevision++;
  for (const listener of notebookListeners) listener();
}

/**
 * The client half of ADR-052's slot: fetches what the page's widgets declare
 * they need, and hands it to every resolver as `WidgetContext.external`.
 *
 * **Asks only when a widget on the page names the input.** That is the rule
 * that keeps a trip's locations in the building for a notebook that shows no
 * weather: `needs` comes from `externalNeedsOf` over the live document, so the
 * request goes out once the document holds a weather widget and again when one
 * is inserted — never for a page without one.
 *
 * Any non-2xx or network error is `failed`, which the widget shows as
 * `unavailable("source")`: a 404 while T24's route does not exist yet reads the
 * same as MET not answering, and neither is the author's problem. No polling —
 * the as-of line says how old the data is, and reopening refreshes.
 */
export function useExternalInputs(tripId: string, needs: ReadonlySet<ExternalNeed>): ExternalInputs {
  const wantsWeather = needs.has("weather");
  // Keyed by the trip it was fetched for, so another trip reads `pending` on
  // its first render rather than this one's forecast until its own lands
  // (#223 review). A reset in the effect would still commit one render late.
  const [fetched, setFetched] = useState<{ tripId: string; slot: Slot<TripWeather> } | null>(null);
  const weather = fetched?.tripId === tripId ? fetched.slot : PENDING;

  useEffect(() => {
    if (!wantsWeather) return;
    let live = true;
    void cachedRead(tripKeys.weather(tripId), () => fetchTripWeather(tripId), {
      dedupeMs: DEDUPE.DOCUMENT,
    }).then((r) => {
      if (live) setFetched({ tripId, slot: r.ok ? { state: "ready", value: r.value } : { state: "failed" } });
    });
    return () => {
      live = false;
    };
  }, [tripId, wantsWeather]);

  // **The trip's notebooks, for a link card (ADR-056).** The same read, under
  // the same key, as the Overview tab and the Notebook index make — so a page
  // holding a link usually costs no request at all — and asked for only when a
  // widget on the page names it, like the weather.
  const wantsNotebooks = needs.has("notebooks");
  const revision = useSyncExternalStore(subscribeToNotebooks, () => notebooksRevision, () => 0);
  const [notebookList, setNotebookList] = useState<{ tripId: string; slot: Slot<NotebookIndex> } | null>(null);
  const notebooks = notebookList?.tripId === tripId ? notebookList.slot : NOTEBOOKS_PENDING;

  useEffect(() => {
    if (!wantsNotebooks) return;
    let live = true;
    void cachedRead(tripKeys.pages(tripId), () => fetchPages(tripId), { dedupeMs: DEDUPE.DOCUMENT }).then((r) => {
      if (!live) return;
      setNotebookList({
        tripId,
        slot: r.ok
          ? {
              state: "ready",
              value: {
                pages: r.value.pages.map((p) => ({
                  id: p.id,
                  seedKey: p.seedKey ?? null,
                  title: p.title,
                  firstLine: p.preview?.firstLine ?? null,
                  widgetCount: p.preview?.widgetCount ?? 0,
                })),
              },
            }
          : { state: "failed" },
      });
    });
    return () => {
      live = false;
    };
  }, [tripId, wantsNotebooks, revision]);

  return useMemo(() => ({ weather, notebooks }), [weather, notebooks]);
}
