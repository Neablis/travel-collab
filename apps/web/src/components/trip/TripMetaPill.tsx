import type { TripDetail } from "@tc/contracts";
import { Button } from "@/components/ui/button";
import { formatTripDate } from "@/lib/formatDate";
import { initialsFor } from "@/lib/initials";
import { chipModel } from "./DayChips";

// Handoff `current/…dc.html:255-296`: a bordered pill — accent dot, date
// range, then (each separated by a divider) day/stop/city counts, then a
// crew control (stacked avatars + label) that opens Trip settings.
export function TripMetaPill({ detail, onOpenSettings }: { detail: TripDetail; onOpenSettings: () => void }) {
  const days = detail.days;
  const stops = days.reduce((sum, d) => sum + d.activityIds.length, 0);
  const cities = new Set(chipModel(detail).map((d) => d.city).filter((c): c is string => c !== null));

  const start = days[0]?.date ?? detail.startDate;
  const end = days[days.length - 1]?.date ?? null;
  const dateRange =
    start === null
      ? "No dates set"
      : end === null || end === start
        ? formatTripDate(start)
        : `${formatTripDate(start)} – ${formatTripDate(end)}`;

  return (
    <div className="inline-flex items-center gap-3 rounded-full border border-hairline bg-surface py-1.5 pl-3 pr-3.5">
      <span aria-hidden className="size-2.5 shrink-0 rounded-full bg-brand" />
      <span className="font-mono text-xs text-ink">{dateRange}</span>

      <span aria-hidden className="h-3.5 w-px shrink-0 bg-hairline" />
      <span className="font-mono text-xs text-slate">{days.length} days</span>

      <span aria-hidden className="h-3.5 w-px shrink-0 bg-hairline" />
      <span className="font-mono text-xs text-slate">{stops} stops</span>

      <span aria-hidden className="h-3.5 w-px shrink-0 bg-hairline" />
      <span className="font-mono text-xs text-slate">{cities.size} cities</span>

      <span aria-hidden className="h-3.5 w-px shrink-0 bg-hairline" />
      <Button
        variant="ghost"
        onClick={onOpenSettings}
        aria-label={`${detail.members.length} travellers`}
        className="h-auto gap-2 rounded-full p-0 font-normal"
      >
        <span className="flex items-center">
          {detail.members.map((member) => (
            <span
              key={member.userId}
              aria-hidden
              className="-mr-1.5 grid size-5 shrink-0 place-items-center rounded-full bg-moss font-semibold text-slate"
              // eslint-disable-next-line no-restricted-syntax -- 9px avatar-initial size and the 1.5px ring have no token equivalent, matching AssistantRail's mark-glyph computed-geometry pattern
              style={{ fontSize: "9px", boxShadow: "0 0 0 1.5px var(--color-surface)" }}
            >
              {initialsFor(member.userId)}
            </span>
          ))}
        </span>
        <span className="font-mono text-xs text-slate">{detail.members.length} travellers</span>
      </Button>
    </div>
  );
}
