"use client";

import type { TripCommand, TripDetail } from "@tc/contracts";
import { calendarCells } from "./calendarData";
import { TripDateControl } from "./TripDateControl";

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function CalendarLens({
  detail,
  onCommand,
}: {
  detail: TripDetail;
  onCommand: (command: TripCommand) => void;
}) {
  const cells = calendarCells(detail);

  return (
    <section>
      <TripDateControl tripId={detail.tripId} startDate={detail.startDate} onCommand={onCommand} />
      {cells.length === 0 ? (
        <p role="status">Set a start date to see the calendar.</p>
      ) : (
        <div
          role="grid"
          aria-label="Trip calendar"
          style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginTop: 8 }}
        >
          {WEEKDAY_LABELS.map((label) => (
            <div key={label} style={{ fontWeight: "bold", textAlign: "center" }}>
              {label}
            </div>
          ))}
          {cells.map((cell) => (
            <div
              key={cell.date}
              data-testid="calendar-cell"
              data-in-trip={cell.inTrip}
              style={{
                border: "1px solid #ccc",
                borderRadius: 4,
                padding: 4,
                minHeight: 48,
                background: cell.inTrip ? "#eef5ff" : "transparent",
                opacity: cell.inTrip ? 1 : 0.4,
              }}
            >
              <div>{Number(cell.date.slice(-2))}</div>
              {cell.inTrip && (
                <div>
                  <small>Day {cell.ordinal}</small>
                  {cell.activityIds.length > 0 && <small> · {cell.activityIds.length} activities</small>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
