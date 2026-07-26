import type { ItineraryTripPayload } from "@tc/pages";
import { ItineraryDayBlock } from "./ItineraryDayBlock";

// Read-only block: renders every day's itinerary from the resolver payload only.
export function ItineraryTripBlock({ payload }: { payload: ItineraryTripPayload }) {
  return (
    <div className="flex flex-col gap-3">
      {payload.days.map((day) => (
        <div key={day.dayId} className="flex flex-col gap-1">
          <span className="text-xs font-semibold tracking-wide text-slate uppercase">{day.date ?? "Undated day"}</span>
          <ItineraryDayBlock payload={day} />
        </div>
      ))}
    </div>
  );
}
