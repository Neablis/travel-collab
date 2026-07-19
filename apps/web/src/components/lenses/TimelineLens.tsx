"use client";

import type { TripDetail } from "@tc/contracts";
import { Heading } from "../ui/heading";
import { Text } from "../ui/text";
import { DataText } from "../ui/data-text";
import { EmptyState } from "../ui/empty-state";
import { Button } from "../ui/button";
import { useEditor } from "../trip/context/EditorHost";
import { timelineRows, type TimelineRow } from "./timelineData";

const DAY_START_MIN = 6 * 60; // 06:00
const DAY_END_MIN = 22 * 60; // 22:00
const DAY_SPAN_MIN = DAY_END_MIN - DAY_START_MIN;
const DEFAULT_SLOT_MIN = 60; // default duration for a freshly-suggested slot

function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function toTimeString(minutes: number): string {
  const clamped = Math.min(DAY_END_MIN, Math.max(DAY_START_MIN, minutes));
  const h = Math.floor(clamped / 60)
    .toString()
    .padStart(2, "0");
  const m = (clamped % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

function clampPercent(minutes: number): number {
  const pct = ((minutes - DAY_START_MIN) / DAY_SPAN_MIN) * 100;
  return Math.min(100, Math.max(0, pct));
}

const AXIS_TICKS = [6, 9, 12, 15, 18, 21].map((h) => ({
  minute: h * 60,
  label: h === 12 ? "12p" : h < 12 ? `${h}a` : `${h - 12}p`,
}));

// The day-foot "+" trigger's timeWindow: start right after the day's last
// timed activity ends (so a new activity slots in chronologically without
// the user having to retype a time), or the start of the visible day window
// if there are no timed activities yet.
function nextSlot(row: TimelineRow): { start: string; end: string } {
  const lastEnd = row.timed.reduce((max, item) => Math.max(max, toMinutes(item.end)), DAY_START_MIN);
  const start = row.timed.length > 0 ? lastEnd : DAY_START_MIN;
  return { start: toTimeString(start), end: toTimeString(start + DEFAULT_SLOT_MIN) };
}

export function TimelineLens({
  detail,
  onSelectActivity,
}: {
  detail: TripDetail;
  onSelectActivity?: (activityId: string) => void;
}) {
  const rows = timelineRows(detail);
  const { openCreate } = useEditor();

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

          <div className="relative mb-0.5 h-3.5">
            {AXIS_TICKS.map((tick) => (
              <DataText
                key={tick.minute}
                as="span"
                size="xs"
                className="absolute top-0"
                // eslint-disable-next-line no-restricted-syntax -- computed geometry (position math), not tokenable
                style={{ left: `${clampPercent(tick.minute)}%` }}
              >
                {tick.label}
              </DataText>
            ))}
          </div>

          <div
            className="relative rounded-sm border border-hairline bg-moss"
            // eslint-disable-next-line no-restricted-syntax -- computed geometry (position math), not tokenable
            style={{ height: 40, marginBottom: row.untimed.length > 0 ? 8 : 0 }}
          >
            {AXIS_TICKS.map((tick) => (
              <div
                key={tick.minute}
                className="absolute inset-y-0 border-l border-hairline"
                // eslint-disable-next-line no-restricted-syntax -- computed geometry (position math), not tokenable
                style={{ left: `${clampPercent(tick.minute)}%` }}
              />
            ))}
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

          <Button
            variant="ghost"
            data-testid={`timeline-add-${row.dayId}`}
            onClick={() => openCreate({ dayId: row.dayId, timeWindow: nextSlot(row) })}
            className="mt-1.5 h-auto rounded-sm px-2 py-0.5 text-xs font-normal text-slate hover:bg-moss hover:text-ink"
          >
            + Add activity
          </Button>
        </div>
      ))}
    </div>
  );
}
