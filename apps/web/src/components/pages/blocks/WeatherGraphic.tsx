import type { WeatherAxis, WeatherPayload, WeatherRow } from "@tc/pages";
import { DataText } from "@/components/ui/data-text";
import { cn } from "@/lib/cn";
import { CITY_FILL, CITY_INK, CITY_OUTLINE, type CityAccents } from "../cityAccents";

// The weather block's graphic (design 2a, "temperature rows"): one row per
// (day, city), each a bar from its low to its high on ONE scale shared by the
// whole widget, so two rows compare by where their bars sit.
//
// **Line style is the only thing that tells a forecast from an average**: a
// solid bar is the forecast, a dashed outline the month's typical. There is no
// mode word and no legend. `data-source` carries the same fact for a test,
// which may not read a class.
//
// **It never scrolls sideways.** The label and rain columns are fixed, the bar
// column takes what is left, and no row has a minimum width. The widths step
// on the block's OWN width (a container query), not the viewport's: the same
// widget sits in the notebook's column, the Overview and the phone. Under
// `@md` the rain column is 56px, which has room for the value and not for its
// bar — so the bar goes and the value stays.
//
// The bar's track is inset from its column by `TRACK`'s margin, which is the
// room the low and high need: they hang OUTSIDE the bar's ends, and a low
// sitting on the axis minimum would otherwise print over the label column.

const LABEL = "w-24 shrink-0 @md:w-40";
const RAIN = "w-14 shrink-0 @md:w-24";
const ROW = "flex w-full items-center gap-2 px-3 @md:gap-3 @md:px-4";
// 40px a side: "-12°C" is five mono characters, 36px at text-xs, plus the gap.
const TRACK = "relative mx-10 block h-5";

const percentOn = (axis: WeatherAxis) => (value: number) => ((value - axis.min) / (axis.max - axis.min)) * 100;

function Ticks({ axis }: { axis: WeatherAxis }) {
  const at = percentOn(axis);
  return (
    <span aria-hidden className={cn(ROW, "h-5")}>
      <span className={LABEL} />
      <span className="min-w-0 flex-1">
        <span className={TRACK}>
          {axis.ticks.map((tick) => (
            // eslint-disable-next-line no-restricted-syntax -- a tick's place on the axis is data; no token can name it
            <DataText key={tick} size="xs" className="absolute -translate-x-1/2" style={{ left: `${at(tick)}%` }}>
              {tick}°
            </DataText>
          ))}
        </span>
      </span>
      <DataText size="xs" className={cn(RAIN, "text-right")}>
        rain
      </DataText>
    </span>
  );
}

function Range({ row, axis, accents }: { row: WeatherRow; axis: WeatherAxis; accents: CityAccents }) {
  if (row.lowValue === null || row.highValue === null) {
    return (
      <span className="flex h-5 items-center justify-center gap-2">
        <DataText role="cell" aria-label="low" size="xs">—</DataText>
        <DataText role="cell" aria-label="high" size="xs">—</DataText>
      </span>
    );
  }
  const at = percentOn(axis);
  const family = accents.ofCity(row.city);
  const left = at(row.lowValue);
  const right = at(row.highValue);
  return (
    <span className={TRACK}>
      {axis.ticks.map((tick) => (
        // eslint-disable-next-line no-restricted-syntax -- as the tick row: the gridline sits where its tick does
        <span key={tick} className="absolute -inset-y-2.5 w-px bg-hairline" style={{ left: `${at(tick)}%` }} />
      ))}
      <DataText
        role="cell"
        aria-label="low"
        size="xs"
        className="absolute top-1/2 -translate-y-1/2"
        // eslint-disable-next-line no-restricted-syntax -- the low hangs off the bar's left end, which is the row's own low
        style={{ right: `calc(${100 - left}% + 6px)` }}
      >
        {row.low}
      </DataText>
      <span
        data-testid="weather-range"
        className={cn(
          "absolute inset-y-1 min-w-2 rounded-full border-2",
          CITY_OUTLINE[family],
          row.source === "forecast" ? CITY_FILL[family] : "border-dashed bg-surface",
        )}
        // eslint-disable-next-line no-restricted-syntax -- the bar IS the row's low and high on the axis
        style={{ left: `${left}%`, width: `${right - left}%` }}
      />
      <DataText
        role="cell"
        aria-label="high"
        size="xs"
        className="absolute top-1/2 -translate-y-1/2 font-semibold text-ink"
        // eslint-disable-next-line no-restricted-syntax -- the high hangs off the bar's right end, which is the row's own high
        style={{ left: `calc(${right}% + 6px)` }}
      >
        {row.high}
      </DataText>
    </span>
  );
}

function Row({ row, axis, accents }: { row: WeatherRow; axis: WeatherAxis; accents: CityAccents }) {
  // The day, and the sky in words when there is a forecast to have one. A row
  // with no city is headed by its day, so the day is not said twice.
  const under = [row.city === null ? null : row.label, row.sky].filter((part) => part !== null).join(" · ");
  return (
    <span role="row" data-source={row.source ?? undefined} className={cn(ROW, "h-10 border-t border-hairline")}>
      <span role="rowheader" className={cn(LABEL, "flex min-w-0 flex-col leading-tight")}>
        <span className={cn("truncate text-sm font-medium", CITY_INK[accents.ofCity(row.city)])}>
          {row.city ?? row.label}
        </span>
        {under ? (
          <DataText size="xs" className="truncate">
            {under}
          </DataText>
        ) : null}
      </span>
      <span role="presentation" className="min-w-0 flex-1">
        <Range row={row} axis={axis} accents={accents} />
      </span>
      <span role="cell" aria-label="rain" className={cn(RAIN, "flex items-center justify-end gap-1.5")}>
        <DataText size="xs" className={row.rain === null ? undefined : "text-info-ink"}>
          {row.rain ?? "—"}
        </DataText>
        {row.rainShare === null ? null : (
          <span aria-hidden className="hidden h-1.5 w-5.5 overflow-hidden rounded-sm bg-info-tint @md:block">
            {/* eslint-disable-next-line no-restricted-syntax -- the fill is the row's share of a full rain bar */}
            <span className="block h-full bg-info-ink" style={{ width: `${row.rainShare * 100}%` }} />
          </span>
        )}
      </span>
    </span>
  );
}

/** The weather block as temperature rows: a low-to-high bar per (day, city) on one shared scale, solid for a forecast and dashed for an average. */
export function WeatherGraphic({ payload, accents }: { payload: WeatherPayload; accents: CityAccents }) {
  return (
    <span role="table" aria-label={payload.summary} className="@container flex flex-col pt-3">
      <Ticks axis={payload.axis} />
      {payload.rows.map((row) => (
        <Row key={row.key} row={row} axis={payload.axis} accents={accents} />
      ))}
    </span>
  );
}
