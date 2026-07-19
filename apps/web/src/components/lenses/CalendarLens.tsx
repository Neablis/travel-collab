"use client";

import type { TripDetail } from "@tc/contracts";
import { Text } from "../ui/text";
import { DataText } from "../ui/data-text";
import { Button } from "../ui/button";
import { calendarCells } from "./calendarData";

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function CalendarLens({
  detail,
  onSelectActivity,
}: {
  detail: TripDetail;
  onSelectActivity?: (activityId: string) => void;
}) {
  const cells = calendarCells(detail);

  return (
    <section>
      {cells.length === 0 ? (
        <Text as="span" variant="secondary" role="status">
          Set a start date to see the calendar.
        </Text>
      ) : (
        <div role="grid" aria-label="Trip calendar" className="mt-2 grid grid-cols-7 gap-1">
          {WEEKDAY_LABELS.map((label) => (
            <div key={label} className="text-center text-xs font-semibold text-slate">
              {label}
            </div>
          ))}
          {cells.map((cell) => (
            <div
              key={cell.date}
              data-testid="calendar-cell"
              data-in-trip={cell.inTrip}
              className={`min-h-12 rounded-sm border border-hairline p-1 ${cell.inTrip ? "bg-brand-tint" : "bg-transparent opacity-40"}`}
            >
              <DataText size="xs">{Number(cell.date.slice(-2))}</DataText>
              {cell.inTrip && (
                <div>
                  <Text as="span" variant="muted">
                    Day {cell.ordinal}
                  </Text>
                  {cell.activityIds.length > 0 && (
                    <ul className="m-0 list-none p-0">
                      {cell.activityIds.map((activityId) => {
                        const activity = detail.activities[activityId];
                        if (!activity) return null;
                        return (
                          <li key={activityId}>
                            {onSelectActivity ? (
                              <Button
                                variant="ghost"
                                onClick={() => onSelectActivity(activityId)}
                                className="h-auto justify-start p-0 text-left text-xs font-normal text-ink underline-offset-2 hover:bg-transparent hover:underline"
                              >
                                {activity.title}
                              </Button>
                            ) : (
                              <Text as="span" variant="muted">
                                {activity.title}
                              </Text>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
