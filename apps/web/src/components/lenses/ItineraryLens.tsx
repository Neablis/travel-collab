"use client";

import type { TripDetail } from "@tc/contracts";
import { itineraryDays, itineraryUnscheduled, type ItineraryActivity } from "./itineraryData";

function formatAmount(costMinor: number, currency: string): string {
  return `${(costMinor / 100).toFixed(2)} ${currency}`;
}

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
  const label = [timeLabel, activity.place, activity.title].filter(Boolean).join(" · ");

  return (
    <li
      data-testid={`itinerary-activity-${activity.activityId}`}
      style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "2px 0" }}
    >
      {onSelectActivity ? (
        <button
          type="button"
          onClick={() => onSelectActivity(activity.activityId)}
          style={{ border: "none", background: "none", padding: 0, textAlign: "left", cursor: "pointer" }}
        >
          {label}
        </button>
      ) : (
        <span>{label}</span>
      )}
      <span>{activity.costMinor !== null ? formatAmount(activity.costMinor, currency) : "—"}</span>
    </li>
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
    <div data-testid="itinerary-lens" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {days.map((day) => (
        <section key={day.dayId} data-testid={`itinerary-day-${day.dayId}`} style={{ border: "1px solid #ddd", borderRadius: 6, padding: 8 }}>
          <h3 style={{ margin: "0 0 6px", fontSize: 14, fontWeight: 600 }}>
            Day {day.ordinal}
            {day.date && <span style={{ fontWeight: 400, color: "#666" }}> · {day.date}</span>}
          </h3>
          {day.activities.length === 0 ? (
            <p style={{ margin: 0, color: "#888", fontSize: 13 }}>No activities.</p>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {day.activities.map((activity) => (
                <ActivityRow key={activity.activityId} activity={activity} currency={detail.currency} onSelectActivity={onSelectActivity} />
              ))}
            </ul>
          )}
          <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid #eee", display: "flex", justifyContent: "space-between", fontWeight: 600, fontSize: 13 }}>
            <span>Day subtotal</span>
            <span>{formatAmount(day.costSubtotal, detail.currency)}</span>
          </div>
        </section>
      ))}

      <section data-testid="itinerary-unscheduled" style={{ border: "1px solid #ddd", borderRadius: 6, padding: 8 }}>
        <h3 style={{ margin: "0 0 6px", fontSize: 14, fontWeight: 600 }}>Unscheduled</h3>
        {unscheduled.length === 0 ? (
          <p style={{ margin: 0, color: "#888", fontSize: 13 }}>Nothing unscheduled.</p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {unscheduled.map((activity) => (
              <ActivityRow key={activity.activityId} activity={activity} currency={detail.currency} onSelectActivity={onSelectActivity} />
            ))}
          </ul>
        )}
      </section>

      <footer data-testid="itinerary-footer" style={{ display: "flex", justifyContent: "space-between", fontWeight: 600, paddingTop: 8, borderTop: "2px solid #ccc" }}>
        <span>Trip total</span>
        <span>
          {formatAmount(detail.tripCostTotal, detail.currency)}
          {detail.budget && (
            <>
              {" "}
              / budget {formatAmount(detail.budget.amountMinor, detail.budget.currency)}
              {detail.budgetRemaining !== null && (
                <> (remaining {formatAmount(detail.budgetRemaining, detail.currency)})</>
              )}
            </>
          )}
        </span>
      </footer>
    </div>
  );
}
