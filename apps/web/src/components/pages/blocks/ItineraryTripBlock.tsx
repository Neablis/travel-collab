import type { ItineraryTripPayload } from "@tc/pages";
import { ItineraryDayBlock } from "./ItineraryDayBlock";

// Read-only block: renders every day's itinerary from the resolver payload only.
//
// Spans rather than `<div>`s, for the reason `ItineraryDayBlock` gives at
// length: a widget node is an inline atom, so this renders inside a paragraph.
export function ItineraryTripBlock({ payload }: { payload: ItineraryTripPayload }) {
  return (
    <span className="flex flex-col gap-3">
      {payload.days.map((day) => (
        <span key={day.dayId} className="flex flex-col gap-1">
          <span className="text-xs font-semibold tracking-wide text-slate uppercase">{day.date ?? "Undated day"}</span>
          <ItineraryDayBlock payload={day} />
        </span>
      ))}
    </span>
  );
}
