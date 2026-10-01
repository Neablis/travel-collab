import type { SunAxis, SunPayload, SunRow } from "@tc/pages";
import { DataText } from "@/components/ui/data-text";
import { cn } from "@/lib/cn";
import { CITY_FILL, CITY_INK, CITY_OUTLINE, type CityAccents } from "../cityAccents";

// The sun block's graphic (design 1a, "daylight ribbons"): one row per day,
// each a ribbon from its sunrise to its sunset on ONE clock shared by the whole
// widget, so two days compare by where their ribbons sit.
//
// **The golden hour is drawn, not written**: the ribbon's two ends, as far in
// as the sun is under six degrees, are the city's colour at lower strength.
// There is no legend and no sentence under the graphic.
//
// **A polar day says so in words**, where the sunrise would be: there are no
// two times to print. Its ribbon is the whole axis, or absent. `data-state`
// carries the same fact for a test, which may not read a class.
//
// **It never scrolls sideways.** The label and daylight columns are fixed, the
// ribbon takes what is left, and no row has a minimum width. From `@lg` the
// sunrise and sunset sit at the ribbon's two ends, as the design draws them.
// Under it there is no room for two more columns beside a ribbon worth
// drawing, so they drop beneath it, still at its ends. The step is on the
// block's OWN width (a container query), as the weather graphic's is.
//
// A row has a minimum height, not a fixed one: "12:03 am (next day)" wraps in
// its column rather than being cut. The sun is a function of the trip, not of
// today, so a row never changes height under a reader (ADR-044's concern).

const LABEL = "w-20 shrink-0 @lg:w-24";
// "14h 35m" is seven mono characters: 51px at text-xs.
const LENGTH = "w-14 shrink-0 text-right";
const ROW = "flex w-full items-center gap-2 px-3 @lg:gap-2.5 @lg:px-4";
// The ribbon and its two times. Wrapping puts the ribbon on its own line when
// narrow; from `@lg` the three sit in the design's order on one.
const SPAN = "flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-2 gap-y-1 @lg:flex-nowrap @lg:gap-x-2.5";
// 80px from `@lg`: "(next day)" is ten mono characters, 72px at text-xs.
const EDGE = "max-w-full @lg:order-none @lg:w-20 @lg:shrink-0";
const TRACK = "relative order-first block w-full @lg:order-none @lg:w-auto @lg:min-w-0 @lg:flex-1";

const POLAR = { "up-all-day": "sun up all day", "down-all-day": "sun down all day" } as const;

const clampOn = (axis: SunAxis) => (minute: number) => Math.min(axis.endMinute, Math.max(axis.startMinute, minute));
const percentOn = (axis: SunAxis) => (minute: number) =>
  ((clampOn(axis)(minute) - axis.startMinute) / (axis.endMinute - axis.startMinute)) * 100;

function Ticks({ axis }: { axis: SunAxis }) {
  const at = percentOn(axis);
  return (
    <span aria-hidden className={cn(ROW, "h-5")}>
      <span className={LABEL} />
      <span className={SPAN}>
        <span className={cn(EDGE, "hidden @lg:block")} />
        <span className={cn(TRACK, "h-4")}>
          {axis.ticks.map((tick) => (
            <DataText
              key={tick.minute}
              size="xs"
              className="absolute -translate-x-1/2 whitespace-nowrap"
              // eslint-disable-next-line no-restricted-syntax -- a tick's place on the axis is data; no token can name it
              style={{ left: `${at(tick.minute)}%` }}
            >
              {tick.label}
            </DataText>
          ))}
        </span>
        <span className={cn(EDGE, "hidden @lg:block")} />
      </span>
      <span className={LENGTH} />
    </span>
  );
}

/**
 * Where the ribbon sits on the axis, and how far in from each end its golden
 * hour reaches — as shares of the RIBBON, since they are drawn inside it. A
 * sunset past the axis's end stops at it, and its golden hour with it.
 */
