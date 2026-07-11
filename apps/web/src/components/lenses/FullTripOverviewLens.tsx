"use client";

import type { TripDetail } from "@tc/contracts";
import { tripOverview } from "./tripOverviewData";
import { formatMoney } from "./formatMoney";

export function FullTripOverviewLens({ detail }: { detail: TripDetail }) {
  const overview = tripOverview(detail);

  return (
    <section aria-label="Full trip overview" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <header>
        <h2 style={{ margin: 0 }}>{detail.name}</h2>
        {overview.dateRange ? (
          <p style={{ margin: "4px 0 0", color: "#555" }}>
            {overview.dateRange.from === overview.dateRange.to
              ? overview.dateRange.from
              : `${overview.dateRange.from} – ${overview.dateRange.to}`}
            {" · "}
            {overview.dayCount} {overview.dayCount === 1 ? "day" : "days"}
          </p>
        ) : (
          <p style={{ margin: "4px 0 0", color: "#555" }}>No dates set yet</p>
        )}
      </header>

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontWeight: "bold" }}>
          <span>Trip total</span>
          <span>{formatMoney(overview.tripCostTotal, overview.currency)}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#555" }}>
          <span>Scheduled</span>
          <span>{formatMoney(overview.scheduledTotal, overview.currency)}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#555" }}>
          <span>Unscheduled</span>
          <span>{formatMoney(overview.unscheduledTotal, overview.currency)}</span>
        </div>
      </div>

      <div
        role="status"
        style={{
          display: "flex",
          justifyContent: "space-between",
          padding: 8,
          borderRadius: 4,
          background: overview.overBudget ? "#fdecea" : "#eef5ff",
          color: overview.overBudget ? "#a4231b" : "#1a1a1a",
        }}
      >
        {overview.budget === null ? (
          <span>No budget set</span>
        ) : (
          <>
            <span>Budget: {formatMoney(overview.budget.amountMinor, overview.currency)}</span>
            <span>
              {overview.overBudget
                ? `Over by ${formatMoney(Math.abs(overview.budgetRemaining ?? 0), overview.currency)}`
                : `Remaining: ${formatMoney(overview.budgetRemaining ?? 0, overview.currency)}`}
            </span>
          </>
        )}
      </div>
    </section>
  );
}
