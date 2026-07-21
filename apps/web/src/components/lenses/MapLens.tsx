"use client";

import { useEffect, useRef } from "react";
import type { TripDetail } from "@tc/contracts";
import { Text } from "../ui/text";
import { Button } from "../ui/button";
import { useEditor } from "../trip/context/EditorHost";
import { activityPins, unlocatedActivities } from "./mapData";

const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

export function MapLens({
  detail,
  onSelectActivity,
}: {
  detail: TripDetail;
  onSelectActivity?: (activityId: string) => void;
}) {
  const { openCreate } = useEditor();
  const containerRef = useRef<HTMLDivElement>(null);
  const pins = activityPins(detail);
  const unlocated = unlocatedActivities(detail);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const firstPin = pins[0];
    if (!firstPin) return;
    const el = containerRef.current;
    if (!el) return;

    let cancelled = false;
    let map: import("maplibre-gl").Map | undefined;

    import("maplibre-gl").then(({ Map, Marker, LngLatBounds }) => {
      if (cancelled || !el) return;

      map = new Map({
        container: el,
        style: STYLE_URL,
        center: [firstPin.lng, firstPin.lat],
        zoom: 10,
      });

      // The "liberty" style's POI layers reference sprite icons (e.g.
      // "office") that don't always resolve; without a fallback, maplibre
      // logs a console error per missing id. A blank placeholder silences
      // this — the icon slot just renders empty, which is already the
      // effective behavior when this fires.
      map.on("styleimagemissing", (e: { id: string }) => {
        if (map?.hasImage(e.id)) return;
        map?.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) });
      });

      // Double-click on the map is the create-mode trigger (ADR-011 R2): it
      // seeds the editor's prefill with the clicked coordinates instead of a
      // dayId, demonstrating a second, distinct prefill shape from the same
      // openCreate() entry point. No other maplibre behavior changes — this
      // only adds a listener (maplibre's default dblclick-to-zoom still
      // fires alongside it, matching stock map interaction expectations).
      map.on("dblclick", (e: import("maplibre-gl").MapMouseEvent) => {
        const { lng, lat } = e.lngLat;
        openCreate({
          location: { name: `${lat.toFixed(4)}, ${lng.toFixed(4)}`, lat, lng },
        });
      });

      // Marker color is a maplibre-gl runtime option, not a CSS class — it
      // requires a literal color string at construction time. It is read from
      // the live --color-brand CSS variable rather than hardcoded, so the
      // marker always tracks the design token.
      const brandColor = getComputedStyle(document.documentElement).getPropertyValue("--color-brand").trim() || undefined;

      const bounds = new LngLatBounds();
      for (const pin of pins) {
        const marker = new Marker(brandColor ? { color: brandColor } : undefined).setLngLat([pin.lng, pin.lat]).addTo(map);
        if (onSelectActivity) {
          marker.getElement().addEventListener("click", () => onSelectActivity(pin.activityId));
          marker.getElement().style.cursor = "pointer";
        }
        bounds.extend([pin.lng, pin.lat]);
      }
      map.fitBounds(bounds, { padding: 40, maxZoom: 15 });
    });

    return () => {
      cancelled = true;
      if (typeof window !== "undefined") {
        map?.remove();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pins.map((p) => `${p.activityId}:${p.lat}:${p.lng}`).join(","), onSelectActivity, openCreate]);

  return (
    <div data-testid="map-lens" className="map-lens flex flex-col gap-3">
      {pins.length > 0 ? (
        // eslint-disable-next-line no-restricted-syntax -- maplibre needs a sized container; height is geometry, filling the viewport below the header/tabs
        <div ref={containerRef} className="map-lens-canvas grow overflow-hidden rounded-md border border-hairline" style={{ width: "100%", minHeight: 480, height: "70vh" }} />
      ) : (
        <Text variant="secondary" className="map-lens-empty">
          No located activities yet — add a place to see it on the map.
        </Text>
      )}
      {unlocated.length > 0 && (
        <Button
          variant="ghost"
          className="self-start text-slate"
          onClick={() => onSelectActivity?.(unlocated[0]!.activityId)}
        >
          {unlocated.length} {unlocated.length === 1 ? "activity has" : "activities have"} no location — add a place
        </Button>
      )}
    </div>
  );
}
