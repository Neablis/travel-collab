"use client";

import { useState } from "react";
import type { Location } from "@tc/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";

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
    <div className="grid gap-1.5">
      {value?.name != null && (
        <div className="flex items-center gap-1.5">
          <Text as="span">{value.name}</Text>
          <Button variant="ghost" onClick={() => onChange(null)}>
            Clear
          </Button>
        </div>
      )}
      <div className="flex gap-1.5">
        <Input
          aria-label="Place name"
          placeholder="place name"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Button variant="secondary" onClick={() => void search()}>
          Search
        </Button>
      </div>
      {error !== null && <Text as="p" role="alert" className="text-danger-ink">{error}</Text>}
      {results.length > 0 && (
        <ul className="m-0 list-none p-0">
          {results.map((r, index) => (
            <li key={index}>
              <Button variant="ghost" onClick={() => pick(r)}>
                {r.canonicalName}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
