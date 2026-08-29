"use client";

import { useEffect, useRef, useState } from "react";
import type { TripDetail } from "@tc/contracts";
import { Text } from "../ui/text";
import { Button } from "../ui/button";
import { useEditor } from "../trip/context/EditorHost";
import { useFocus } from "../trip/context/FocusProvider";
import { activityPins, unlocatedActivities } from "./mapData";
import { mapDays, routeLine, type MapDay } from "./mapRailData";
import { MAP_RAIL_INSET_PX, MAP_RAIL_WIDTH_PX, MapRail } from "./MapRail";
import { MapFocusCard } from "./MapFocusCard";
import { MapLegend } from "./MapLegend";

// Handoff `current/…dc.html:630-668`: the muted "positron" basemap so the
// day accents (routes, markers) are the only colour that carries meaning —
// the old "liberty" style's own colourful landuse/POI fills competed with them.
const STYLE_URL = "https://tiles.openfreemap.org/styles/positron";

function accentVar(accent: MapDay["accent"]): string {
  return getComputedStyle(document.documentElement).getPropertyValue(`--color-${accent}`).trim();
}

// The neutral tone a non-focused day's route line shifts to — keeping its
// own accent hue at reduced opacity read as "still colourful", not
// "ghosted", once checked live. A shared grey (matching the legend's own
// "rest of trip" swatch) reads as de-emphasized the way the focused day's
// pins already do.
function ghostRouteColor(): string {
  return getComputedStyle(document.documentElement).getPropertyValue("--color-slate").trim();
}

function layerIdFor(dayId: string): string {
  return `route-${dayId}`;
}

