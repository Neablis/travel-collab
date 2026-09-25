"use client";

import { useState } from "react";
import type { Location } from "@tc/contracts";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { displayPlace } from "@/lib/place";

type GeocodeResult = { lat: number; lng: number; canonicalName: string; countryCode?: string; city?: string; area?: string };

export function LocationInput({
  value,
  onChange,
  // Overridable so a form can hold two (M24: a transit stop's `endLocation`)
  // without two inputs sharing an id and an accessible name.
  id = "location-search",
  label = "Place name",
}: {
  value: Location | null;
  onChange: (next: Location | null) => void;
  id?: string;
  label?: string;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  // A second input's controls say which place they act on, or a form holding
  // two has two "Search" and two "Clear" buttons a screen reader cannot tell
  // apart. The lone default keeps its bare names, which specs select by.
  const own = (name: string) => (id === "location-search" ? name : `${name} ${label}`);

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
    onChange({ name: r.canonicalName, lat: r.lat, lng: r.lng, countryCode: r.countryCode, city: r.city, area: r.area });
    setResults([]);
  }

  return (
    <div className="grid gap-1.5">
      {value?.name != null && (
        <div className="flex items-center gap-1.5">
          <Text as="span">{displayPlace(value)}</Text>
          <Button variant="ghost" aria-label={own("Clear")} onClick={() => onChange(null)}>
            Clear
          </Button>
        </div>
      )}
      <FormField
        id={id}
        label={label}
        description="Search for a place by name, then pick a match from the results."
      >
        <div className="flex gap-1.5">
          <Input
            id={id}
            aria-label={label}
            placeholder="place name"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void search();
              }
            }}
          />
          <Button variant="secondary" aria-label={own("Search")} onClick={() => void search()}>
            Search
          </Button>
        </div>
      </FormField>
      {error !== null && <Text as="p" role="alert" className="text-danger-ink">{error}</Text>}
      {results.length > 0 && (
        <ul role="listbox" aria-label={id === "location-search" ? "Search results" : `${label} results`} className="m-0 list-none divide-y divide-hairline p-0">
          {results.map((r, index) => (
            <li key={index} role="presentation">
              <Button
                role="option"
                aria-selected={false}
                variant="ghost"
                onClick={() => pick(r)}
                className="flex h-auto w-full flex-col items-start px-3 py-2 text-left"
              >
                <Text as="span">{r.canonicalName}</Text>
                {r.countryCode != null && (
                  <Text as="span" variant="secondary">
                    {r.countryCode}
                  </Text>
                )}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
