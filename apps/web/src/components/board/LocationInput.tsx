"use client";

import { useState } from "react";
import type { Location } from "@tc/contracts";

type GeocodeResult = { lat: number; lng: number; canonicalName: string; countryCode?: string };

export function LocationInput({
  value,
  onChange,
}: {
  value: Location | null;
  onChange: (next: Location | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    setError(null);
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
      if (!res.ok) throw new Error(`geocode failed: ${res.status}`);
      const data = (await res.json()) as { results: GeocodeResult[] };
      setResults(data.results);
    } catch {
      setError("Could not search for that place");
    }
  }

  function pick(r: GeocodeResult) {
    onChange({ name: r.canonicalName, lat: r.lat, lng: r.lng, countryCode: r.countryCode });
    setResults([]);
  }

  return (
    <div style={{ display: "grid", gap: 6 }}>
      {value?.name != null && (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span>{value.name}</span>
          <button type="button" onClick={() => onChange(null)}>
            Clear
          </button>
        </div>
      )}
      <div style={{ display: "flex", gap: 6 }}>
        <input
          aria-label="Place name"
          placeholder="place name"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="button" onClick={() => void search()}>
          Search
        </button>
      </div>
      {error !== null && <p role="alert">{error}</p>}
      {results.length > 0 && (
        <ul>
          {results.map((r, index) => (
            <li key={index}>
              <button type="button" onClick={() => pick(r)}>
                {r.canonicalName}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
