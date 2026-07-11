"use client";

import type { TripDetail } from "@tc/contracts";
import { dailyRows } from "./dailyOverviewData";
import { formatMoney } from "./formatMoney";

export function DailyOverviewLens({ detail }: { detail: TripDetail }) {
  const rows = dailyRows(detail);

  if (rows.length === 0) {
    return <p>No days yet.</p>;
  }

  return (
    <div data-testid="daily-overview-lens" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", padding: "4px 8px", borderBottom: "2px solid #ddd" }}>Day</th>
            <th style={{ textAlign: "left", padding: "4px 8px", borderBottom: "2px solid #ddd" }}>Date</th>
            <th style={{ textAlign: "right", padding: "4px 8px", borderBottom: "2px solid #ddd" }}>Activities</th>
            <th style={{ textAlign: "right", padding: "4px 8px", borderBottom: "2px solid #ddd" }}>Subtotal</th>
            <th style={{ textAlign: "left", padding: "4px 8px", borderBottom: "2px solid #ddd" }}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.dayId} data-testid={`daily-overview-row-${row.dayId}`}>
              <td style={{ padding: "4px 8px", borderBottom: "1px solid #eee" }}>Day {row.ordinal}</td>
              <td style={{ padding: "4px 8px", borderBottom: "1px solid #eee", color: "#666" }}>{row.date ?? "—"}</td>
              <td style={{ padding: "4px 8px", borderBottom: "1px solid #eee", textAlign: "right" }}>{row.activityCount}</td>
              <td style={{ padding: "4px 8px", borderBottom: "1px solid #eee", textAlign: "right" }}>
                {formatMoney(row.costSubtotal, detail.currency)}
              </td>
              <td style={{ padding: "4px 8px", borderBottom: "1px solid #eee" }}>
                {row.conflictCount > 0 && (
                  <span
                    data-testid={`daily-overview-conflict-badge-${row.dayId}`}
                    style={{
                      display: "inline-block",
                      background: "#fdecea",
                      color: "#b3261e",
                      borderRadius: 4,
                      padding: "1px 6px",
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    {row.conflictCount} conflict{row.conflictCount === 1 ? "" : "s"}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr data-testid="daily-overview-footer">
            <td style={{ padding: "4px 8px", fontWeight: 600 }} colSpan={3}>
              Trip total
            </td>
            <td style={{ padding: "4px 8px", fontWeight: 600, textAlign: "right" }}>
              {formatMoney(detail.tripCostTotal, detail.currency)}
            </td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
