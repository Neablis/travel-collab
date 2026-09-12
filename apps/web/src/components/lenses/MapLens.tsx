"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TripDetail } from "@tc/contracts";
import { TAG_DIM_OPACITY, isOffTag } from "@/components/board/activityTags";
import { Text } from "../ui/text";
import { Button } from "../ui/button";
import { useEditor } from "../trip/context/EditorHost";
import { useDaySync, useFocus } from "../trip/context/FocusProvider";
import { activityPins, unlocatedActivities } from "./mapData";
import { mapDays, markerGroups, routeLegs, type MapDay } from "./mapRailData";
import { MAP_RAIL_INSET_PX, MAP_RAIL_WIDTH_PX, MapRail } from "./MapRail";
import { MAP_DAY_STRIP_HEIGHT_PX, MapDayStrip } from "./MapDayStrip";
import { useIsPhone } from "./useIsPhone";
import { MapFocusCard } from "./MapFocusCard";
import { MapLegend } from "./MapLegend";

// Handoff `current/…dc.html:630-668`: the muted "positron" basemap so the
// day accents (routes, markers) are the only colour that carries meaning —
// the old "liberty" style's own colourful landuse/POI fills competed with them.
const STYLE_URL = "https://tiles.openfreemap.org/styles/positron";

// MapLibre v6 loads its tile-decoding worker as a separate module worker (v5
// inlined it as a blob), resolving it at runtime from `import.meta.url` with a
// computed filename. No bundler can rewrite that, and after bundling
// `import.meta.url` is not an http(s) url, so maplibre fell back to an EMPTY
// worker url: `new Worker("")` resolved against the document, handed the
// browser this page's HTML as a module script, and was refused on MIME type —
// leaving the map chrome drawn over a basemap that never decoded a tile
// (bump #158). Turbopack's own emitted copy is no use as a target either: it
// is a raw asset whose `import "./maplibre-gl-shared.mjs"` is left unrewritten
// next to a hashed sibling. So we serve the worker and that sibling ourselves,
// under their original names, and name the worker here.
//
// Written by scripts/copy-maplibre-worker.mjs at build/dev start; same-origin,
// so the CSP's `worker-src 'self'` already covers it (next.config.ts).
const MAPLIBRE_WORKER_URL = "/maplibre/maplibre-gl-worker.mjs";

function accentVar(accent: MapDay["accent"]): string {
  return getComputedStyle(document.documentElement).getPropertyValue(`--color-${accent}`).trim();
}

// The day accent, set once on a disc's own element and inherited by its fill,
// its stroke and its count badge through `var()`. One place to write it keeps a
// disc and a teardrop on the same day resolving the same token — colour means
// WHICH DAY on this map and must never pick up a second meaning.
//
// Exported only because this property is the one place a finished disc's colour
// can be read back: MapLens.test.tsx asserts through it rather than naming the
// string itself, which would go red on a rename nobody can see.
export const CITY_DISC_ACCENT_VAR = "--map-city-disc-accent";
// Geometry, from the design pass's option D (`approximate-pins.html`): a 46px
// disc — nearly twice the stock teardrop's 27px width, which is what makes the
// shape difference read at a glance — a 22px count badge, and a 7px centre dot
// for a disc with no badge so the centroid itself is still marked (option C).
const CITY_DISC_PX = 46;
const CITY_DISC_BADGE_PX = 22;
const CITY_DISC_DOT_PX = 7;
// 1.5px at 55% of the accent is the design's "soft" stroke; the fill is 13% of
// it. Both are percentages of the ACCENT, not opacities of the element.
const CITY_DISC_STROKE = "1.5px";

/**
 * The marker for a city-level group: a DISC, not a teardrop.
 *
 * A teardrop's tip points at one spot, which is a claim a city centroid cannot
 * make — `precision: "city"` says "somewhere in this city" (contracts
 * activity.ts). A filled circle centred on the centroid makes the area claim
 * instead, and maplibre's default anchor for a custom element is already
 * `center` with a zero offset (verified in maplibre-gl 6.8's Marker
 * constructor), so the coordinate sits where the disc's middle is.
 *
 * Translucency here is the FILL's (`color-mix` against transparent, the same
 * technique globals.css uses), never the element's `opacity` — that is spoken
 * for twice already: day ghosting sets it to 0 and tag focus to
 * TAG_DIM_OPACITY, and a third writer of one property cannot be read back.
 *
 * A count badge appears only for a group of two or more; a single city-level
 * stop gets the dot instead, because "1" on a pin says nothing.
 */
