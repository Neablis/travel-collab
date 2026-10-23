"use client";
import { NOTHING_MORE_TODAY, nowAndNext, type NowStop, type TripNowPayload } from "@tc/pages";
import { DirectionsLink, StopName, useBlockClock } from "./dayOfParts";

// *Now and next* (M52 decision 15): the stop under way and the next one, each
// with Directions when it has a place. The payload holds every stop not yet
// over, so the two are re-picked by the page's minute clock (`nowAndNext`).
//
// Spans, not divs: a widget node is an inline atom inside a paragraph.

/** Now and next: the stop under way and the one after, with the time until it. */
export function TripNowBlock({ payload, interactive }: { payload: TripNowPayload; interactive: boolean }) {
  const at = useBlockClock();
  if (at === null) return null;
  const { current, next } = nowAndNext(payload, at);
  if (current === null && next === null) return <span className="text-sm text-slate">{NOTHING_MORE_TODAY}</span>;
  return (
    <span className="flex flex-col gap-3 rounded-md border border-hairline bg-surface px-3.5 py-3">
      {current && <NowRow label="Now" stop={current} detail={current.time} interactive={interactive} />}
      {next && <NowRow label="Next" stop={next} detail={`in ${next.until} · ${next.time}`} interactive={interactive} />}
    </span>
  );
}

function NowRow({ label, stop, detail, interactive }: { label: string; stop: NowStop; detail: string; interactive: boolean }) {
  return (
    <span className="flex items-start gap-3">
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-xs font-medium text-slate">{label}</span>
        <StopName activityId={stop.activityId} title={stop.title} interactive={interactive} />
        <span className="text-sm text-slate">{detail}</span>
      </span>
      {stop.place && <DirectionsLink place={stop.place} mode={stop.mode} label={`Directions to ${stop.title}`} />}
    </span>
  );
}
