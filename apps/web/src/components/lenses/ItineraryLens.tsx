"use client";

import type { TripDetail } from "@tc/contracts";
import { Heading } from "../ui/heading";
import { Text } from "../ui/text";
import { DataText } from "../ui/data-text";
import { Table, TBody, TR, TD } from "../ui/table";
import { Button } from "../ui/button";
import { itineraryDays, itineraryUnscheduled, type ItineraryActivity } from "./itineraryData";
import { formatMoney as formatAmount } from "./formatMoney";
import { formatTripDate } from "@/lib/formatDate";

function ActivityRow({
  activity,
  currency,
  onSelectActivity,
}: {
  activity: ItineraryActivity;
  currency: string;
  onSelectActivity?: (activityId: string) => void;
}) {
  const timeLabel = activity.start && activity.end ? `${activity.start}–${activity.end}` : null;
  const label = [activity.place, activity.title].filter(Boolean).join(" · ");

  return (
    <TR data-testid={`itinerary-activity-${activity.activityId}`}>
      <TD>{timeLabel ? <DataText>{timeLabel}</DataText> : null}</TD>
      <TD>
        {onSelectActivity ? (
          <Button
            variant="ghost"
            onClick={() => onSelectActivity(activity.activityId)}
            className="h-auto justify-start p-0 text-left text-base font-normal text-ink underline-offset-2 hover:bg-transparent hover:underline"
          >
            {label}
          </Button>
        ) : (
          <Text as="span">{label}</Text>
        )}
      </TD>
      <TD className="text-right">
        <DataText>{activity.costMinor !== null ? formatAmount(activity.costMinor, currency) : "—"}</DataText>
      </TD>
    </TR>
  );
}

export function ItineraryLens({
  detail,
  onSelectActivity,
}: {
  detail: TripDetail;
  onSelectActivity?: (activityId: string) => void;
}) {
  const days = itineraryDays(detail);
  const unscheduled = itineraryUnscheduled(detail);

  return (
    <div data-testid="itinerary-lens" className="flex flex-col gap-4">
      {days.map((day) => (
        <section key={day.dayId} data-testid={`itinerary-day-${day.dayId}`} className="rounded-lg border border-hairline bg-surface p-3">
          <Heading level={3} className="mb-2">
            Day {day.ordinal}
            {day.date && (
              <>
                {" · "}
                <DataText as="span" size="base" className="font-normal">
                  {formatTripDate(day.date)}
                </DataText>
              </>
            )}
          </Heading>
          {day.activities.length === 0 ? (
            <Text variant="secondary">No activities.</Text>
          ) : (
            <Table>
              <TBody>
                {day.activities.map((activity) => (
                  <ActivityRow key={activity.activityId} activity={activity} currency={detail.currency} onSelectActivity={onSelectActivity} />
                ))}
              </TBody>
            </Table>
          )}
          <div className="mt-2 flex justify-between rounded-md border-t border-hairline bg-moss px-2.5 py-2 text-sm font-medium">
            <span>Day subtotal</span>
            <DataText>{formatAmount(day.costSubtotal, detail.currency)}</DataText>
          </div>
        </section>
      ))}

      <section data-testid="itinerary-unscheduled" className="rounded-lg border border-hairline bg-surface p-3">
        <Heading level={3} className="mb-2">
          Unscheduled
        </Heading>
        {unscheduled.length === 0 ? (
          <Text variant="secondary">Nothing unscheduled.</Text>
        ) : (
          <Table>
            <TBody>
              {unscheduled.map((activity) => (
                <ActivityRow key={activity.activityId} activity={activity} currency={detail.currency} onSelectActivity={onSelectActivity} />
              ))}
            </TBody>
          </Table>
        )}
      </section>

      <footer data-testid="itinerary-footer" className="flex justify-between border-t border-border-strong pt-3 font-semibold">
        <span>Trip total</span>
        <span>
          <DataText>{formatAmount(detail.tripCostTotal, detail.currency)}</DataText>
          {detail.budget && (
            <>
              {" / budget "}
              <DataText>{formatAmount(detail.budget.amountMinor, detail.budget.currency)}</DataText>
              {detail.budgetRemaining !== null && (
                <>
                  {" (remaining "}
                  <DataText className={detail.budgetRemaining < 0 ? "text-warning-ink" : undefined}>
                    {formatAmount(detail.budgetRemaining, detail.currency)}
                  </DataText>
                  {")"}
                </>
              )}
            </>
          )}
        </span>
      </footer>
    </div>
  );
}