/**
 * `label` present = this disc is interactive, and it is then a real `<button>`
 * rather than a `div` with a click listener. Native activation is the whole
 * reason: a listener alone never fires on Enter or Space, so a focusable div
 * would be a keyboard affordance that does not work — which is why the first
 * pass shipped no affordance at all. A button needs neither `role` nor
 * `tabIndex` and brings Enter/Space with it. Raised by CodeRabbit on PR 169.
 *
 * The stock teardrop markers remain unreachable by keyboard; that is untouched
 * here and belongs to whichever change gives every marker a keyboard path.
 */
function cityDiscElement(stopCount: number, accent: string, label: string | null): HTMLElement {
  const element = document.createElement(label === null ? "div" : "button");
  if (label !== null && element instanceof HTMLButtonElement) {
    // Markers live outside any form; without this a click submits whatever
    // ancestor form a future layout puts them in.
    element.type = "button";
    element.setAttribute("aria-label", label);
  }
  element.className = "map-city-disc";
  // How many stops this one marker stands for — the fact the badge renders,
  // kept on the element so the focus/ghosting effects and the tests can read a
  // finished marker without reaching into its children.
  element.dataset.stopCount = String(stopCount);
  // An `accent` of "" is a day whose family has no token (`neutral` — see the
  // marker loop): leaving the property UNSET is what lets the `var()` fallbacks
  // below reach slate. Setting it to "" would not — an empty custom property is
  // still set, and every `var()` reading it would collapse to nothing.
  if (accent !== "") element.style.setProperty(CITY_DISC_ACCENT_VAR, accent);
  const accentColor = `var(${CITY_DISC_ACCENT_VAR}, var(--color-slate))`;
  Object.assign(element.style, {
    boxSizing: "border-box",
    // A `button` arrives with UA padding, font and background; the disc owns
    // all three. `appearance: none` keeps Safari from re-imposing them.
    appearance: "none",
    padding: "0",
    font: "inherit",
    width: `${CITY_DISC_PX}px`,
    height: `${CITY_DISC_PX}px`,
    borderRadius: "50%",
    backgroundColor: `color-mix(in srgb, ${accentColor} 13%, transparent)`,
    border: `${CITY_DISC_STROKE} solid color-mix(in srgb, ${accentColor} 55%, transparent)`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  });

  const inner = document.createElement("div");
  Object.assign(inner.style, {
    boxSizing: "border-box",
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  });
  if (stopCount > 1) {
    inner.className = "map-city-disc-count";
    inner.textContent = String(stopCount);
    Object.assign(inner.style, {
      width: `${CITY_DISC_BADGE_PX}px`,
      height: `${CITY_DISC_BADGE_PX}px`,
      // Solid, so the count reads against whatever basemap is under the disc:
      // the surface colour with an accent ring and accent digits, not accent
      // fill with light digits — 11px reversed type on five different accent
      // hues is the half of that pair whose contrast we cannot promise.
      backgroundColor: "var(--color-surface)",
      border: `${CITY_DISC_STROKE} solid ${accentColor}`,
      color: accentColor,
      fontSize: "11px",
      fontWeight: "600",
      lineHeight: "1",
    });
  } else {
    inner.className = "map-city-disc-dot";
    Object.assign(inner.style, {
      width: `${CITY_DISC_DOT_PX}px`,
      height: `${CITY_DISC_DOT_PX}px`,
      backgroundColor: accentColor,
    });
  }
  element.appendChild(inner);
  return element;
}

// The neutral tone a non-focused day's route line shifts to — keeping its
// own accent hue at reduced opacity read as "still colourful", not
// "ghosted", once checked live. A shared grey (matching the legend's own
// "rest of trip" swatch) reads as de-emphasized the way the focused day's
// pins already do.

// A day draws up to two route layers: its ordinary legs, and the legs that
// touch a `transit` stop, which are dashed. They have to be separate layers
// because MapLibre's `line-dasharray` is a plain paint property and takes no
// data-driven expression — see routeLegs() (mapRailData.ts) for the split.
// Every route paint change below therefore applies to both.
const ROUTE_VARIANTS = ["rest", "travel"] as const;
type RouteVariant = (typeof ROUTE_VARIANTS)[number];

