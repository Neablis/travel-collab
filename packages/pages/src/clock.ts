// Reading an instant in a named zone, with the runtime's own `Intl` — the only
// time-zone data this package touches (M14 link 11). The zone NAME comes from
// the server (`TripGlobals`); the rules for it come from the ICU data every
// browser and Node already ship, so no dataset enters a client bundle.
//
// Pure in the sense this package needs: the output is a function of the
// arguments and the runtime's tz database, and nothing reads a clock
// (Invariant 4 — an instant is always handed in).

const formatters = new Map<string, Intl.DateTimeFormat>();

function partsIn(zone: string, utcMs: number): Record<"year" | "month" | "day" | "hour" | "minute", number> {
  let format = formatters.get(zone);
  if (format === undefined) {
    // `h23`, never `hour12: false`: the latter prints midnight as "24" in some
    // engines, which would put a sunset at "24:03".
    format = new Intl.DateTimeFormat("en-US", {
      timeZone: zone, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    });
    formatters.set(zone, format);
  }
  const out = { year: 0, month: 0, day: 0, hour: 0, minute: 0 };
  for (const part of format.formatToParts(utcMs)) {
    if (part.type in out) out[part.type as keyof typeof out] = Number(part.value);
  }
  return out;
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * An instant as a calendar date and a 24-hour `HH:mm` in `zone`, to the
 * minute. Seconds are rounded, not truncated, so 04:25:40 reads 04:26 — a
 * sunrise table that is consistently a minute early is a small lie told daily.
 */
export function clockIn(zone: string, utcMs: number): { date: string; time: string } {
  const p = partsIn(zone, Math.round(utcMs / 60_000) * 60_000);
  return { date: `${p.year}-${pad(p.month)}-${pad(p.day)}`, time: `${pad(p.hour)}:${pad(p.minute)}` };
}

/** How far `zone` is ahead of UTC at an instant, in minutes — negative behind. */
export function offsetMinutes(zone: string, utcMs: number): number {
  const at = Math.floor(utcMs / 60_000) * 60_000;
  const p = partsIn(zone, at);
  return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - at) / 60_000);
}

/**
 * Noon on a calendar day in `zone`, as an instant. The moment a day's offset is
 * read at: daylight saving changes in the small hours, so by noon the day is
 * on the clock it keeps, which is what "16 h ahead" means on that day.
 */
export function noonIn(zone: string, isoDate: string): number {
  const utcNoon = Date.parse(`${isoDate}T12:00:00Z`);
  return utcNoon - offsetMinutes(zone, utcNoon) * 60_000;
}

/** Whether this runtime knows the zone, so a bad name degrades rather than throws. */
export function isKnownZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}
