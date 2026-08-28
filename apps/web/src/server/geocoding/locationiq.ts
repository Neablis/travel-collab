import type { Geocoder, GeocodeResult } from "./geocoder";

const BASE = "https://us1.locationiq.com/v1/search";

type LocationIQRow = {
  lat: string;
  lon: string;
  display_name: string;
  // Nominatim-style address breakdown (LocationIQ's `addressdetails=1`,
  // already requested below). `city` is present for a genuine city-level
  // result; smaller settlements come back under `town`/`village`/`hamlet`
  // instead — checked in that order, the same specificity order Nominatim
  // itself uses when deciding which one to populate.
  // Below the settlement, Nominatim populates whichever of
  // `suburb`/`neighbourhood`/`quarter`/`city_district` its source data
  // supports for that place — again checked most-to-least specific, matching
  // the settlement fallback chain above. These are strictly sub-settlement, so
  // they never collide with the `city` read.
  address?: {
    country_code?: string;
    city?: string;
    town?: string;
    village?: string;
    hamlet?: string;
    suburb?: string;
    neighbourhood?: string;
    quarter?: string;
    city_district?: string;
  };
};

export function createLocationIQGeocoder(apiKey: string): Geocoder {
  return {
    async forward(query, opts) {
      const url = new URL(BASE);
      url.searchParams.set("key", apiKey);
      url.searchParams.set("q", query);
      url.searchParams.set("format", "json");
      url.searchParams.set("addressdetails", "1");
      url.searchParams.set("limit", String(opts?.limit ?? 5));
      // LocationIQ orders viewbox as west,south,east,north. No `bounded=1`:
      // this biases ranking rather than filtering the result set (KI-15).
      if (opts?.viewbox) {
        const { minLng, minLat, maxLng, maxLat } = opts.viewbox;
        url.searchParams.set("viewbox", `${minLng},${minLat},${maxLng},${maxLat}`);
      }
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`geocode failed: ${res.status}`);
      const rows = (await res.json()) as LocationIQRow[];
      return rows.map<GeocodeResult>((r) => ({
        lat: Number(r.lat),
        lng: Number(r.lon),
        canonicalName: r.display_name,
        countryCode: r.address?.country_code?.toUpperCase(),
        city: r.address?.city ?? r.address?.town ?? r.address?.village ?? r.address?.hamlet,
        area:
          r.address?.suburb ??
          r.address?.neighbourhood ??
          r.address?.quarter ??
          r.address?.city_district,
      }));
    },
  };
}
