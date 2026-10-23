"use client";
import { formatTimeUntil, type FlightLine, type TripFlightsPayload } from "@tc/pages";
import { Button } from "@/components/ui/button";
import { useOptionalEditor } from "@/components/trip/context/EditorHost";
import { useOptionalTrip } from "@/components/trip/context/TripProvider";
import { StopName, useBlockClock } from "./dayOfParts";

// *Your flights* (M52 decision 15): today's flights or the next one, and the
// countdown to each that has not left, on the page's minute clock.
//
// **Add your flight** is offered only where it can work: the stop editor is
// hosted (the board, not a notebook's own page) and the reader may edit the
// trip. Anywhere else the line says there is none, and nothing renders
// disabled (SPEC §27).

const HEADING = { today: "Today's flights", next: "Next flight" } as const;

/** Your flights: a line per flight, or the offer to add one. */
export function TripFlightsBlock({ payload, interactive }: { payload: TripFlightsPayload; interactive: boolean }) {
  const at = useBlockClock();
  const editor = useOptionalEditor();
  const canEdit = useOptionalTrip()?.canEditBoard ?? false;
  if (payload.heading === "none") {
    return (
      <span className="flex items-center gap-3 rounded-md border border-hairline bg-surface px-3.5 py-3">
        <span className="flex-1 text-sm text-slate">No flights on this trip yet</span>
        {interactive && editor && canEdit && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => editor.openCreate({ dayId: payload.dayId ?? undefined, title: "Flight", kind: "transit", mode: "flight" })}
          >
            Add your flight
          </Button>
        )}
      </span>
    );
  }
  return (
    <span className="flex flex-col gap-3 rounded-md border border-hairline bg-surface px-3.5 py-3">
      <span className="text-xs font-medium text-slate">{HEADING[payload.heading]}</span>
      {payload.flights.map((flight) => (
        <FlightRow key={flight.activityId} flight={flight} at={at} interactive={interactive} />
      ))}
    </span>
  );
}

function FlightRow({ flight, at, interactive }: { flight: FlightLine; at: number | null; interactive: boolean }) {
  const route = [flight.flightNumber, flight.from && flight.to ? `${flight.from} → ${flight.to}` : (flight.from ?? flight.to)]
    .filter(Boolean)
    .join(" · ");
  return (
    <span className="flex flex-col gap-0.5">
      <StopName activityId={flight.activityId} title={flight.title} interactive={interactive} />
      {route && <span className="text-sm text-ink">{route}</span>}
      {flight.departs && <span className="text-sm text-slate">{`${flight.departs} → ${flight.arrives ?? "?"}`}</span>}
      {flight.startsAt !== null && at !== null && flight.startsAt > at && (
        <span className="text-sm text-slate">{`Leaves in ${formatTimeUntil(flight.startsAt - at)}`}</span>
      )}
    </span>
  );
}
