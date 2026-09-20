"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SavedStop } from "@tc/contracts";
import { createBaseMap } from "@/components/lenses/mapBootstrap";
import { mapPaintColor } from "@/components/lenses/mapColor";
import { MapOfflineState } from "@/components/lenses/MapOfflineState";
import {
  allLegs,
  allPoints,
  geometryKey,
  playbookGeometry,
  worthDrawing,
  type MapPoint,
} from "./sharedDayGeometry";

// SPEC §16 — **a shared day is a map plus a list**, and until now it was only
// ever the list. `sharedDayGeometry.ts` was written for this and then had no
// production consumer at all: the pure half shipped, the half that draws did
// not (found by Mitchell walking the preview, 2026-09-20).
//
// This is deliberately NOT `MapLens`. That component is the trip editor's map —
// welded to `TripDetail`, `useEditor` and `FocusProvider`, carrying
// double-click-to-create, a day rail, a focus card and a legend, none of which
// a read-only shared day has any use for. What the two genuinely share is the
// MapLibre bootstrap, and that now lives in `mapBootstrap.ts` precisely so this
// file cannot re-acquire the four bugs already paid for there.

const ROUTE_SOURCE = "shared-day-route";
const ROUTE_SOLID = "shared-day-route-solid";
const ROUTE_GAPPED = "shared-day-route-gapped";

// **Only the route line needs converting.** A MapLibre paint property takes a
// colour STRING — it cannot resolve `var(--color-brand)` — and MapLibre parses
// CSS Color 3 only, rendering anything else black in silence, so the token goes
// through `mapPaintColor` (KI-2026-09-19-f). The pins below are ordinary DOM
// elements in the page, where `var()` resolves normally and none of this
// applies; that asymmetry is the whole reason the pins are DOM and not
// `new Marker({ color })`.
function routeColor(): string {
  return mapPaintColor(getComputedStyle(document.documentElement).getPropertyValue("--color-brand"));
}

/**
 * A numbered pin, built as a DOM element rather than `new Marker({ color })`.
 *
 * The number is the whole reason: a reader's question at a map is "which of
 * these is stop 4", and a plain teardrop cannot answer it. The numbers are the
 * LIST's numbers (`playbookDays` assigns them across the whole Playbook), so a
 * pin and its row always agree — including under `All days`, where day 2 starts
 * at 5 because day 1 held four stops.
 */
function pinElement(point: MapPoint): HTMLElement {
  const el = document.createElement("div");
  el.dataset.testid = "shared-day-pin";
  el.dataset.stopNumber = String(point.number);
  el.title = point.title;
  el.textContent = String(point.number);
  // Tailwind classes, not inline colour: this element is in the page, so the
  // tokens resolve exactly as they do in JSX. The route's converted hex is
  // deliberately NOT threaded in here — a pin that took it would be the one
  // place a token reached the DOM already flattened, and it would go stale
  // against the `data-look` overrides that re-point `--color-brand`.
  el.className =
    "flex size-6.5 items-center justify-center rounded-full bg-brand text-xs font-semibold text-paper shadow-md";
  return el;
}