function ribbonOf(row: SunRow, axis: SunAxis) {
  if (row.state === "down-all-day") return null;
  if (row.sunriseMinute === null || row.sunsetMinute === null) return { left: 0, width: 100, morning: 0, evening: 0 };
  const clamp = clampOn(axis);
  const at = percentOn(axis);
  const from = clamp(row.sunriseMinute);
  const to = clamp(row.sunsetMinute);
  const share = (minutes: number) => (to > from ? (Math.min(to - from, Math.max(0, minutes)) / (to - from)) * 100 : 0);
  return {
    left: at(from),
    width: at(to) - at(from),
    morning: row.goldenMorningEndMinute === null ? 0 : share(clamp(row.goldenMorningEndMinute) - from),
    evening: row.goldenEveningStartMinute === null ? 0 : share(to - clamp(row.goldenEveningStartMinute)),
  };
}

function Ribbon({ row, axis, accents }: { row: SunRow; axis: SunAxis; accents: CityAccents }) {
  const at = percentOn(axis);
  const family = accents.ofCity(row.city);
  const ribbon = ribbonOf(row, axis);
  return (
    <span aria-hidden className={cn(TRACK, "h-3 rounded-sm bg-moss @lg:h-4.5")}>
      {axis.ticks.map((tick) => (
        <span
          key={tick.minute}
          className="absolute inset-y-0 w-px bg-hairline"
          // eslint-disable-next-line no-restricted-syntax -- as the tick row: the gridline sits where its tick does
          style={{ left: `${at(tick.minute)}%` }}
        />
      ))}
      {ribbon === null ? null : (
        <span
          data-testid="sun-ribbon"
          // The border is the fill's own colour for a city; for a day with none
          // it is what makes a hairline-grey ribbon a mark on the track at all.
          className={cn(
            "absolute inset-y-0 flex justify-between overflow-hidden rounded-sm border",
            CITY_FILL[family],
            CITY_OUTLINE[family],
          )}
          // eslint-disable-next-line no-restricted-syntax -- the ribbon IS the day's sunrise and sunset on the axis
          style={{ left: `${ribbon.left}%`, width: `${ribbon.width}%` }}
        >
          {/* eslint-disable-next-line no-restricted-syntax -- the golden hour is the day's own, a share of its ribbon */}
          <span className="block h-full bg-surface/60" style={{ width: `${ribbon.morning}%` }} />
          {/* eslint-disable-next-line no-restricted-syntax -- as the morning's */}
          <span className="block h-full bg-surface/60" style={{ width: `${ribbon.evening}%` }} />
        </span>
      )}
    </span>
  );
}

function Row({ row, axis, accents }: { row: SunRow; axis: SunAxis; accents: CityAccents }) {
  return (
    <span role="row" data-state={row.state} className={cn(ROW, "min-h-10 border-t border-hairline py-1.5")}>
      <span role="rowheader" className={cn(LABEL, "flex min-w-0 flex-col leading-tight")}>
        {/* A row with no city is headed by its day, so the day is not said twice. */}
        <span className={cn("truncate text-sm font-medium", CITY_INK[accents.ofCity(row.city)])}>
          {row.city ?? row.label}
        </span>
        {row.city === null ? null : (
          <DataText size="xs" className="truncate">
            {row.label}
          </DataText>
        )}
      </span>
      <span role="presentation" className={SPAN}>
        <DataText
          role="cell"
          aria-label="sunrise"
          size="xs"
          className={cn(EDGE, "order-1 leading-tight @lg:text-right", row.state === "normal" && "text-ink")}
        >
          {row.state === "normal" ? row.sunrise : POLAR[row.state]}
        </DataText>
        <Ribbon row={row} axis={axis} accents={accents} />
        <DataText role="cell" aria-label="sunset" size="xs" className={cn(EDGE, "order-2 text-right leading-tight text-ink @lg:text-left")}>
          {row.sunset}
        </DataText>
      </span>
      <DataText role="cell" aria-label="daylight" size="xs" className={LENGTH}>
        {row.daylight}
      </DataText>
    </span>
  );
}

/** The sun block as daylight ribbons: sunrise to sunset per day on one shared clock, the golden hour drawn at each end. */
export function SunGraphic({ payload, accents }: { payload: SunPayload; accents: CityAccents }) {
  return (
    <span role="table" aria-label={payload.summary} className="@container flex flex-col pt-3">
      <Ticks axis={payload.axis} />
      {payload.rows.map((row) => (
        <Row key={row.key} row={row} axis={payload.axis} accents={accents} />
      ))}
    </span>
  );
}