export function MapLens({
  detail,
  onSelectActivity,
  readOnly = false,
}: {
  detail: TripDetail;
  onSelectActivity?: (activityId: string) => void;
  /** A viewer's map: double-clicking the canvas creates nothing. Everything
      else here is read — the routes, the pins, the rail, and the marker click
      that opens a stop (the editor sheet presents read-only for a viewer —
      ActivityEditorSheet). See Board.tsx's own `readOnly` note for why the
      client gate is defence in depth rather than the security boundary. */
  readOnly?: boolean;
}) {
  const { openCreate } = useEditor();
  const { focusedDay, setFocusedDay } = useFocus();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);
  const [ready, setReady] = useState(false);
  const LngLatBoundsRef = useRef<typeof import("maplibre-gl").LngLatBounds | null>(null);
  // Keyed by MapDay.index, so the focus effect below can ghost/un-ghost a
  // day's pins the same way it dims/undims that day's route line — populated
  // once in the "load" handler's marker loop, read (never mutated in place)
  // by the focus effect. Backlog-located pins (belong to no day) are never
  // added here, so they're structurally excluded from ghosting.
  const markersByDayRef = useRef<Map<number, import("maplibre-gl").Marker[]>>(new Map());
  const pins = activityPins(detail);
  // activityPins includes backlog-located stops (dayId: null) for callers
  // that need the full set; this lens draws day-attached stops only (see the
  // marker loop below), so mount/centring/the empty-state check must all key
  // off this filtered list too — a backlog pin sorting first used to center
  // the map on (or, if it was the only pin, render a live map for) an
  // activity the map deliberately never plots.
  const plottedPins = pins.filter((p) => p.dayId !== null);
  const unlocated = unlocatedActivities(detail);
  const days = mapDays(detail);
  const focusedMapDay = focusedDay !== null ? (days[focusedDay] ?? null) : null;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const firstPin = plottedPins[0];
    if (!firstPin) return;
    const el = containerRef.current;
    if (!el) return;

    let cancelled = false;
    let map: import("maplibre-gl").Map | undefined;
    let resizeObserver: ResizeObserver | undefined;

    import("maplibre-gl").then(({ Map, Marker, LngLatBounds }) => {
      if (cancelled || !el) return;
      LngLatBoundsRef.current = LngLatBounds;

      map = new Map({
        container: el,
        style: STYLE_URL,
        // A static initial view (the first located pin, unweighted by day) —
        // never a fitBounds() call here. fitBounds is reserved entirely for
        // responding to a real focus change below; calling it on mount too
        // would be indistinguishable from "the whole trip" being the focused
        // day, which it isn't.
        // zoom 9, not 10 (Mitchell, preview review, 2026-08-25): the rail
        // sits over the map's left edge regardless of zoom, so a pin
        // centered under it at mount is still hidden — one notch further out
        // gives more of the frame around the center point a fighting chance
        // of clearing the rail's ~284px, without abandoning "static, not
        // fitBounds" for this first paint.
        center: [firstPin.lng, firstPin.lat],
        zoom: 9,
      });
      mapRef.current = map;

      // maplibre computes which tiles it needs from the container's size at
      // the moment it evaluates its internal tile cover — reading that size
      // before this container's own layout has settled leaves it thinking a
      // 0×0 viewport needs zero tiles, and (confirmed live: sources register
      // but every "sourcedata" event stays isSourceLoaded:false forever,
      // "load" never fires) its own ResizeObserver-based recovery doesn't
      // reliably kick it loose on its own here. A real OS-level window
      // resize does unstick it — proof the fix is exactly "tell it to
      // measure again" — so do that ourselves instead of hoping a real
      // resize happens to occur, and keep doing it for the container's
      // whole lifetime (the assistant rail toggling, or an actual window
      // resize, both change this element's real size later too).
      resizeObserver = new ResizeObserver(() => map?.resize());
      resizeObserver.observe(el);

      // The "liberty"-era POI layers referenced sprite icons that don't
      // always resolve; without a fallback, maplibre logs a console error
      // per missing id. A blank placeholder silences this — the icon slot
      // just renders empty, which is already the effective behavior when
      // this fires. Kept for "positron" too: no guarantee every future style
      // swap ships every referenced sprite.
      map.on("styleimagemissing", (e: { id: string }) => {
        if (map?.hasImage(e.id)) return;
        map?.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) });
      });

      // Double-click-to-create is this lens's only write affordance, so a
      // viewer's map never registers the handler at all — openCreate would
      // otherwise raise the editor sheet in create mode, which for a viewer
      // presents as an empty read-only panel: a control that appears to do
      // something and does nothing.
      if (!readOnly) {
        map.on("dblclick", (e: import("maplibre-gl").MapMouseEvent) => {
          const { lng, lat } = e.lngLat;
          openCreate({
            location: { name: `${lat.toFixed(4)}, ${lng.toFixed(4)}`, lat, lng },
          });
        });
      }

      map.on("load", () => {
        if (cancelled || !map) return;

        // One line source+layer per day with 2+ located stops. Sources and
        // layers must not be touched before "load" fires — the style isn't
        // ready synchronously after `new Map(...)`.
        for (const day of days) {
          if (day.stops.length < 2) continue;
          const id = layerIdFor(day.dayId);
          map.addSource(id, {
            type: "geojson",
            data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: routeLine(day) } },
          });
          map.addLayer({
            id,
            type: "line",
            source: id,
            paint: {
              "line-color": accentVar(day.accent),
              "line-width": 3,
              // No focused day yet on first paint (see the focus effect
              // below for what happens once one is picked) — every route
              // draws at full strength until a focus dims the others.
              "line-opacity": 1,
            },
          });
        }

        // Day-attached located stops only (Mitchell, preview review,
        // 2026-08-25: "dont plot locations that arent attached to a day,
        // anything unscheduled isnt on the map"). A backlog activity with a
        // location used to get a neutral-brand marker here too; that loop is
        // gone — the map no longer plots anything that isn't on a day.
        for (const day of days) {
          const dayMarkers: import("maplibre-gl").Marker[] = [];
          for (const stop of day.stops) {
            const marker = new Marker(accentVar(day.accent) ? { color: accentVar(day.accent) } : undefined)
              .setLngLat([stop.lng, stop.lat])
              .addTo(map);
            if (onSelectActivity) {
              marker.getElement().addEventListener("click", () => onSelectActivity(stop.activityId));
              marker.getElement().style.cursor = "pointer";
            }
            marker.getElement().style.transition = "opacity 150ms";
            dayMarkers.push(marker);
          }
          markersByDayRef.current.set(day.index, dayMarkers);
        }

        setReady(true);
      });
    });

    return () => {
      cancelled = true;
      setReady(false);
      mapRef.current = null;
      markersByDayRef.current = new Map();
      resizeObserver?.disconnect();
      if (typeof window !== "undefined") {
        map?.remove();
      }
    };
    // `readOnly` is in the deps because the dblclick handler above is
    // registered once, inside this effect: without it, a map mounted before
    // the access read resolves would keep the editor's handler after the
    // answer came back "viewer".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plottedPins.map((p) => `${p.activityId}:${p.lat}:${p.lng}`).join(","), onSelectActivity, openCreate, readOnly]);

  // Focus-driven camera + opacity, kept separate from the creation effect
  // above so clicking a rail day never tears down and rebuilds the whole map
  // instance — only the camera and each layer's line-opacity change.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;

    for (const day of days) {
      const focused = focusedDay === null || day.index === focusedDay;

      if (day.stops.length >= 2) {
        const layerId = layerIdFor(day.dayId);
        // Ghosting a non-focused route is two changes together: a lower
        // opacity floor than pins get (a thin line reads even fainter than a
        // pin at the same opacity, so it needs to drop further — tuned live
        // against the marker ghosting below) AND a shift off the day's own
        // accent hue to a shared neutral, since the accent hue alone at
        // reduced opacity still read as "that day's colour, just fainter"
        // rather than genuinely de-emphasized.
        map.setPaintProperty(layerId, "line-opacity", focused ? 1 : 0.25);
        map.setPaintProperty(layerId, "line-color", focused ? accentVar(day.accent) : ghostRouteColor());
      }

      // Pins read smaller than a route line and sit on a coloured basemap, so
      // they need more contrast to still register as "de-emphasized" — a
      // lower floor than the route lines' 0.55.
      //
      // Marker#setOpacity, not element.style.opacity directly: maplibre's own
      // Marker class re-applies its internal _opacity to the DOM element on
      // every map render (moveend/render events, e.g. from the fitBounds()
      // camera jump or a setPaintProperty-triggered repaint below) via a
      // private _updateOpacity() handler — confirmed live, a direct style
      // write visibly took effect for a frame and then silently reverted to
      // full strength once the map's next render pass ran. setOpacity feeds
      // the value maplibre itself re-applies, so it survives those renders.
      const markerOpacity = focused ? 1 : 0.35;
      for (const marker of markersByDayRef.current.get(day.index) ?? []) {
        marker.setOpacity(String(markerOpacity));
      }
    }

    // Handoff: "if the focused day has fewer than one located stop, do
    // nothing — hold the previous viewport, and let MapFocusCard explain."
    // Lurching to the whole-trip bounds on an empty day is exactly the
    // behaviour this guard avoids.
    if (focusedMapDay === null || focusedMapDay.stops.length < 1) return;

    const LngLatBounds = LngLatBoundsRef.current;
    if (!LngLatBounds) return;
    const bounds = focusedMapDay.stops.reduce((b, s) => b.extend([s.lng, s.lat]), new LngLatBounds());
    // animate: false — a focus change (rail click or scroll) is meant to
    // jump the camera straight to the new day, not glide/ease there; the
    // default fitBounds animation read as slow and disorienting when
    // scrolling through many days quickly. padding/maxZoom are looser than
    // the original 60/15 so a focused day's stops get breathing room instead
    // of filling the viewport edge-to-edge — tuned live against the actual
    // trip fixture.
    // Uniform padding can't clear the rail at any zoom (Mitchell, preview
    // review, 2026-08-25): it's a sticky overlay on the canvas's left edge
    // only, so a pin near the left of a day's bounds still ends up under it
    // regardless of how much room the other three sides get. `left` gets the
    // rail's own footprint (MAP_RAIL_INSET_PX + MAP_RAIL_WIDTH_PX) plus the
    // same 100px breathing room the other sides already had, instead of the
    // bare 100 they keep.
    map.fitBounds(bounds, {
      padding: { top: 100, right: 100, bottom: 100, left: MAP_RAIL_INSET_PX + MAP_RAIL_WIDTH_PX + 100 },
      maxZoom: 13,
      animate: false,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, focusedDay]);

  return (
    <div data-testid="map-lens" className="map-lens flex flex-col gap-2">
      {unlocated.length > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => onSelectActivity?.(unlocated[0]!.activityId)}
        >
          {unlocated.length} {unlocated.length === 1 ? "activity has" : "activities have"} no location — add a place
        </Button>
      )}
      {plottedPins.length > 0 ? (
        <div
          className="map-lens-canvas relative overflow-hidden border-t border-hairline bg-paper"
          // eslint-disable-next-line no-restricted-syntax -- maplibre needs a sized container; height is geometry, filling the viewport below the header/tabs. Deliberately NOT a flex item (no flex-1/min-h-0): a flex-basis:0%-grown item's height doesn't count as "definite" for descendants' percentage-height resolution in this engine, even though the item itself renders at a real pixel height — confirmed by a live probe (a plain 100%-height child stayed at 0px under flex-1, and resolved correctly the moment flex was removed). This div's own height is already fully explicit, so it never needed to be a flex item.
          style={{ minHeight: 480, height: "70vh" }}
        >
          <div ref={containerRef} className="h-full w-full" />
          <MapRail days={days} focusedDay={focusedDay} onFocus={setFocusedDay} />
          <MapFocusCard day={focusedMapDay} />
          <MapLegend />
        </div>
      ) : (
        <Text variant="secondary" className="map-lens-empty rounded-lg border border-dashed border-border-strong px-4 py-6 text-center">
          No located activities yet — add a place to see it on the map.
        </Text>
      )}
    </div>
  );
}
