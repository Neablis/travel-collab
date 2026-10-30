import type { GeocodeOptions, Geocoder, GeocodeResult } from "./geocoder";

const FREE_TEXT = "https://us1.locationiq.com/v1/search";
// Structured search is a SEPARATE ENDPOINT, not structured params on the
// free-text one (confirmed against LocationIQ's published OpenAPI spec,
// 2026-09-18). `q` and the structured params never travel together.
const STRUCTURED = "https://us1.locationiq.com/v1/search/structured";
// Reverse answers ONE row, not a list, and takes lat/lon rather than `q`.
const REVERSE = "https://us1.locationiq.com/v1/reverse";
// Autocomplete is documented on the `api.` host only, not the regional ones.
// It answers its own row shape, and takes neither `format` nor `addressdetails`.
const AUTOCOMPLETE = "https://api.locationiq.com/v1/autocomplete";

type AutocompleteRow = {
  osm_id?: string;
  osm_type?: string;
  place_id: string;
  lat: string;
  lon: string;
  display_name: string;
  // "Lisbon" and "Lisbon, Portugal": the name and the line under it.
  display_place?: string;
  display_address?: string;
  address?: { country_code?: string };
};

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

function vendorUrl(endpoint: string, apiKey: string, params: Record<string, string>): URL {
  const url = new URL(endpoint);
  url.searchParams.set("key", apiKey);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  url.searchParams.set("format", "json");
  url.searchParams.set("addressdetails", "1");
  // Romanised names, not the local script (Mitchell, walking the #71
  // preview: searching Tokyo returned 千代田区 for Tokyo Station while his
  // trip data says "Tokyo"). LocationIQ is Nominatim-derived — the address
  // breakdown above follows Nominatim's own city/town/village order — and
  // takes Nominatim's `accept-language`.
  //
  // A fixed "en" rather than the request's Accept-Language: what this
  // decides is how a place is SPELLED IN STORAGE, not how one reader sees
  // it. `canonicalName` and `city` are persisted on the Location and then
  // shown to everyone the trip is shared with, so letting the geocoding
  // browser's locale choose would mean the same stop reads differently
  // depending on who happened to add it.
  url.searchParams.set("accept-language", "en");
  return url;
}

function toResult(r: LocationIQRow): GeocodeResult {
  return {
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
  };
}

async function search(
  endpoint: string,
  apiKey: string,
  params: Record<string, string>,
  opts?: GeocodeOptions,
): Promise<GeocodeResult[]> {
  const url = vendorUrl(endpoint, apiKey, params);
  url.searchParams.set("limit", String(opts?.limit ?? 5));
  // LocationIQ orders viewbox as west,south,east,north. No `bounded=1`:
  // this biases ranking rather than filtering the result set (KI-15).
  if (opts?.viewbox) {
    const { minLng, minLat, maxLng, maxLat } = opts.viewbox;
    url.searchParams.set("viewbox", `${minLng},${minLat},${maxLng},${maxLat}`);
  }
  // `countrycodes` (ISO alpha-2, lowercased), not the structured endpoint's
  // `country`, which takes a country NAME — a code is what we hold. It takes a
  // comma list, which is how a trip spanning several countries is hinted; a
  // country the caller named wins over that list outright.
  const countries = opts?.countryCode ? [opts.countryCode] : (opts?.countryCodes ?? []);
  if (countries.length > 0) {
    url.searchParams.set("countrycodes", countries.map((code) => code.toLowerCase()).join(","));
  }
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  // A miss is HTTP 404 with body {"error":"Unable to geocode"}. It is an
  // answer, not a fault, and it has to reach the caller as one: the v1 stop
  // writes distinguish `no-match` from `unavailable` purely by whether this
  // throws. Matched on the status alone — a vendor reword of that string must
  // not silently turn every miss back into an outage.
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`geocode failed: ${res.status}`);
  const rows = (await res.json()) as LocationIQRow[];
  return rows.map(toResult);
}

export function createLocationIQGeocoder(apiKey: string): Geocoder {
  return {
    async forward(query, opts) {
      const results = await search(FREE_TEXT, apiKey, { q: query }, opts);
      // The trip's countries are a hint, not a wall (Mitchell, 2026-09-30,
      // option A). `countrycodes` filters, so a trip in Japan adding its first
      // stop in Seoul by name would otherwise find nothing. A miss inside the
      // hint is retried unrestricted: one more vendor call, on misses only. A
      // country the CALLER named is never widened — that is their filter.
      if (results.length > 0 || opts?.countryCode || !opts?.countryCodes?.length) return results;
      return search(FREE_TEXT, apiKey, { q: query }, { ...opts, countryCodes: [] });
    },
    async forwardAddress(address, opts) {
      const params: Record<string, string> = { street: address.lines.join(", ") };
      if (address.locality) params.city = address.locality;
      if (address.administrativeArea) params.state = address.administrativeArea;
      if (address.postalCode) params.postalcode = address.postalCode;
      // dependentLocality has no structured param in the Nominatim family; it
      // is dropped from the query (still stored on the Location) rather than
      // concatenated into `street`, where it would make a house-level match
      // fail.
      return search(STRUCTURED, apiKey, params, { ...opts, countryCode: address.countryCode });
    },
    async reverse({ lat, lng }) {
      const url = vendorUrl(REVERSE, apiKey, { lat: String(lat), lon: String(lng) });
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      // Nothing at that point (open sea) is the same 404 a search miss is.
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`reverse geocode failed: ${res.status}`);
      return toResult((await res.json()) as LocationIQRow);
    },
    async autocomplete(query, opts) {
      const url = new URL(AUTOCOMPLETE);
      url.searchParams.set("key", apiKey);
      url.searchParams.set("q", query);
      url.searchParams.set("limit", String(opts?.limit ?? 5));
      // Places and the boundaries countries and regions are drawn as, never a
      // street or a café: this box picks where a trip goes.
      url.searchParams.set("tag", "place,boundary:administrative");
      url.searchParams.set("dedupe", "1");
      url.searchParams.set("accept-language", "en");
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (res.status === 404) return [];
      if (!res.ok) throw new Error(`autocomplete failed: ${res.status}`);
      const rows = (await res.json()) as AutocompleteRow[];
      return rows.map((r) => ({
        // The OSM object, not LocationIQ's `place_id`, which it renumbers when
        // it reloads its data: an id the client commits has to outlive that.
        id: r.osm_type && r.osm_id ? `osm:${r.osm_type}:${r.osm_id}` : `locationiq:${r.place_id}`,
        name: r.display_place ?? r.display_name,
        detail: r.display_address ?? r.display_name,
        countryCode: r.address?.country_code?.toUpperCase(),
        lat: Number(r.lat),
        lng: Number(r.lon),
      }));
    },
  };
}
