"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { submitOnEnter } from "@/lib/submitOnEnter";
import { Text } from "@/components/ui/text";
import { searchPlaces } from "@/lib/apiClient";
import type { PlaceMatch } from "@/lib/cities";
import { countryName } from "@/lib/place";
import { cn } from "@/lib/cn";

// Discover's place search — a city OR a country, one box (M12 link 7; it was
// M11b link 2's city-only search, `CitySearch`, until then).
//
// **The static `<option>` city dropdown is gone and must not come back.** The
// design handoff says so twice and the exit gate restates it: "No `<option>`
// city list exists anywhere in the tree." A dropdown can only offer the places
// the page happens to be holding; this asks the server, which knows every city
// and country any published day touches.
//
// **Every row and every chip says which kind it is**, and that is the point of
// the link rather than decoration: the library holds the city Mexico City and
// the country Mexico, and `Mexic` has to offer both as two things a click can
// tell apart (M12 link 7's collision). A flat list of bare names cannot say
// which one was picked.
//
// The exit gate names FOUR states and this component's whole job is that all
// four are reachable against the real endpoint:
//
//   * **loading** — a query is in flight;
//   * **results** — the endpoint answered with places;
//   * **no match** — the endpoint answered with none. A real answer, rendered
//     as one, and deliberately not the same thing as a failure;
//   * **failure** — with a Retry that re-runs the SAME query rather than
//     clearing the box, because a person who typed "Kyo" and lost their
//     connection wants "Kyo" again.
//
// The `city-search-*` test ids and the `selected-cities` row predate countries
// and are kept: `e2e/m11b-playbooks.spec.ts` finds the box by them, and a
// testid rename is a two-sided edit (docs/guidelines/testing.md §5).

/** ~250ms: inside the design's own 240-440ms simulated latency band. */
const DEBOUNCE_MS = 250;

/** One selected place — what a pick adds and a chip removes. */
export type PlacePick = { kind: "city"; city: string } | { kind: "country"; countryCode: string };

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "results"; places: PlaceMatch[] }
  | { kind: "empty" }
  | { kind: "failed"; message: string };

const KIND_LABEL = { city: "City", country: "Country" } as const;

const pickOf = (match: PlaceMatch): PlacePick =>
  match.kind === "city" ? { kind: "city", city: match.city } : { kind: "country", countryCode: match.countryCode };

/**
 * What a selected country's chip reads. `countryName` rather than the search
 * result's `name` because a country can arrive from the URL with no result
 * behind it — and the server's `name` IS `countryName` (`server/places.ts`),
 * so this is the same derivation, not a second one.
 */
const countryLabel = (code: string): string => countryName(code) ?? code;

/**
 * The small uppercase kind tag a row and a chip both lead with. Leading, not
 * trailing, so "Mexico City" and "Mexico" differ in their first word as well
 * as their last.
 */
function KindTag({ kind }: { kind: PlacePick["kind"] }) {
  return (
    <span
      aria-hidden
      data-testid="place-kind"
      className="font-mono text-2xs tracking-wider uppercase text-slate"
    >
      {KIND_LABEL[kind]}
    </span>
  );
}

