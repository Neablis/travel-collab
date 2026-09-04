import type { ItineraryDayPayload, ItineraryTripPayload } from "@tc/pages";
import { cn } from "@/lib/cn";
import { CITY_INK, CITY_TINT, type CityAccents } from "../cityAccents";

// How many stops a day's summary line names before it counts the rest. Three,
// per dc.html:5123 — the line answers "what is this day", not "what is on it";
// `itinerary.day` is the widget that answers the second question.
const NAMED_STOPS = 3;

// dc.html:5123. A day with nothing on it says so rather than rendering an empty
// cell, because an empty cell in a bordered table reads as a rendering fault.
function summarise(day: ItineraryDayPayload): string {
  if (day.activities.length === 0) return "Nothing planned yet";
  const named = day.activities.slice(0, NAMED_STOPS).map((a) => a.title).join(" · ");
  const rest = day.activities.length - NAMED_STOPS;
  return rest > 0 ? `${named} · +${rest} more` : named;
}

// "Every day at a glance" — one bordered table, one row per day.
//
// **It used to stack a full `ItineraryDayBlock` per day**, which is the widget
// next to it ("A day's stops") repeated N times: a card per day, every stop
// with its time and cost, nested one card inside another. Mitchell, on the
// preview: *"The every day at a glance and every city at a glance are not
// rendering correctly and dont use the color coding we put together when
// showing a city."* Both halves are here. dc.html:2400 is the shape — a single
// bordered block, a row per day, the day label over the day's city tint and in
// that city's ink, a mono date under it, and one summary line of what is on it.
// A glance is not a list of lists.
//
// The colour is the trip's, not this widget's: `accents` comes from
// `cityAccents`, which feeds `dayAccents` the same per-day cities the board
// does, so a day that is Kyoto-coloured in Day columns is Kyoto-coloured here.
//
// Spans rather than `<div>`s, for the reason `ItineraryDayBlock` gives at
// length: a widget node is an inline atom, so this renders inside a paragraph.
// A fixed left column via `w-32` rather than a two-column grid template, because
// a `grid-cols-[136px_1fr]` is an arbitrary Tailwind value and the color wall
// refuses those.
export function ItineraryTripBlock({ payload, accents }: { payload: ItineraryTripPayload; accents: CityAccents }) {
  return (
    <span role="table" className="block overflow-hidden rounded-md border border-hairline">
      {payload.days.map((day) => {
        const family = accents.ofDayId(day.dayId);
        return (
          <span
            role="row"
            key={day.dayId}
            className={cn(
              "flex items-baseline gap-3 border-b border-hairline px-3 py-2 last:border-b-0",
              CITY_TINT[family],
            )}
          >
            <span role="rowheader" className="flex w-32 shrink-0 flex-col gap-0.5">
              <span className={cn("text-xs font-semibold", CITY_INK[family])}>Day {day.ordinal}</span>
              <span className="font-mono text-2xs text-slate">{day.date ?? "No date"}</span>
            </span>
            <span role="cell" className="min-w-0 text-sm text-ink">{summarise(day)}</span>
          </span>
        );
      })}
    </span>
  );
}
