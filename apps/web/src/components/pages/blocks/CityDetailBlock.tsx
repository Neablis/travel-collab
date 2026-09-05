import type { CityDetailPayload } from "@tc/pages";
import { cn } from "@/lib/cn";
import { CITY_INK, CITY_TINT, type CityAccents } from "../cityAccents";

// "The cities in detail" — one bordered block, one row per city.
//
// The shape is `ItineraryTripBlock`'s deliberately: the two answer the same
// question about different entities ("what is this trip made of"), and giving
// them different furniture would make a notebook holding both read as two
// products. A fixed left column via `w-32` rather than a grid template, for the
// same reason — an arbitrary `grid-cols-[136px_1fr]` is what the colour wall
// refuses.
//
// **The colour is the trip's, not this widget's.** Mitchell, on the preview:
// *"The every day at a glance and every city at a glance are not rendering
// correctly and dont use the color coding we put together when showing a city."*
// `accents.ofCity` is the same lookup the board and `MacroView`'s city chips
// use, so Kyoto is the same colour here as in a Day column. `packages/pages`
// sends the NAME and never a colour (ADR-037 decision 1).
//
// Spans rather than `<div>`s: a widget node is an inline atom, so this renders
// inside a paragraph and the HTML parser would close the paragraph at a `<div>`
// — the server's DOM and the client's then disagree, which React reports as a
// hydration error. `display: block` on a span gets the same layout with none of
// that.
export function CityDetailBlock({ payload, accents }: { payload: CityDetailPayload; accents: CityAccents }) {
  return (
    <span role="table" className="block overflow-hidden rounded-md border border-hairline">
      {payload.cities.map((city) => {
        const family = accents.ofCity(city.name);
        return (
          <span
            role="row"
            key={city.name}
            className={cn(
              "flex items-baseline gap-3 border-b border-hairline px-3 py-2 last:border-b-0",
              CITY_TINT[family],
            )}
          >
            <span role="rowheader" className={cn("w-32 shrink-0 text-xs font-semibold", CITY_INK[family])}>
              {city.name}
            </span>
            <span role="cell" className="min-w-0 text-sm text-ink">
              {/* A city with no days behind it is one only an unscheduled stop
                  names — real, and the honest thing to say about it is that
                  nothing is planned there yet rather than to print an empty
                  cell, which in a bordered row reads as a rendering fault. */}
              {city.dayOrdinals.length === 0
                ? "Not on the itinerary yet"
                : city.dayOrdinals.map((ordinal) => `Day ${ordinal}`).join(", ")}
            </span>
            <span role="cell" className="shrink-0 font-mono text-2xs text-slate">
              {city.activityCount === 1 ? "1 stop" : `${city.activityCount} stops`}
            </span>
          </span>
        );
      })}
    </span>
  );
}
