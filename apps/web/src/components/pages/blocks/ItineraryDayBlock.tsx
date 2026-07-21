import type { ItineraryDayPayload } from "@tc/pages";

// Read-only block: renders a single day's activity list from the resolver
// payload only — no markup ever crosses the resolver boundary (C-era swap seam).
export function ItineraryDayBlock({ payload }: { payload: ItineraryDayPayload }) {
  return (
    <div className="rounded-md border border-hairline bg-surface p-3">
      <ul className="flex flex-col gap-2">
        {payload.activities.map((activity, i) => (
          <li key={i} className="flex items-baseline justify-between gap-3 border-b border-hairline pb-2 last:border-b-0 last:pb-0">
            <div className="flex flex-col">
              <span className="text-base text-ink">{activity.title}</span>
              {activity.timeWindow && <span className="text-xs text-slate">{activity.timeWindow}</span>}
            </div>
            {activity.cost && <span className="text-sm text-slate">{activity.cost}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
