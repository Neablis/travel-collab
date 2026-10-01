import type { WeatherAxis, WeatherPayload, WeatherRow } from "@tc/pages";
import { DataText } from "@/components/ui/data-text";
import { cn } from "@/lib/cn";
import { CITY_FILL, CITY_INK, CITY_OUTLINE, type CityAccents } from "../cityAccents";

// The weather block's graphic (design 2a, "temperature rows"): one row per
// (day, city), each a bar from its low to its high on ONE scale shared by the
// whole widget, so two rows compare by where their bars sit.
//
// **Line style is the only thing that tells a forecast from an average** by
// eye: a solid bar is the forecast, a dashed outline the month's typical. There
// is no mode word on screen and no legend; a screen reader is told "Forecast"
// or "Typical" in the row's header. `data-source` carries the same fact for a
// test, which may not read a class.
//
// **It never scrolls sideways.** No row has a minimum width, and the bar takes
// what the fixed columns leave. The layout steps on the block's OWN width (a
// container query), not the viewport's: the same widget sits in the notebook's
// column, the Overview and the phone.
//
// **Under `@md` a row is two lines**: the city, then its day and sky, on one
// line at the row's full width; beneath it the bar and the rain. Beside a
// label column the bar had a few pixels on a phone. Every row is 56px there
// whatever its source (ADR-044), and 40px from `@md`, where the label is a
// 160px column again. The rain column is 60px when narrow, which has room for
// the value and not for its bar — so the bar goes and the value stays.
//
// The narrow arithmetic, in a 273px block (a 375px viewport): 271px inside the
// frame's border and 247px inside the row's padding; less the 60px of rain and
// an 8px gap, the bar's column is 179px, and less `TRACK`'s 32px a side the
// axis is 115px. In a 218px block (a 320px viewport) the same sum leaves 60px.
//
// The bar's track is inset from its column by `TRACK`'s margin, which is room
// for the low and high: they hang OUTSIDE the bar's ends. The widest, "-12°C",
// is five mono characters — 36px at text-xs, 42px with its 6px gap. A low on
// the axis minimum has the margin and the row's own padding to sit in (44px
// when narrow, 56px from `@md`); a high on the maximum has the margin, the
// gap, and whatever the right-aligned rain value leaves of its column.
//
// Under `@md` every other tick is a gridline without a label: eight ticks of
// "-20°" do not fit side by side over 115px.

const SOURCE = { forecast: "Forecast", typical: "Typical" } as const;

const ROW = "flex w-full flex-wrap content-center items-center gap-x-2 gap-y-0.5 px-3 @md:flex-nowrap @md:gap-x-3 @md:px-4";
const LABEL = "w-full min-w-0 @md:w-40 @md:shrink-0";
// 60px narrow: "12.10 mm" is eight mono characters, 58px at text-xs.
const RAIN = "w-15 shrink-0 @md:w-24";
const TRACK = "relative mx-8 block h-5 @md:mx-10";

const percentOn = (axis: WeatherAxis) => (value: number) => ((value - axis.min) / (axis.max - axis.min)) * 100;

function Ticks({ axis }: { axis: WeatherAxis }) {
  const at = percentOn(axis);
  return (
    <span aria-hidden className={cn(ROW, "h-5")}>
      <span className={cn(LABEL, "hidden @md:block")} />
      <span className="min-w-0 flex-1">
        <span className={TRACK}>
          {axis.ticks.map((tick, i) => (
            <DataText
              key={tick}
              size="xs"
              className={cn("absolute -translate-x-1/2", i % 2 === 1 && "hidden @md:inline")}
              // eslint-disable-next-line no-restricted-syntax -- a tick's place on the axis is data; no token can name it
              style={{ left: `${at(tick)}%` }}
            >
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
        // The gridline runs the row's height from `@md`; under it the line above is the label's, so it keeps to the bar's.
        // eslint-disable-next-line no-restricted-syntax -- as the tick row: the gridline sits where its tick does
        <span key={tick} className="absolute inset-y-0 w-px bg-hairline @md:-inset-y-2.5" style={{ left: `${at(tick)}%` }} />
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
    <span role="row" data-source={row.source ?? undefined} className={cn(ROW, "h-14 border-t border-hairline @md:h-10")}>
      <span
        role="rowheader"
        className={cn(LABEL, "flex items-baseline gap-2 leading-tight @md:flex-col @md:items-stretch @md:gap-0")}
      >
        {/* On the shared line the city keeps up to half of it whole, and the day and sky truncate from their end. */}
        <span
          className={cn(
            "max-w-1/2 shrink-0 truncate text-sm font-medium @md:max-w-none",
            CITY_INK[accents.ofCity(row.city)],
          )}
        >
          {row.city ?? row.label}
        </span>
        {under ? (
          <DataText size="xs" className="min-w-0 flex-1 truncate @md:flex-none">
            {under}
          </DataText>
        ) : null}
        {/* Line style is all a sighted reader gets; a screen reader gets the word. */}
        {row.source ? <span className="sr-only">{SOURCE[row.source]}</span> : null}
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
