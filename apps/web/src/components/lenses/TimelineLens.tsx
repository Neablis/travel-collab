"use client";

import type { TripDetail } from "@tc/contracts";
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

export function TimelineLens({ detail }: { detail: TripDetail }) {
  const rows = timelineRows(detail);

  if (rows.length === 0) {
    return <p>No days yet.</p>;
  }

  return (
    <div data-testid="timeline-lens" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {rows.map((row) => (
        <div
          key={row.dayId}
          data-testid={`timeline-row-${row.dayId}`}
          style={{ border: "1px solid #ddd", borderRadius: 6, padding: 8 }}
        >
          <div style={{ fontWeight: 600, marginBottom: 6 }}>
            Day {row.ordinal}
            {row.date && <span style={{ fontWeight: 400, color: "#666" }}> · {row.date}</span>}
          </div>

          <div
            style={{
              position: "relative",
              height: 40,
              background: "#f5f5f5",
              borderRadius: 4,
              marginBottom: row.untimed.length > 0 ? 8 : 0,
            }}
          >
            {row.timed.map((item) => {
              const left = clampPercent(toMinutes(item.start));
              const right = clampPercent(toMinutes(item.end));
              const width = Math.max(right - left, 1);
              return (
                <div
                  key={item.activityId}
                  data-testid={`timeline-item-${item.activityId}`}
                  title={`${item.title} (${item.start}–${item.end})`}
                  style={{
                    position: "absolute",
                    left: `${left}%`,
                    width: `${width}%`,
                    top: 4,
                    bottom: 4,
                    background: "#4f7cff",
                    color: "white",
                    borderRadius: 4,
                    padding: "2px 6px",
                    fontSize: 12,
                    overflow: "hidden",
                    whiteSpace: "nowrap",
                    textOverflow: "ellipsis",
                  }}
                >
                  {item.title}
                </div>
              );
            })}
          </div>

          {row.untimed.length > 0 && (
            <ul style={{ display: "flex", flexWrap: "wrap", gap: 6, listStyle: "none", padding: 0, margin: 0 }}>
              {row.untimed.map((item) => (
                <li
                  key={item.activityId}
                  data-testid={`timeline-untimed-${item.activityId}`}
                  style={{
                    background: "#eee",
                    borderRadius: 4,
                    padding: "2px 8px",
                    fontSize: 12,
                  }}
                >
                  {item.title}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
