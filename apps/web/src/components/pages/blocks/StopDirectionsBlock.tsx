"use client";
import type { StopDirectionsPayload } from "@tc/pages";
import { DirectionsLink, StopName } from "./dayOfParts";

// *Directions* (M52 decisions 15, 16): one stop and the link that opens the
// maps app on the way there. Spans, not divs: a widget node is an inline atom.

/** Directions: the stop's name and time, and the link to Maps. */
export function StopDirectionsBlock({ payload, interactive }: { payload: StopDirectionsPayload; interactive: boolean }) {
  return (
    <span className="flex items-center gap-3 rounded-md border border-hairline bg-surface px-3.5 py-3">
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <StopName activityId={payload.activityId} title={payload.title} interactive={interactive} />
        {payload.time && <span className="text-sm text-slate">{payload.time}</span>}
      </span>
      <DirectionsLink place={payload.place} mode={payload.mode} label={`Directions to ${payload.title}`} />
    </span>
  );
}
