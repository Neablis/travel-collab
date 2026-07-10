import type { Geocoder, GeocodeResult } from "./geocoder";

const BASE = "https://us1.locationiq.com/v1/search";

type LocationIQRow = {
  lat: string;
  lon: string;
  display_name: string;
  address?: { country_code?: string };
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
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`geocode failed: ${res.status}`);
      const rows = (await res.json()) as LocationIQRow[];
      return rows.map<GeocodeResult>((r) => ({
        lat: Number(r.lat),
        lng: Number(r.lon),
        canonicalName: r.display_name,
        countryCode: r.address?.country_code?.toUpperCase(),
      }));
    },
  };
}
