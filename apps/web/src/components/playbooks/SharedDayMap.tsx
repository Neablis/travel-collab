"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SavedStop } from "@tc/contracts";
import { createBaseMap } from "@/components/lenses/mapBootstrap";
import { mapPaintColor } from "@/components/lenses/mapColor";
import { MapOfflineState } from "@/components/lenses/MapOfflineState";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useDistanceUnit } from "@/components/account/PreferencesProvider";
import { cn } from "@/lib/cn";
import { useIsPhone } from "@/lib/useIsPhone";
import { isRideLeg, mapPanel, mapTitle, placesNote, type MapFact } from "./sharedDayFacts";
import {
  allLegs,
  allPoints,
  cityMarkers,
  geometryKey,
  mapShape,
  scopedGeometry,
  type CityMarker,
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
const ROUTE_RIDE = "shared-day-route-ride";
/** The focus card's width — `w-63` below. */
const FOCUS_CARD_PX = 252;

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
  // against Ledger's `data-look` block, which re-points `--color-brand`.
  el.className =
    "flex size-6.5 items-center justify-center rounded-full bg-brand text-xs font-semibold text-paper shadow-md";
  return el;
}

/**
 * A city the day happens in: a DISC, not a numbered pin — the same shape claim
 * `MapLens`'s `cityDiscElement` makes for a city-level stop. A pin's tip names
 * one spot and a number names one stop; a city centre is neither.
 */
function cityElement(marker: CityMarker): HTMLElement {
  const el = document.createElement("div");
  el.dataset.testid = "shared-day-city";
  el.dataset.city = marker.city;
  el.title = `${marker.city} · ${marker.stops} stop${marker.stops === 1 ? "" : "s"}`;
  el.className = "flex size-12 items-center justify-center rounded-full border-2 border-brand bg-brand/15";
  const dot = document.createElement("span");
  dot.className = "size-2 rounded-full bg-brand";
  el.appendChild(dot);
  return el;
}

/** An outline pin, for the empty frame. Inline so it takes `currentColor` — a token — and nothing else. */
function PinGlyph() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="size-7">
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" strokeLinejoin="round" />
      <circle cx="12" cy="10" r="2.25" />
    </svg>
  );
}

/**
 * The empty frame's words (M27 link 10). The heading is the Map lens's own
 * (`MapLens.tsx`, the artboard's `emptyMapCanvas`); its body is not, because
 * that one tells an editor to go and add a stop, and a Playbook's reader has
 * no stop to add. This line is Mitchell's, asked for in place of "No locations
 * in this playbook".
 */
const EMPTY_TITLE = "Nothing to map yet";
const EMPTY_BODY = "None of these stops has a place pinned to it, so there's no route to draw.";

