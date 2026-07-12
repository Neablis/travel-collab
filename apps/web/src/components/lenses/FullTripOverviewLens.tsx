"use client";

import type { TripDetail } from "@tc/contracts";
import { Heading } from "../ui/heading";
import { Text } from "../ui/text";
import { DataText } from "../ui/data-text";
import { Banner } from "../ui/banner";
import { tripOverview } from "./tripOverviewData";
import { formatMoney } from "./formatMoney";

export function FullTripOverviewLens({ detail }: { detail: TripDetail }) {
  const overview = tripOverview(detail);

  return (
    <section aria-label="Full trip overview" className="flex flex-col gap-3">
      <header>
        <Heading level={2}>{detail.name}</Heading>
        {overview.dateRange ? (
          <Text variant="secondary" className="mt-1">
            <DataText as="span" size="sm">
              {overview.dateRange.from === overview.dateRange.to
                ? overview.dateRange.from
                : `${overview.dateRange.from} – ${overview.dateRange.to}`}
            </DataText>
            {" · "}
            {overview.dayCount} {overview.dayCount === 1 ? "day" : "days"}
          </Text>
        ) : (
          <Text variant="secondary" className="mt-1">
            No dates set yet
          </Text>
        )}
      </header>

      <div className="flex flex-col gap-1">
        <div className="flex justify-between font-semibold">
          <span>Trip total</span>
          <DataText>{formatMoney(overview.tripCostTotal, overview.currency)}</DataText>
        </div>
        <div className="flex justify-between text-sm text-slate">
          <span>Scheduled</span>
          <DataText>{formatMoney(overview.scheduledTotal, overview.currency)}</DataText>
        </div>
        <div className="flex justify-between text-sm text-slate">
          <span>Unscheduled</span>
          <DataText>{formatMoney(overview.unscheduledTotal, overview.currency)}</DataText>
        </div>
      </div>

      {overview.budget === null ? (
        <Banner variant="info">No budget set</Banner>
      ) : (
        <Banner variant={overview.overBudget ? "warning" : "info"}>
          <div className="flex justify-between">
            <span>
              Budget: <DataText as="span">{formatMoney(overview.budget.amountMinor, overview.currency)}</DataText>
            </span>
            <span>
              {overview.overBudget
                ? (
                  <>
                    Over by <DataText as="span" className="text-warning-ink">{formatMoney(Math.abs(overview.budgetRemaining ?? 0), overview.currency)}</DataText>
                  </>
                )
                : (
                  <>
                    Remaining: <DataText as="span">{formatMoney(overview.budgetRemaining ?? 0, overview.currency)}</DataText>
                  </>
                )}
            </span>
          </div>
        </Banner>
      )}
    </section>
  );
}
