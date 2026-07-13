"use client";

import { useEffect, useRef } from "react";
import type { TripDetail } from "@tc/contracts";
import { Heading } from "../ui/heading";
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
        <>
          {/* eslint-disable-next-line no-restricted-syntax -- maplibre requires a sized DOM container to mount into; dimensions are geometry, not tokenable colors */}
          <div ref={containerRef} className="map-lens-canvas overflow-hidden rounded-md border border-hairline" style={{ width: "100%", height: 400 }} />
          <ul className="map-lens-pin-list flex flex-col gap-1">
            {pins.map((pin) =>
              onSelectActivity ? (
                <li key={pin.activityId}>
                  <Button
                    variant="ghost"
                    onClick={() => onSelectActivity(pin.activityId)}
                    className="h-auto justify-start p-0 text-left text-base font-normal text-ink underline-offset-2 hover:bg-transparent hover:underline"
                  >
                    {pin.title}
                  </Button>
                </li>
              ) : (
                <li key={pin.activityId}>
                  <Text as="span">{pin.title}</Text>
                </li>
              ),
            )}
          </ul>
        </>
      ) : (
        <Text variant="secondary" className="map-lens-empty">
          No located activities yet — add a place to see it on the map.
        </Text>
      )}
      {unlocated.length > 0 && (
        <div className="map-lens-unlocated">
          <Heading level={3} className="mb-1.5">
            Not on the map — add a place
          </Heading>
          <ul className="flex flex-col gap-1">
            {unlocated.map((activity) =>
              onSelectActivity ? (
                <li key={activity.activityId}>
                  <Button
                    variant="ghost"
                    onClick={() => onSelectActivity(activity.activityId)}
                    className="h-auto justify-start p-0 text-left text-base font-normal text-ink underline-offset-2 hover:bg-transparent hover:underline"
                  >
                    {activity.title}
                  </Button>
                </li>
              ) : (
                <li key={activity.activityId}>
                  <Text as="span">{activity.title}</Text>
                </li>
              ),
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
