"use client";

import type { TripDetail } from "@tc/contracts";
import { Heading } from "../ui/heading";
import { Text } from "../ui/text";
import { DataText } from "../ui/data-text";
import { EmptyState } from "../ui/empty-state";
import { Button } from "../ui/button";
import { timelineRows } from "./timelineData";

const DAY_START_MIN = 6 * 60; // 06:00
const DAY_END_MIN = 22 * 60; // 22:00
const DAY_SPAN_MIN = DAY_END_MIN - DAY_START_MIN;

function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function clampPercent(minutes: number): number {
  const pct = ((minutes - DAY_START_MIN) / DAY_SPAN_MIN) * 100;
  return Math.min(100, Math.max(0, pct));
}

export function TimelineLens({
  detail,
  onSelectActivity,
}: {
  detail: TripDetail;
  onSelectActivity?: (activityId: string) => void;
}) {
  const rows = timelineRows(detail);

  if (rows.length === 0) {
    return <EmptyState title="No days yet." />;
  }

  return (
    <div data-testid="timeline-lens" className="flex flex-col gap-4">
      {rows.map((row) => (
        <div key={row.dayId} data-testid={`timeline-row-${row.dayId}`} className="rounded-md border border-hairline p-2">
          <Heading level={3} className="mb-1.5">
            Day {row.ordinal}
            {row.date && (
              <>
                {" · "}
                <DataText as="span" size="base" className="font-normal">
                  {row.date}
                </DataText>
              </>
            )}
          </Heading>

          <div
            className="relative rounded-sm border border-hairline bg-moss"
            // eslint-disable-next-line no-restricted-syntax -- computed geometry (position math), not tokenable
            style={{ height: 40, marginBottom: row.untimed.length > 0 ? 8 : 0 }}
          >
            {row.timed.map((item) => {
              const left = clampPercent(toMinutes(item.start));
              const right = clampPercent(toMinutes(item.end));
              const width = Math.max(right - left, 1);
              const geometry = {
                left: `${left}%`,
                width: `${width}%`,
                top: 4,
                bottom: 4,
              };
              const blockClassName =
                "absolute overflow-hidden text-ellipsis whitespace-nowrap rounded-sm border border-brand bg-brand-tint px-1.5 py-0.5 text-xs text-brand-pressed";
              return onSelectActivity ? (
                <Button
                  key={item.activityId}
                  variant="ghost"
                  data-testid={`timeline-item-${item.activityId}`}
                  title={`${item.title} (${item.start}–${item.end})`}
                  onClick={() => onSelectActivity(item.activityId)}
                  className={`${blockClassName} h-auto justify-start border-brand text-left hover:bg-brand-tint`}
                  // eslint-disable-next-line no-restricted-syntax -- computed geometry (position math), not tokenable
                  style={geometry}
                >
                  {item.title}
                </Button>
              ) : (
                <div
                  key={item.activityId}
                  data-testid={`timeline-item-${item.activityId}`}
                  title={`${item.title} (${item.start}–${item.end})`}
                  className={blockClassName}
                  // eslint-disable-next-line no-restricted-syntax -- computed geometry (position math), not tokenable
                  style={geometry}
                >
                  {item.title}
                </div>
              );
            })}
          </div>

          {row.untimed.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {row.untimed.map((item) =>
                onSelectActivity ? (
                  <li key={item.activityId} data-testid={`timeline-untimed-${item.activityId}`}>
                    <Button
                      variant="ghost"
                      onClick={() => onSelectActivity(item.activityId)}
                      className="h-auto rounded-sm bg-moss px-2 py-0.5 text-xs font-normal text-ink hover:bg-moss"
                    >
                      {item.title}
                    </Button>
                  </li>
                ) : (
                  <li key={item.activityId} data-testid={`timeline-untimed-${item.activityId}`} className="rounded-sm bg-moss px-2 py-0.5 text-xs text-ink">
                    <Text as="span" variant="muted">
                      {item.title}
                    </Text>
                  </li>
                ),
              )}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
