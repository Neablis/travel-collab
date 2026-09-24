"use client";
import { useEffect, useMemo, useState } from "react";
import type { TripWeather } from "@tc/contracts";
import type { ExternalInputs, ExternalNeed, Slot } from "@tc/pages";
import { fetchTripWeather } from "@/lib/apiClient";
import { cachedRead, DEDUPE } from "@/lib/queryCache";
import { tripKeys } from "@/lib/queryKeys";

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
  const [weather, setWeather] = useState<Slot<TripWeather>>({ state: "pending" });

  useEffect(() => {
    if (!wantsWeather) return;
    let live = true;
    void cachedRead(tripKeys.weather(tripId), () => fetchTripWeather(tripId), {
      dedupeMs: DEDUPE.DOCUMENT,
    }).then((r) => {
      if (live) setWeather(r.ok ? { state: "ready", value: r.value } : { state: "failed" });
    });
    return () => {
      live = false;
    };
  }, [tripId, wantsWeather]);

  return useMemo(() => ({ weather }), [weather]);
}