/** Discover's one search box: cities and countries, labelled, either one selectable. */
export function PlaceSearch({
  selected,
  onAdd,
  onRemove,
}: {
  selected: { cities: readonly string[]; countries: readonly string[] };
  onAdd: (place: PlacePick) => void;
  onRemove: (place: PlacePick) => void;
}) {
  const [text, setText] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });

  const isSelected = (match: PlaceMatch): boolean =>
    match.kind === "city" ? selected.cities.includes(match.city) : selected.countries.includes(match.countryCode);

  // Same generation guard the read hook uses: keystrokes race, and without it
  // the slower of two in-flight searches wins and the list shows results for a
  // query the box no longer contains.
  const generation = useRef(0);

  const run = useCallback(async (q: string) => {
    const mine = ++generation.current;
    if (q.trim() === "") {
      setState({ kind: "idle" });
      return;
    }
    setState({ kind: "loading" });
    const result = await searchPlaces(q);
    if (mine !== generation.current) return;
    if (!result.ok) {
      setState({ kind: "failed", message: result.error.message });
      return;
    }
    setState(result.value.length === 0 ? { kind: "empty" } : { kind: "results", places: result.value });
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void run(text), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, run]);

  const hasSelection = selected.cities.length > 0 || selected.countries.length > 0;

  return (
    <div className="flex flex-col gap-2">
      {/* Enter takes the first match, which is what a search box is expected
          to do and what the chip row below makes obvious once it happens
          (Mitchell, 2026-09-01: "Pressing enter in many fields doesnt submit").
          Deliberately the FIRST result and not a free-text add: the places
          that reach the query have to be spelled the way the library spells
          them — `matchedCities` is an exact containment test against the same
          index, and a country travels as its code (server/playbooks.ts) — so a
          typed word that matched nothing must add nothing. */}
      <Input
        type="search"
        aria-label="Search cities and countries"
        placeholder="Search a city or country — Kyoto, Japan, Mexico City"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={submitOnEnter(() => {
          if (state.kind !== "results") return;
          const firstMatch = state.places.find((match) => !isSelected(match));
          if (firstMatch === undefined) return;
          onAdd(pickOf(firstMatch));
          setText("");
        })}
      />

      {hasSelection && (
        <div className="flex flex-wrap gap-1.5" data-testid="selected-cities">
          {selected.countries.map((code) => (
            <Button
              key={`country:${code}`}
              type="button"
              variant="secondary"
              size="sm"
              data-kind="country"
              // Brand-edged where a city chip is hairline: the kind tag says it
              // in words, the edge says it at a glance across a row of chips.
              className="gap-1.5 rounded-full border-brand"
              // The name carries the action AND the kind: a row of chips named
              // "Mexico" tells a screen-reader user neither what pressing one
              // does nor whether it was the country or the city.
              aria-label={`Remove ${countryLabel(code)} (country)`}
              onClick={() => onRemove({ kind: "country", countryCode: code })}
            >
              <KindTag kind="country" />
              {countryLabel(code)} ×
            </Button>
          ))}
          {selected.cities.map((city) => (
            <Button
              key={`city:${city}`}
              type="button"
              variant="secondary"
              size="sm"
              data-kind="city"
              className="gap-1.5 rounded-full"
              aria-label={`Remove ${city} (city)`}
              onClick={() => onRemove({ kind: "city", city })}
            >
              <KindTag kind="city" />
              {city} ×
            </Button>
          ))}
        </div>
      )}

      <div aria-live="polite" data-testid="city-search-state">
        {state.kind === "loading" && (
          <Text variant="muted" data-testid="city-search-loading">
            Searching places…
          </Text>
        )}
        {state.kind === "empty" && (
          <Text variant="muted" data-testid="city-search-empty">
            No city or country matches “{text}”.
          </Text>
        )}
        {state.kind === "failed" && (
          <div className="flex items-center gap-2" data-testid="city-search-failed">
            <Text variant="muted">Place search is unavailable.</Text>
            <Button type="button" variant="secondary" size="sm" onClick={() => void run(text)}>
              Retry
            </Button>
          </div>
        )}
        {state.kind === "results" && (
          <div className="flex flex-wrap gap-1.5" data-testid="city-search-results">
            {state.places.map((match) => {
              const label = match.kind === "city" ? match.city : match.name;
              const taken = isSelected(match);
              return (
                <Button
                  key={match.kind === "city" ? `city:${match.city}` : `country:${match.countryCode}`}
                  type="button"
                  variant="secondary"
                  size="sm"
                  data-kind={match.kind}
                  className={cn("gap-1.5 rounded-full", match.kind === "country" && "border-brand", taken && "opacity-60")}
                  disabled={taken}
                  // Name first, kind last: "Mexico · 6 (country)". The visible
                  // row leads with the tag, but a spoken name that starts with
                  // the place is the one a listener can skim — and it is the
                  // shape `m11b-playbooks.spec.ts` matches (`^Kyoto · `).
                  aria-label={`${label} · ${match.days} (${match.kind})`}
                  onClick={() => {
                    onAdd(pickOf(match));
                    // The box empties on a pick, not on a keystroke: the chip
                    // row above is now the record of what was chosen, and
                    // leaving the text behind would make the next search start
                    // with somebody else's word in it.
                    setText("");
                  }}
                >
                  <KindTag kind={match.kind} />
                  {label} · {match.days}
                </Button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
