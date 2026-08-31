"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { searchCities } from "@/lib/apiClient";
import type { CityMatch } from "@/lib/cities";
import { cn } from "@/lib/cn";

// Discover's city search (M11b link 2's UI half).
//
// **The static `<option>` city dropdown is gone and must not come back.** The
// design handoff says so twice and the exit gate restates it: "No `<option>`
// city list exists anywhere in the tree." A dropdown can only offer the cities
// the page happens to be holding; this asks the server, which knows every city
// any published day touches.
//
// The exit gate names FOUR states and this component's whole job is that all
// four are reachable against the real endpoint:
//
//   * **loading** — a query is in flight;
//   * **results** — the endpoint answered with cities;
//   * **no city matches** — the endpoint answered with none. A real answer,
//     rendered as one, and deliberately not the same thing as a failure;
//   * **failure** — with a Retry that re-runs the SAME query rather than
//     clearing the box, because a person who typed "Kyo" and lost their
//     connection wants "Kyo" again.

/** ~250ms: inside the design's own 240-440ms simulated latency band. */
const DEBOUNCE_MS = 250;

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "results"; cities: CityMatch[] }
  | { kind: "empty" }
  | { kind: "failed"; message: string };

export function CitySearch({
  selected,
  onAdd,
  onRemove,
}: {
  selected: readonly string[];
  onAdd: (city: string) => void;
  onRemove: (city: string) => void;
}) {
  const [text, setText] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });

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
    const result = await searchCities(q);
    if (mine !== generation.current) return;
    if (!result.ok) {
      setState({ kind: "failed", message: result.error.message });
      return;
    }
    setState(result.value.length === 0 ? { kind: "empty" } : { kind: "results", cities: result.value });
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void run(text), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, run]);

  return (
    <div className="flex flex-col gap-2">
      <Input
        type="search"
        aria-label="Search cities"
        placeholder="Search a city — Kyoto, Osaka, Hakone"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5" data-testid="selected-cities">
          {selected.map((city) => (
            <Button
              key={city}
              type="button"
              variant="secondary"
              size="sm"
              className="rounded-full"
              // The name carries the action, not just the city: a row of chips
              // all named "Kyoto" tells a screen-reader user nothing about what
              // pressing one does.
              aria-label={`Remove ${city}`}
              onClick={() => onRemove(city)}
            >
              {city} ×
            </Button>
          ))}
        </div>
      )}

      <div aria-live="polite" data-testid="city-search-state">
        {state.kind === "loading" && (
          <Text variant="muted" data-testid="city-search-loading">
            Searching cities…
          </Text>
        )}
        {state.kind === "empty" && (
          <Text variant="muted" data-testid="city-search-empty">
            No city matches “{text}”.
          </Text>
        )}
        {state.kind === "failed" && (
          <div className="flex items-center gap-2" data-testid="city-search-failed">
            <Text variant="muted">City search is unavailable.</Text>
            <Button type="button" variant="secondary" size="sm" onClick={() => void run(text)}>
              Retry
            </Button>
          </div>
        )}
        {state.kind === "results" && (
          <div className="flex flex-wrap gap-1.5" data-testid="city-search-results">
            {state.cities.map((match) => (
              <Button
                key={match.city}
                type="button"
                variant="secondary"
                size="sm"
                className={cn("rounded-full", selected.includes(match.city) && "opacity-60")}
                disabled={selected.includes(match.city)}
                onClick={() => {
                  onAdd(match.city);
                  // The box empties on a pick, not on a keystroke: the chip row
                  // above is now the record of what was chosen, and leaving the
                  // text behind would make the next search start with somebody
                  // else's word in it.
                  setText("");
                }}
              >
                {match.city} · {match.days}
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
