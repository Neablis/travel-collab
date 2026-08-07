export interface LatLng {
  lat: number;
  lng: number;
}

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export interface GeocodeResult {
  lat: number;
  lng: number;
  canonicalName: string;
  countryCode?: string; // ISO-3166 alpha-2, uppercase
}

export interface GeocodeOptions {
  limit?: number;
  // Soft geographic bias (KI-15). Prefers results inside the box without
  // excluding everything outside it — the caller applies its own acceptance
  // test to the answer.
  viewbox?: BoundingBox;
}

// The swappable seam (ADR-007). Callers depend only on this; each adapter hides
// its vendor. We persist normalized GeocodeResults, never raw vendor payloads.
export interface Geocoder {
  forward(query: string, opts?: GeocodeOptions): Promise<GeocodeResult[]>;
}
