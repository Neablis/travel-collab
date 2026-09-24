import type { CountryFactsCard, CountryFactsPayload } from "@tc/pages";
import { DataText } from "@/components/ui/data-text";

// "Know before you go" — a card per country the trip stops in.
//
// Spans with ARIA roles, not `Card` (a `<div>`) or `<dl>`: a widget node is an
// inline atom, so this renders inside a paragraph and a block element there is
// closed early by the HTML parser — the hydration error `ItineraryDayBlock`
// records. `term`/`definition` carry what a `<dl>` would have.
//
// The card is the day card's furniture — a caption strip on `bg-paper` over a
// bordered body — so a notebook holding both reads as one product. Facts are in
// a fixed grid rather than a flowing line so every card has the same height and
// the same fact sits in the same place on each (ADR-044's "the value never
// moves", applied across cards rather than across modes).

// The order a traveller needs them in: what to pack, then what to know on the
// road, then what to have in a pocket.
const FACTS: readonly { key: keyof CountryFactsCard; label: string; data: boolean }[] = [
  { key: "plugs", label: "Plugs", data: true },
  { key: "power", label: "Power", data: true },
  { key: "drives", label: "Drives on", data: false },
  { key: "emergency", label: "Emergency", data: true },
  { key: "currency", label: "Currency", data: true },
  { key: "callingCode", label: "Calling code", data: true },
  { key: "tipping", label: "Tipping", data: false },
];

export function CountryFactsBlock({ payload }: { payload: CountryFactsPayload }) {
  return (
    <span role="list" className="flex flex-col gap-3">
      {payload.countries.map((country) => (
        <span
          role="listitem"
          aria-label={country.name}
          key={country.code}
          className="block overflow-hidden rounded-md border border-hairline bg-surface"
        >
          <span className="flex items-baseline justify-between gap-3 border-b border-hairline bg-paper px-3 py-2">
            <span className="text-sm font-semibold text-ink">{country.name}</span>
            <DataText size="xs">{country.code}</DataText>
          </span>
          <span className="grid grid-cols-2 gap-x-4 gap-y-2 px-3 py-2 sm:grid-cols-4">
            {FACTS.map(({ key, label, data }) => {
              // `null` is the table saying it is not sure (`data/countries.ts`);
              // a dash is honest where a guess would be dangerous.
              const value = country[key] ?? "—";
              return (
                <span key={key} className="flex min-w-0 flex-col">
                  <span role="term" className="text-xs text-slate">{label}</span>
                  <span role="definition" className="min-w-0">
                    {data && value !== "—"
                      ? <DataText className="text-ink">{value}</DataText>
                      : <span className="text-sm text-ink">{value}</span>}
                  </span>
                </span>
              );
            })}
          </span>
        </span>
      ))}
    </span>
  );
}