export function SharedDayMap({
  savedDayId,
  days,
  scope,
}: {
  savedDayId: string;
  days: readonly { dayIndex: number; stops: readonly SavedStop[] }[];
  /** `"all"`, or the 0-based day the reader has scoped to (§33.1). */
  scope: "all" | number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Awaited<ReturnType<typeof createBaseMap>>>(null);
  const markersRef = useRef<import("maplibre-gl").Marker[]>([]);
  const [failed, setFailed] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  // **Numbering is continuous across the whole Playbook in every scope**,
  // because that is what the list does — `playbookDays` numbers with a running
  // counter and never restarts it. A map that renumbered from 1 inside a day
  // would put pin 1 beside the list's row 5.
  const geometry = useMemo(() => playbookGeometry(days), [days]);
  const scoped = useMemo(
    () => (scope === "all" ? geometry : geometry.filter((g) => g.dayIndex === scope)),
    [geometry, scope],
  );
  const drawable = worthDrawing(scoped);
  const key = geometryKey(savedDayId, scope, scoped);

  const retry = useCallback(() => {
    setFailed(false);
    setRetryNonce((n) => n + 1);
  }, []);

  // Every hook above runs unconditionally — the "nothing to draw" return is at
  // the bottom of this component, not here. A `return null` placed before a
  // hook is how the rules-of-hooks crash gets written, and this component has
  // two perfectly ordinary reasons to bail (too few located stops, a dead map).
  useEffect(() => {
    const el = containerRef.current;
    if (el === null || !drawable || failed) return;

    let cancelled = false;
    const first = allPoints(scoped)[0]!;

    void createBaseMap({
      container: el,
      center: [first.lng, first.lat],
      zoom: 11,
      onFatalError: () => setFailed(true),
      cancelled: () => cancelled,
    }).then((base) => {
      if (base === null) return;
      if (cancelled) {
        base.dispose();
        return;
      }
      mapRef.current = base;
      const color = routeColor();

      const draw = () => {
        if (cancelled) return;
        const points = allPoints(scoped);
        const legs = allLegs(scoped);

        markersRef.current.forEach((m) => m.remove());
        markersRef.current = points.map((point) =>
          new base.Marker({ element: pinElement(point) })
            .setLngLat([point.lng, point.lat])
            .addTo(base.map),
        );

        if (base.map.getLayer(ROUTE_SOLID)) base.map.removeLayer(ROUTE_SOLID);
        if (base.map.getLayer(ROUTE_GAPPED)) base.map.removeLayer(ROUTE_GAPPED);
        if (base.map.getSource(ROUTE_SOURCE)) base.map.removeSource(ROUTE_SOURCE);

        base.map.addSource(ROUTE_SOURCE, {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: legs.map((leg) => ({
              type: "Feature" as const,
              // A leg that skipped an unlocated stop is drawn DASHED, because
              // the line between its ends is a guess about a route that missed
              // something out — not a leg anybody walked.
              properties: { contiguous: leg.contiguous },
              geometry: {
                type: "LineString" as const,
                coordinates: [
                  [leg.from.lng, leg.from.lat],
                  [leg.to.lng, leg.to.lat],
                ],
              },
            })),
          },
        });
        base.map.addLayer({
          id: ROUTE_SOLID,
          type: "line",
          source: ROUTE_SOURCE,
          filter: ["==", ["get", "contiguous"], true],
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": color, "line-width": 3, "line-opacity": 0.85 },
        });
        base.map.addLayer({
          id: ROUTE_GAPPED,
          type: "line",
          source: ROUTE_SOURCE,
          filter: ["==", ["get", "contiguous"], false],
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": color, "line-width": 3, "line-opacity": 0.5, "line-dasharray": [1.5, 1.5] },
        });

        // Unlike the trip map, fitting on load is right here: a shared day is
        // read, not edited, so "show me the whole thing" is the only camera
        // anybody wants, and there is no focus change to reserve it for.
        const bounds = points.reduce(
          (acc, p) => acc.extend([p.lng, p.lat] as [number, number]),
          new base.LngLatBounds([first.lng, first.lat], [first.lng, first.lat]),
        );
        base.map.fitBounds(bounds, { padding: 56, maxZoom: 15, duration: 0 });
      };

      if (base.map.isStyleLoaded()) draw();
      else base.map.once("load", draw);
    });

    return () => {
      cancelled = true;
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      mapRef.current?.dispose();
      mapRef.current = null;
    };
    // `key` carries the scope AND the points, so switching to a day the reader
    // has already seen still redraws. Keying on `scoped` alone would compare a
    // fresh array by identity and redraw on every render instead.
  }, [key, drawable, failed, retryNonce, scoped]);

  // §16: below two located stops the surface degrades to LIST-ONLY. One pin on
  // a world map tells a reader less than the city name already in the list.
  if (!drawable) return null;

  if (failed) {
    return (
      <div className="mb-6" data-testid="shared-day-map-offline">
        <MapOfflineState onRetry={retry} />
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      data-testid="shared-day-map"
      className="mb-6 h-72 w-full overflow-hidden rounded-lg border border-hairline md:h-96"
      role="img"
      aria-label={`Map of ${allPoints(scoped).length} located stops`}
    />
  );
}
