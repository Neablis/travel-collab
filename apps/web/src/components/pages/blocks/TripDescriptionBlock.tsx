import type { TripDescriptionPayload } from "@tc/pages";
import { DataText } from "@/components/ui/data-text";
import { cn } from "@/lib/cn";
import { TAG_CHIP_CLASS } from "@/lib/activityTags";

// "Trip description" (`trip.description`, M42 D11): the words the home card
// shows, and the top tags behind them as the board's own chips, each with its
// share. Spans throughout: this sits inside a paragraph.
export function TripDescriptionBlock({ payload }: { payload: TripDescriptionPayload }) {
  return (
    <span className="flex flex-col gap-2 rounded-md border border-hairline bg-surface p-3">
      <span className="block text-lg font-semibold text-ink">{payload.text}</span>
      <span role="list" aria-label={payload.basis} className="flex flex-wrap items-center gap-2">
        {payload.tags.map((tag) => (
          <span role="listitem" key={tag.key} className="inline-flex items-center gap-1.5">
            <span className={cn("inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-semibold", TAG_CHIP_CLASS[tag.key])}>
              {tag.label}
            </span>
            <DataText size="xs">{tag.share}</DataText>
          </span>
        ))}
      </span>
      <span aria-hidden className="block text-xs text-slate">
        {payload.basis}
      </span>
    </span>
  );
}