export function SharedDayMap({
  savedDayId,
  days,
  scope,
  pinning = false,
}: {
  savedDayId: string;
  days: readonly { dayIndex: number; stops: readonly SavedStop[] }[];
  /** `"all"`, or the 0-based day the reader has scoped to (§33.1). */
  scope: "all" | number;
  /**
   * The server is placing this day's stops right now (`savedDayPinBackfill`),
   * so an empty frame is loading rather than empty.
   */
  pinning?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Awaited<ReturnType<typeof createBaseMap>>>(null);
  const markersRef = useRef<import("maplibre-gl").Marker[]>([]);
  const [failed, setFailed] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  // **The pins take their numbers from whatever the LIST is showing**, and the
  // list changes its mind with the scope: `SharedDayScreen` renders
  // `dayScope === "all" ? stop.number : group.stops.indexOf(stop) + 1`, so
  // `All days` counts through the whole Playbook and a single day restarts at 1
  // (§33.1).
  //
  // `scopedGeometry` owns that rule now, because the stop list reads its leg
  // lines from the same call. This used to read `playbookGeometry(days)`
  // unconditionally, with a comment claiming the list never restarts. It does.
  // On a two-day Playbook scoped to Day 2 the list showed 1, 2 beside pins
  // 3, 4 — the "pin 4 beside the list's stop 5"
  // failure `sharedDayGeometry.ts` was written to prevent, reintroduced by its
  // own consumer. Caught by CodeRabbit on PR 196; the test that should have
  // caught it was asserting the wrong numbers.
  const scoped = useMemo(() => scopedGeometry(days, scope), [days, scope]);
  const cities = useMemo(() => cityMarkers(days, scope), [days, scope]);
  const shape = mapShape(scoped, cities);
  const drawable = shape !== "none";
  const key = geometryKey(savedDayId, scope, scoped, cities);

  // **The panel's words** — link 4b, `dc.html:7495-7527`. Up here with the
  // other hooks for the reason the file already gives twice: everything past
  // the early returns below runs conditionally.
  const unit = useDistanceUnit();
  const panel = useMemo(() => mapPanel(scoped, unit), [scoped, unit]);
  // The cities of the stops in view, in order. `sharedDayGeometry` drops
  // `city` (a map needs coordinates, not names), so this reads the stops
  // rather than the geometry.
  const title = useMemo(
    () =>
      mapTitle(
        (scope === "all" ? days : days.filter((d) => d.dayIndex === scope)).flatMap((d) =>
          d.stops.map((st) => st.location?.city ?? ""),
        ),
      ),
    [days, scope],
  );

  // **Phone: the route sits behind a "Show route" row** (`dc.html:1196-1226`),
  // because at 390px a 260px map is most of the first screen and the stops are
  // what somebody opened the day to read. The CONTAINER is not mounted until it
  // is opened, rather than mounted and hidden: a MapLibre map in a hidden box
  // measures 0x0 and paints nothing when it is shown (the tile-cover bug
  // `mapBootstrap` already paid for once). `mounted` is in the effect's deps,
  // so opening the row builds the map and closing it disposes of it.
  const isPhone = useIsPhone();
  const [routeOpen, setRouteOpen] = useState(false);
  const mounted = !isPhone || routeOpen;

  const retry = useCallback(() => {
    setFailed(false);
    setRetryNonce((n) => n + 1);
  }, []);

  // Every hook above runs unconditionally, and the frame renders in every
  // state below. It used to `return null` below two located stops (§16's
  // list-only degrade); M27 link 10 retired that, and Mitchell's follow-up
  // rules out any state that changes the frame's height, so the page never
  // reflows when the map arrives, fails or has nothing to show.
  useEffect(() => {
    const el = containerRef.current;
    if (el === null || !drawable || failed || !mounted) return;

    let cancelled = false;
    const first = allPoints(scoped)[0] ?? cities[0]!;

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
        markersRef.current = [
          // Cities only when there is no route: under a route they would be a
          // second, vaguer answer to "where" drawn beside the precise one.
          ...(shape === "places" ? cities : []).map((city) =>
            new base.Marker({ element: cityElement(city) }).setLngLat([city.lng, city.lat]).addTo(base.map),
          ),
          ...points.map((point) =>
            new base.Marker({ element: pinElement(point) })
              .setLngLat([point.lng, point.lat])
              .addTo(base.map),
          ),
        ];

        if (base.map.getLayer(ROUTE_SOLID)) base.map.removeLayer(ROUTE_SOLID);
        if (base.map.getLayer(ROUTE_GAPPED)) base.map.removeLayer(ROUTE_GAPPED);
        if (base.map.getLayer(ROUTE_RIDE)) base.map.removeLayer(ROUTE_RIDE);
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
              // A ride is DOTTED — the legend's "By train or taxi" — and it
              // is the same `isRideLeg` the panel's numbers are summed with,
              // so a dotted line and a "By train or taxi" row cannot disagree.
              properties: { contiguous: leg.contiguous, ride: leg.contiguous && isRideLeg(leg) },
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
          filter: ["all", ["==", ["get", "contiguous"], true], ["==", ["get", "ride"], false]],
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": color, "line-width": 3, "line-opacity": 0.85 },
        });
        base.map.addLayer({
          id: ROUTE_RIDE,
          type: "line",
          source: ROUTE_SOURCE,
          filter: ["==", ["get", "ride"], true],
          layout: { "line-cap": "round", "line-join": "round" },
          // A near-zero dash with round caps is how MapLibre draws dots.
          paint: { "line-color": color, "line-width": 3, "line-opacity": 0.85, "line-dasharray": [0.1, 2] },
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
        const framed = shape === "places" ? [...points, ...cities] : points;
        const bounds = framed.reduce(
          (acc, p) => acc.extend([p.lng, p.lat] as [number, number]),
          new base.LngLatBounds([first.lng, first.lat], [first.lng, first.lat]),
        );
        // On a desktop the focus card covers the bottom-left 252px, so the
        // route is fitted into what is left rather than drawn under the card.
        const padding = isPhone ? 40 : { top: 56, right: 56, bottom: 56, left: 56 + FOCUS_CARD_PX };
        // A city alone is framed as a city — street level on its centroid
        // would be a close-up of a point that is not anywhere in particular.
        const maxZoom = shape === "places" && points.length === 0 ? 11 : 15;
        base.map.fitBounds(bounds, { padding, maxZoom, duration: 0 });
      };

      if (base.map.isStyleLoaded()) draw();
      else base.map.once("load", draw);
    }).catch(() => {
      // `createBaseMap` can reject before any map exists — the dynamic
      // `import("maplibre-gl")` can fail on a flaky network or a blocked chunk,
      // and the `Map` constructor itself throws when WebGL is unavailable.
      // Without this the rejection was unhandled AND the reader was left with a
      // blank framed box rather than the offline state that already exists for
      // exactly this case. `onFatalError` only ever fires on a LIVE map, so it
      // could not cover the map that never got built.
      if (!cancelled) setFailed(true);
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
  }, [key, drawable, failed, retryNonce, scoped, cities, shape, mounted, isPhone]);

  const pins = allPoints(scoped).length;
  const mapLabel =
    shape === "route"
      ? `Map of ${pins} located stops`
      : pins === 0
        ? `Map of ${cities.map((c) => c.city).join(", ")}`
        : "Map of 1 located stop";
  const heading = title !== "" ? title : "The route";
  const loading = !drawable && pinning;
  const note =
    shape === "route" ? panel.note : shape === "places" ? placesNote(pins) : loading ? "Placing the stops on the map…" : EMPTY_TITLE;

  // **What the frame holds when there is no map to draw in it** — the same box
  // either way, so neither state moves the page. Loading is the moss ground the
  // map itself paints on, pulsing, so the map arriving is a picture appearing
  // rather than a box changing.
  const placeholder = loading ? (
    <div
      role="status"
      aria-label="Placing the stops on the map"
      className="size-full animate-pulse bg-moss"
      data-testid="shared-day-map-loading"
    />
  ) : (
    <div className="flex size-full items-center justify-center bg-paper p-4" data-testid="shared-day-map-empty">
      <EmptyState icon={<PinGlyph />} title={EMPTY_TITLE} body={EMPTY_BODY} />
    </div>
  );

  if (isPhone) {
    return (
      <div className="overflow-hidden rounded-xl border border-hairline bg-surface" data-testid="shared-day-map-panel">
        <Button
          variant="ghost"
          aria-expanded={routeOpen}
          onClick={() => setRouteOpen((open) => !open)}
          className="h-auto min-h-12 w-full justify-start gap-2.5 rounded-none px-3.5 text-left"
          data-testid="shared-day-route-toggle"
        >
          <span aria-hidden className="size-2.5 shrink-0 rounded-full bg-brand" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-ink">{heading}</span>
            <span className="block truncate text-2xs text-slate">{note}</span>
          </span>
          <span className="text-xs font-semibold text-brand">{routeOpen ? "Hide route" : "Show route"}</span>
        </Button>
        {/* The same one-frame rule as the desktop, at the phone's height. */}
        {routeOpen && (
          <>
            <div className="relative h-65 border-t border-hairline bg-moss" data-testid="shared-day-map-frame">
              {!drawable ? (
                placeholder
              ) : failed ? (
                <div className="size-full" data-testid="shared-day-map-offline">
                  <MapOfflineState onRetry={retry} />
                </div>
              ) : (
                <div
                  ref={containerRef}
                  data-testid="shared-day-map"
                  className="size-full"
                  role="img"
                  aria-label={mapLabel}
                />
              )}
            </div>
            {drawable && !failed && shape === "route" && (
              <MapFacts facts={panel.facts} className="border-t border-hairline px-3.5 py-3" />
            )}
          </>
        )}
      </div>
    );
  }

  // **One frame for every state** — the map, a failure, loading, or nothing to
  // place — so no state change moves the page (Mitchell, M27 link 10). The
  // offline state used to be its own box, sized to match "or the page reflows
  // every time the map fails or recovers"; the loading and empty states are the
  // same argument, so the box is now written once and they all sit inside it.
  //
  // `relative` so `MapOfflineState`'s `absolute inset-0` resolves against THIS
  // element. Without a positioning context it resolved against whatever
  // ancestor happened to be positioned — covering unrelated page content while
  // the wrapper collapsed to zero height.
  //
  // `dc.html:2718-2742` for the drawn map: the focus card over the frame's
  // bottom-left corner and the legend over its top-right. The panel sits ON the
  // map rather than under it, so the numbers are read against the line they
  // describe.
  return (
    <div
      className="relative h-86 w-full overflow-hidden rounded-xl border border-hairline bg-moss"
      data-testid="shared-day-map-frame"
    >
      {!drawable ? (
        placeholder
      ) : failed ? (
        <div className="size-full" data-testid="shared-day-map-offline">
          <MapOfflineState onRetry={retry} />
        </div>
      ) : (
        <>
          {/* No conditional between the frame and the container once it is drawn:
              a React conditional there detaches the node mid-style-load and the
              load aborts with no error (DRIFT §6 build-check 5, on its third
              recurrence). */}
          <div ref={containerRef} data-testid="shared-day-map" className="size-full" role="img" aria-label={mapLabel} />
          <div
            className="absolute bottom-4 left-4 z-10 w-63 rounded-lg border border-hairline bg-surface px-3.5 pt-3 pb-3.5 shadow-overlay"
            data-testid="shared-day-map-panel"
          >
            <div className="flex items-center gap-2">
              <span aria-hidden className="size-2.5 shrink-0 rounded-full bg-brand" />
              <p className="text-sm font-bold text-ink">{heading}</p>
            </div>
            {shape === "route" && <MapFacts facts={panel.facts} className="mt-2" />}
            <p className="mt-2 text-xs text-pretty text-slate">{note}</p>
          </div>
          {/* A key only to what is drawn: "On foot" over a map with no line would
              be a key to nothing, so a places map keys its city discs instead —
              and a lone numbered pin needs no key at all. */}
          {(shape === "route" || cities.length > 0) && (
            <div
              className="absolute top-4 right-4 z-10 flex items-center gap-3.5 rounded-full border border-hairline bg-surface px-3.5 py-1.5 text-2xs text-slate"
              data-testid="shared-day-map-legend"
            >
              {shape === "route" ? (
                <>
                  <span className="flex items-center gap-1.5">
                    <span aria-hidden className="h-0.75 w-4 rounded-xs bg-brand" />
                    On foot
                  </span>
                  {panel.hasRides && (
                    <span className="flex items-center gap-1.5">
                      <span aria-hidden className="w-4 border-t-3 border-dotted border-brand" />
                      By train or taxi
                    </span>
                  )}
                </>
              ) : (
                <span className="flex items-center gap-1.5">
                  <span aria-hidden className="size-3 rounded-full border-2 border-brand bg-brand/15" />
                  Somewhere in this city
                </span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** The walk / ride / span rows — one list for the focus card and the phone panel alike. */
function MapFacts({ facts, className }: { facts: readonly MapFact[]; className?: string }) {
  return (
    <dl className={cn("flex flex-col gap-1", className)}>
      {facts.map((fact) => (
        <div key={fact.key} className="flex items-baseline justify-between gap-2.5">
          <dt className="text-xs text-slate">{fact.key}</dt>
          <dd className="text-right font-mono text-xs text-ink">{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}