function layerIdFor(dayId: string, variant: RouteVariant): string {
  return `route-${variant}-${dayId}`;
}

// Dash pattern in line-width multiples, so it holds its proportions if the
// route width changes: a 2x dash with a 1.6x gap reads as dotted at 3px
// without turning into a dotted-line-shaped smear when the map zooms out.
const TRAVEL_DASHARRAY = [2, 1.6];

/**
 * Renders an interactive map of day-associated activities and routes.
 *
 * @param detail - Trip data containing activities and day-specific map information
 * @param onSelectActivity - Callback invoked when a mapped activity is selected
 * @param readOnly - Whether to disable creating activities by double-clicking the map
 */
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
  const { focusedDay, setFocusedDay, focusedTag } = useFocus();
  // The phone strip's half of the day-sync contract (`FocusProvider`'s header).
  // Taken unconditionally rather than inside the `isPhone` branch — hooks are
  // not conditional — which costs nothing on desktop, where the strip is not
  // mounted and so nothing ever scrolls or is scrolled.
  //
  // There is deliberately no handle for `MapRail`: the desktop rail already
  // drives focus from its own geared scroll machinery, it is the only day
  // container on its lens (the chips row is hidden in Map view), and a second
  // spy over the same box would be two mechanisms fighting. See `DayContainer`.
  const stripSync = useDaySync("map-strip");
  const isPhone = useIsPhone();
  const containerRef = useRef<HTMLDivElement>(null);
  // Distance from the top of the viewport to the top of the map canvas —
  // the sticky trip header, the tab strip and the day-chip rail, whose
  // combined height is not a constant (the chips wrap, the header grows a
  // line at narrow widths). Measured rather than assumed so the canvas can
  // be exactly the rest of the window: it used to be a flat `70vh`, which
  // left a strip of page visible under the map on a tall window and pushed
  // the document just past one viewport on a short one, so the whole page
  // scrolled a little. Both were reported together on the preview
  // (Mitchell, 2026-08-30 design pass).
  const [canvasTop, setCanvasTop] = useState<number | null>(null);
  const canvasRef = useCallback((node: HTMLDivElement | null) => {
    if (node === null) return;
    const measure = () => setCanvasTop(node.getBoundingClientRect().top + window.scrollY);
    measure();
    // The canvas's own box does not change when the header above it does, so
    // observing the canvas would never fire; the body is what reflows.
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);
  const [ready, setReady] = useState(false);
  const LngLatBoundsRef = useRef<typeof import("maplibre-gl").LngLatBounds | null>(null);
  // Keyed by MapDay.index, so the focus effect below can ghost/un-ghost a
  // day's pins the same way it dims/undims that day's route line — populated
  // once in the "load" handler's marker loop, read (never mutated in place)
  // by the focus effect. Backlog-located pins (belong to no day) are never
  // added here, so they're structurally excluded from ghosting.
  //
  // Each entry carries the ids of the stops it stands for as well as its
  // Marker: M18b's tag focus dims a single STOP, and a day-keyed array of bare
  // Markers cannot say which stop any of them is. Storing the ids here rather
  // than re-deriving them from marker order keeps the pairing true even if the
  // marker loop ever skips one.
  //
  // A LIST, not one id, because markers stopped being 1:1 with stops: a
  // city-level group is one marker standing for every stop that shares its
  // centroid (markerGroups, mapRailData.ts). Every effect below reads the list,
  // so a one-stop marker is just the degenerate case rather than a second path.
  const markersByDayRef = useRef<Map<number, { activityIds: string[]; marker: import("maplibre-gl").Marker }[]>>(
    new Map(),
  );
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
  // Everything the map's appearance depends on, as one string: per day, its
  // accent and its stops in order with their coordinates and kind. See the
  // creation effect's dependency list for why kind and order have to be in
  // here. `accent` is in it because a day's colour is derived from its city
  // (chipModel -> dayAccents), so editing a stop's city repaints every route
  // and marker on that day without touching an id, a coordinate or a kind —
  // and both the line colour at creation and the marker colour read it
  // (CodeRabbit, PR #98). Keyed on the accent rather than the city itself:
  // two cities that hash to the same family look identical, and rebuilding
  // the map for a change nobody can see is worse than not rebuilding.
  // `precision` is in it for the third time this trap has been walked into
  // (after `kind` and stop order): it decides whether a stop draws a teardrop
  // or joins a disc, and whether its neighbours' discs carry a count — so a
  // stop enriched from unknown to `city` without moving would otherwise keep
  // the stale marker forever.
  const routeKey = days
    .map(
      (day) =>
        `${day.dayId}:${day.accent}[${day.stops
          .map((s) => `${s.activityId}:${s.lat}:${s.lng}:${s.kind}:${s.precision ?? ""}`)
          .join(",")}]`,
    )
    .join("|");
  const focusedMapDay = focusedDay !== null ? (days[focusedDay] ?? null) : null;

  /**
   * Arriving at the map with nothing selected picks the first day.
   *
   * Mitchell, 2026-09-01: *"When navigating to map view, always use the current
   * select day, but if no day is selected, default to first day. Dont go to
   * zoomed out full trip view."* The zoomed-out view was the mount camera below
   * — a static `center` on the first located pin at zoom 9, which is what you
   * got whenever `focusedDay` was null, because the camera effect has nothing
   * to fit and holds the viewport.
   *
   * Fixed by giving it a day rather than by teaching the camera a second mode:
   * one selection drives the camera, the rail, the day strip and the route
   * opacity, so a "day the map is on" that the rail did not agree with would be
   * a second kind of selected day. Explicit, not scrolled — it is the answer to
   * "which day am I looking at", and switching back to the timeline should land
   * on that day rather than wherever the page happened to be.
   *
   * Runs once per mount and only into an empty selection, so it never overrides
   * a day somebody picked, and never fights the rail after the first paint.
   */
  const defaultedDay = useRef(false);
  useEffect(() => {
    if (defaultedDay.current || focusedDay !== null || days.length === 0) return;
    defaultedDay.current = true;
    setFocusedDay(0);
  }, [focusedDay, days.length, setFocusedDay]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const firstPin = plottedPins[0];
    if (!firstPin) return;
    const el = containerRef.current;
    if (!el) return;

    let cancelled = false;
    let map: import("maplibre-gl").Map | undefined;
    let resizeObserver: ResizeObserver | undefined;

    import("maplibre-gl").then(({ Map, Marker, LngLatBounds, setWorkerUrl }) => {
      if (cancelled || !el) return;
      // Before the first Map construction: maplibre reads this when it spawns
      // its worker pool, which happens inside the constructor below.
      setWorkerUrl(MAPLIBRE_WORKER_URL);
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
          const legs = routeLegs(day);
          for (const variant of ROUTE_VARIANTS) {
            const coordinates = legs[variant];
            // A day can be all travel or none of it, and an empty
            // MultiLineString is a valid but pointless layer.
            if (coordinates.length === 0) continue;
            const id = layerIdFor(day.dayId, variant);
            map.addSource(id, {
              type: "geojson",
              data: {
                type: "Feature",
                properties: {},
                // MultiLineString, not LineString: the legs of one variant
                // are not necessarily contiguous — a day can go stop, train,
                // stop, stop, train — so joining them into a single path
                // would draw lines across gaps that no one travels.
                geometry: { type: "MultiLineString", coordinates },
              },
            });
            map.addLayer({
              id,
              type: "line",
              source: id,
              paint: {
                "line-color": accentVar(day.accent),
                "line-width": 3,
                ...(variant === "travel" ? { "line-dasharray": TRAVEL_DASHARRAY } : {}),
                // No focused day yet on first paint (see the focus effect
                // below for what happens once one is picked) — every route
                // draws at full strength until a focus dims the others.
                "line-opacity": 1,
              },
            });
          }
        }

        // Day-attached located stops only (Mitchell, preview review,
        // 2026-08-25: "dont plot locations that arent attached to a day,
        // anything unscheduled isnt on the map"). A backlog activity with a
        // location used to get a neutral-brand marker here too; that loop is
        // gone — the map no longer plots anything that isn't on a day.
        for (const day of days) {
          const dayMarkers: { activityIds: string[]; marker: import("maplibre-gl").Marker }[] = [];
          // "" for a day whose family has no token — today only `neutral`, which
          // leaves a stock marker in maplibre's own blue. Not fixed here; just
          // not made worse (the disc falls back to slate, see cityDiscElement).
          const accent = accentVar(day.accent);
          // One marker per PLACE, not per stop: city-level stops that share a
          // centroid are one disc (markerGroups, mapRailData.ts). Grouping is
          // per day on purpose, which is also why it happens inside this loop.
          for (const group of markerGroups(day)) {
            const first = group.stops[0]!;
            const marker = new Marker(
              group.cityLevel
                ? {
                    element: cityDiscElement(
                      group.stops.length,
                      accent,
                      // The accessible name says what activating it does, which
                      // is open the FIRST stop, and how many others are behind
                      // it — the same fact the badge renders for sighted users.
                      onSelectActivity
                        ? group.stops.length === 1
                          ? `${first.title} — approximate location`
                          : `${first.title} and ${group.stops.length - 1} more here — approximate location`
                        : null,
                    ),
                  }
                : accent
                  ? { color: accent }
                  : undefined,
            )
              .setLngLat([group.lng, group.lat])
              .addTo(map);
            if (onSelectActivity) {
              // KNOWN LIMITATION: a group opens its FIRST stop. Listing the
              // members — a popover, or cycling on repeat clicks — is a richer
              // affordance and deliberately out of scope here; the disc's count
              // is what tells you there are others behind it.
              marker.getElement().addEventListener("click", () => onSelectActivity(first.activityId));
              marker.getElement().style.cursor = "pointer";
            }
            marker.getElement().style.transition = "opacity 150ms";
            dayMarkers.push({ activityIds: group.stops.map((stop) => stop.activityId), marker });
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
    //
    // The key covers each day's stops IN ORDER and WITH THEIR KIND, not just
    // the flat set of pins. Routes are split into a solid layer and a dashed
    // one by `routeLegs`, which reads `kind` — so with a pins-only key
    // (`activityId:lat:lng`), changing a stop from planned to transit without
    // moving it left the layers untouched and the leg stayed solid. Order
    // matters for the same reason: the legs are consecutive pairs, so
    // reordering two stops changes which legs exist without changing any
    // coordinate (CodeRabbit, PR #98).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey, onSelectActivity, openCreate, readOnly]);

  // Focus-driven OPACITY — routes and markers. Kept separate from the creation
  // effect above so clicking a rail day never tears down and rebuilds the whole
  // map instance, and separate from the camera effect below so a tag focus can
  // restyle pins without moving the viewport (see that effect's own note).
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;

    for (const day of days) {
      const focused = focusedDay === null || day.index === focusedDay;

      if (day.stops.length >= 2) {
        // Ghosting a non-focused route is two changes together: a lower
        // opacity floor than pins get (a thin line reads even fainter than a
        // pin at the same opacity, so it needs to drop further — tuned live
        // against the marker ghosting below) AND a shift off the day's own
        // accent hue to a shared neutral, since the accent hue alone at
        // reduced opacity still read as "that day's colour, just fainter"
        // rather than genuinely de-emphasized.
        for (const variant of ROUTE_VARIANTS) {
          const layerId = layerIdFor(day.dayId, variant);
          // A day with no travel legs (or nothing but travel legs) never had
          // the other layer added.
          if (map.getLayer(layerId) === undefined) continue;
          // **A day you are not looking at is not on the map at all.**
          //
          // Mitchell asked this twice and the first reading was too narrow.
          // 2026-09-06 preview: *"Lets try the UI in the designs. Remove the
          // travel lines from all days that are not currently selected"* — read
          // then as the dashed `travel` variant only, leaving `rest` legs and
          // every pin ghosted. He corrected it the same day: *"what happened to
          // on map view removing stops on the days you arent looking at. I
          // asked for that change"*. So it is the whole day: both route
          // variants and the day's pins below.
          //
          // Ghosting was the wrong tool for this axis. It lowers contrast
          // without lowering the number of things drawn over the day you are
          // reading — on a fourteen-day trip that is thirteen days of pins and
          // lines still competing for the same pixels.
          map.setPaintProperty(layerId, "line-opacity", focused ? 1 : 0);
          map.setPaintProperty(layerId, "line-color", accentVar(day.accent));
        }
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
      // Zero, not a dim: see the note on the routes above. This is the DAY
      // axis; M18b's "dim, never hide" is the TAG axis and is untouched below,
      // where an off-tag pin on the focused day still only fades.
      const dayOpacity = focused ? 1 : 0;
      for (const { activityIds, marker } of markersByDayRef.current.get(day.index) ?? []) {
        // Two independent dims can apply to the same pin — its day is not the
        // focused one (0.35), and it does not carry the focused tag (0.32) —
        // so the pin takes whichever is fainter rather than their product.
        // Multiplying would put a stop that is off on both counts at 0.11,
        // effectively invisible, which is the hiding M18b's "dim, never hide"
        // rule exists to prevent.
        //
        // A grouped marker is one pin for several stops, so it dims only when
        // EVERY member is off-tag: dimming a disc that holds the focused tag
        // would hide a match, and leaving it full when nothing in it matches
        // would claim one.
        const offTag = activityIds.every((activityId) =>
          isOffTag(detail.activities[activityId]?.tags ?? [], focusedTag),
        );
        const markerOpacity = offTag ? Math.min(dayOpacity, TAG_DIM_OPACITY) : dayOpacity;
        marker.setOpacity(String(markerOpacity));
        // An invisible pin must not still be clickable: opacity alone leaves
        // the element in the hit-test, so a tap on empty map would open a stop
        // from a day that is not on screen.
        marker.getElement().style.pointerEvents = markerOpacity === 0 ? "none" : "";
      }
    }

    // `focusedTag` belongs in THIS effect's deps and only this one: the marker
    // loop above reads it. The camera lives in its own effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, focusedDay, focusedTag]);

  // Focus-driven CAMERA, deliberately its own effect keyed on the DAY alone.
  //
  // It was one effect with the opacity pass above until M18b, and folding
  // `focusedTag` into that effect's deps silently made a tag toggle re-fit the
  // camera: `fitBounds` sits at the end of the same body, so focusing "Meal"
  // yanked a map the user had panned by hand back to the focused day's bounds.
  // A comment right here claimed the opposite — "a tag focus never moves the
  // viewport" — which was true of the intent and false of the code, the exact
  // species AGENTS.md calls a lie with a timer on it. Caught by CodeRabbit on
  // PR #91; the regression test is "does not move the camera when only the
  // focused TAG changes".
  //
  // A tag focus is a "which of these" question, not a "where" one. Only a day
  // change is allowed to move the viewport.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;

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
    //
    // On a phone the day control is the strip across the TOP, not the rail on
    // the left, so the clearance moves with it: the left inset goes back to
    // the plain padding every other side gets, and the top absorbs the strip.
    // Reserving the rail's 284px on a 411px screen would leave the camera
    // almost no width to fit a day into.
    //
    // That plain padding is 48px, up from 24. Mitchell, 2026-09-06 at 764px:
    // *"have the map default be even more zoomed out by default so the pins
    // aren't so close to the edges"*. Padding is the lever rather than
    // `maxZoom`: the cap only bites on a day whose stops are close together,
    // while the complaint is about where the pins land on a day whose bounds
    // already fill the frame. More padding zooms out AND moves them inward;
    // a lower cap would do neither for the day being complained about.
    map.fitBounds(bounds, {
      padding: isPhone
        ? { top: MAP_DAY_STRIP_HEIGHT_PX + 48, right: 48, bottom: 48, left: 48 }
        : { top: 100, right: 100, bottom: 100, left: MAP_RAIL_INSET_PX + MAP_RAIL_WIDTH_PX + 100 },
      maxZoom: 13,
      animate: false,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, focusedDay, isPhone]);

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
          ref={canvasRef}
          className="map-lens-canvas relative overflow-hidden border-t border-hairline bg-paper"
          // eslint-disable-next-line no-restricted-syntax -- maplibre needs a sized container; height is geometry, filling exactly the viewport left below the header/tabs and above the unscheduled rack. Deliberately NOT a flex item (no flex-1/min-h-0): a flex-basis:0%-grown item's height doesn't count as "definite" for descendants' percentage-height resolution in this engine, even though the item itself renders at a real pixel height — confirmed by a live probe (a plain 100%-height child stayed at 0px under flex-1, and resolved correctly the moment flex was removed). This div's own height is already fully explicit, so it never needed to be a flex item.
          style={{
            // `svh`, not `vh` or `dvh`. `vh` is the *large* viewport (chrome
            // hidden) and is the one that overflows on mobile — that's why
            // this used to be `dvh`. But `dvh` is the *dynamic* viewport: on
            // Android Chrome it grows as the toolbar collapses on scroll, and
            // this canvas's height (and so the document's) is read straight
            // from it. Any page with a little initial overflow could then
            // loop — scroll a bit -> toolbar collapses -> dvh grows -> canvas
            // (and document) grows -> more scroll is available -> repeat,
            // each turn adding roughly the toolbar's height (KI-2026-09-06-g,
            // reported as scrolling "way past the bottom" on mobile). `svh`
            // is the *small* viewport — the largest height that cannot
            // overflow at any toolbar state — so the loop can't start: it
            // never grows as the toolbar collapses. The tradeoff is the
            // symptom `dvh` was chosen to fix, a strip of page under the map
            // while the toolbar is collapsed, by up to the toolbar's height —
            // acceptable because it isn't a runaway.
            // `--rack-height` is set by TripBoardScreen on
            // `.trip-board-content` above, so the map stops at the top of
            // the Unscheduled bar instead of running under it, and follows
            // the bar as it opens and closes. The floor keeps a very short
            // window showing a usable map (and scrolling) rather than a
            // sliver.
            //
            // There was a `--launcher-height` here too, for the assistant
            // launcher, and it is gone with the thing it measured. Below 768px
            // that launcher used to be an in-flow button at the end of the plan
            // column (SPEC §13.5 allows no phone FAB — KI-2026-08-30), so it
            // cost real flow space *after* this canvas and pushed the document
            // 56px past a viewport the canvas had already claimed. SPEC §23
            // replaced it with the trip header's Ask pill, so the launcher is a
            // `position: fixed` desktop pill and nothing else: out of flow at
            // every width, costing this canvas zero by construction. The
            // subtraction was of a variable that could only publish `0px`.
            //
            // `--phone-tab-bar-height` is the third of exactly the same
            // subtraction, and it is here for exactly the same measured
            // symptom. PhoneTabBar is `position: fixed` across the bottom of
            // every authenticated route below 768px, and `(app)/layout.tsx`
            // reserves its height as flow padding around `children`
            // (`.phone-tab-bar-inset`, globals.css) so a page's last row is
            // not underneath it. Every other lens is normal flow and that
            // reservation is all it needs; this canvas is the one element
            // sized from `100svh` rather than from its parent, so without the
            // matching subtraction it claimed a full viewport *plus* the
            // reservation and the map page scrolled by exactly the bar's
            // height — 927px of document in an 844px viewport, measured at
            // 390x844 — with MapLibre's attribution sitting under the bar.
            // It is 0px at >=768px (the bar is `md:hidden`, so its measured
            // height is genuinely zero), so the desktop canvas is again
            // unchanged.
            minHeight: 320,
            height:
              canvasTop === null
                ? "70vh"
                : `calc(100svh - ${canvasTop}px - var(--rack-height, 0px) - var(--phone-tab-bar-height, 0px))`,
          }}
        >
          <div ref={containerRef} className="h-full w-full" />
          {/* One day control, not two (Mitchell, 2026-08-30 design pass). On a
              phone the rail's 268px panel and the floating focus card are most
              of the screen, and the map is the content — so the days become a
              chip strip across the top and the focus card's one line of detail
              folds into it. The legend goes entirely: it is a key for colours
              the chips already carry, and it is the one overlay that costs
              canvas and returns nothing. Mounted by branch rather than hidden
              by CSS because the rail runs real scroll machinery — see
              useIsPhone for why. */}
          {isPhone ? (
            <MapDayStrip
              days={days}
              focusedDay={focusedDay}
              // A chip tapped in the strip is picked HERE. The lens's own
              // default focus above (`setFocusedDay(0)`) deliberately does NOT
              // name the strip: that one is handed to it, so the strip stays a
              // plain follower and its next flick is not swallowed.
              onFocus={(index) => setFocusedDay(index, "map-strip")}
              sync={stripSync}
            />
          ) : (
            <>
              <MapRail days={days} focusedDay={focusedDay} onFocus={setFocusedDay} />
              <MapFocusCard day={focusedMapDay} />
              <MapLegend />
            </>
          )}
        </div>
      ) : (
        <Text variant="secondary" className="map-lens-empty rounded-lg border border-dashed border-border-strong px-4 py-6 text-center">
          No located activities yet — add a place to see it on the map.
        </Text>
      )}
    </div>
  );
}
