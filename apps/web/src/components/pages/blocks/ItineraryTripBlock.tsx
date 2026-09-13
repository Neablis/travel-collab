import type { ItineraryDayPayload, ItineraryTripPayload } from "@tc/pages";
import { cn } from "@/lib/cn";
import { CITY_INK, CITY_TINT, type CityAccents } from "../cityAccents";
import { dayMetaParts } from "./dayMeta";

// How many stops a day's summary line names before it counts the rest. Three,
// per dc.html:5123 — the line answers "what is this day", not "what is on it";
// `itinerary.day` is the widget that answers the second question.
const NAMED_STOPS = 3;

// The day's shape, minus its date — the left column of every row already
// carries that, and a table that printed it twice on one line would be using
// the reader's attention on the one fact they had just read.
function meta(day: ItineraryDayPayload): string {
  return dayMetaParts(day)
    .filter((part) => part !== day.date)
    .join(" · ");
}

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
              // `items-start`, not `items-baseline`: the right cell is two lines
              // now, and a baseline alignment would hang the day label off the
              // first of them and leave the second below the row's own box.
              "flex items-start gap-3 border-b border-hairline px-3 py-2 last:border-b-0",
              CITY_TINT[family],
            )}
          >
            <span role="rowheader" className="flex w-32 shrink-0 flex-col gap-0.5">
              <span className={cn("text-xs font-semibold", CITY_INK[family])}>Day {day.ordinal}</span>
              {/* Not `font-mono` any more. The face was doing a job while this
                  printed the stored ISO — digit columns that line up down the
                  table — and once the date reads "Jun 1, 2027" a monospace face
                  only makes it look machine-written again, which is the half of
                  *"Still have the non human readable timestamp here"* that
                  survives the formatter. */}
              <span className="text-2xs text-slate">{day.date ?? "No date"}</span>
            </span>
            <span role="cell" className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm text-ink">{summarise(day)}</span>
              {/* **The day's shape under its contents, which is the half SPEC
                  §24's timeline had and this table did not.** A glance at a trip
                  is not only "what is on each day" — it is where the day is, how
                  full it is, when it runs and what it costs, which is exactly
                  what the deleted lens's day header carried. The date is in the
                  left column already, so it is dropped from this line rather
                  than printed twice. */}
              <span className="text-2xs text-slate">{meta(day)}</span>
            </span>
          </span>
        );
      })}
    </span>
  );
}
