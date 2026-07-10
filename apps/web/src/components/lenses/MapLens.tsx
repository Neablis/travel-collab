"use client";

import { useEffect, useRef } from "react";
import type { TripDetail } from "@tc/contracts";
import { activityPins, unlocatedActivities } from "./mapData";

const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

export function MapLens({ detail }: { detail: TripDetail }) {
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

      const bounds = new LngLatBounds();
      for (const pin of pins) {
        new Marker().setLngLat([pin.lng, pin.lat]).addTo(map);
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
  }, [pins.map((p) => `${p.activityId}:${p.lat}:${p.lng}`).join(",")]);

  return (
    <div className="map-lens">
      {pins.length > 0 ? (
        <div ref={containerRef} className="map-lens-canvas" style={{ width: "100%", height: 400 }} />
      ) : (
        <p className="map-lens-empty">No located activities yet — add a place to see it on the map.</p>
      )}
      {unlocated.length > 0 && (
        <div className="map-lens-unlocated">
          <h3>Not on the map — add a place</h3>
          <ul>
            {unlocated.map((activity) => (
              <li key={activity.activityId}>{activity.title}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
