import { pointText, type RoundedPoint } from "../roundedPoint";
import { UpstreamError, type Climate, type Fetched, type MonthlyNormals } from "./ports";

// NASA POWER's Climatology API, for "typical" (ADR-052's sources table).
//
// **TO VERIFY — none of this has been read against the POWER docs directly;
// this container cannot reach `power.larc.nasa.gov`.** Each item is listed in
// ADR-052's review points as well:
//
// 1. The endpoint path `/api/temporal/climatology/point` and its query
//    (`parameters`, `community`, `latitude`, `longitude`, `format=JSON`) —
//    from web search of the POWER docs and the `nasapower` R client.
// 2. The response shape: GeoJSON with
//    `properties.parameter.<NAME>.<JAN…DEC|ANN>`, `header.fill_value` (-999)
//    for a month with no value, and the averaging period in `header.start` /
//    `header.end` as `YYYYMMDD`. `fixtures/power-climatology.json` is written
//    to that belief, not recorded.
// 3. The averaging period: believed 2001–2020 for meteorology. If the header
//    does not carry it, `PERIOD_IF_UNSTATED` is printed — and it is a belief.
// 4. Whether POWER publishes a rate figure. It throttles "repetitive and rapid
//    requests" with no number; a 429 here backs off like MET's.
// 5. `community=AG`: the community only changes units for some parameters;
//    AG's are °C and mm/day for the three read here.
//
// Keyless. The terms ask for an acknowledgement, which the block renders
// (decision 5), and to be told of uses (larc-power-project@mail.nasa.gov).

const ENDPOINT = "https://power.larc.nasa.gov/api/temporal/climatology/point";
const PARAMETERS = ["T2M_MAX", "T2M_MIN", "PRECTOTCORR"] as const;
const MONTH_KEYS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"] as const;
// Normals do not change between a trip's planning and its end; a month is
// ADR-052 decision 2's figure.
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 4000;
const FALLBACK_BACKOFF_MS = 60 * 60 * 1000;
const PERIOD_IF_UNSTATED = { fromYear: 2001, throughYear: 2020 };

interface ClimatologyBody {
  properties?: { parameter?: Partial<Record<(typeof PARAMETERS)[number], Partial<Record<string, number>>>> };
  header?: { fill_value?: number; start?: string; end?: string; range?: string };
}

function periodOf(header: ClimatologyBody["header"]): MonthlyNormals["period"] {
  const from = /^(\d{4})/.exec(header?.start ?? "")?.[1];
  const through = /^(\d{4})/.exec(header?.end ?? "")?.[1];
  if (from && through) return { fromYear: Number(from), throughYear: Number(through) };
  // "(January 2001 - December 2020)" in the human-readable range.
  const years = header?.range?.match(/\b(19|20)\d{2}\b/g);
  if (years && years.length >= 2) return { fromYear: Number(years[0]), throughYear: Number(years[years.length - 1]) };
  return PERIOD_IF_UNSTATED;
}

/** POWER's body, normalized: one entry per month that has all three values. */
export function parseClimatology(body: ClimatologyBody): MonthlyNormals {
  const fill = body.header?.fill_value ?? -999;
  const table = body.properties?.parameter ?? {};
  const value = (name: (typeof PARAMETERS)[number], month: string): number | null => {
    const v = table[name]?.[month];
    return typeof v === "number" && Number.isFinite(v) && v !== fill ? v : null;
  };
  const months: MonthlyNormals["months"] = [];
  MONTH_KEYS.forEach((key, i) => {
    const highC = value("T2M_MAX", key);
    const lowC = value("T2M_MIN", key);
    const rain = value("PRECTOTCORR", key);
    // A month with a hole is left out rather than printed with a guess.
    if (highC === null || lowC === null || rain === null) return;
    months.push({ month: i + 1, highC, lowC, precipitationMmPerDay: Math.max(0, rain) });
  });
  return { months, period: periodOf(body.header) };
}

/** A `Climate` backed by NASA POWER's climatology endpoint; `now` is injected for tests. */
export function createNasaPowerClimate(options: { userAgent: string | null; now?: () => Date }): Climate {
  const now = options.now ?? (() => new Date());
  return {
    async normals(at: RoundedPoint): Promise<Fetched<MonthlyNormals>> {
      const { lat, lng } = pointText(at);
      const url = new URL(ENDPOINT);
      url.searchParams.set("parameters", PARAMETERS.join(","));
      url.searchParams.set("community", "AG");
      url.searchParams.set("latitude", lat);
      url.searchParams.set("longitude", lng);
      url.searchParams.set("format", "JSON");
      const headers: Record<string, string> = { Accept: "application/json" };
      // Not a POWER condition, but the same courtesy as MET's: say who is asking.
      if (options.userAgent) headers["User-Agent"] = options.userAgent;
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
      const asked = now();
      if (res.status === 429) {
        throw new UpstreamError("NASA POWER: 429", 429, new Date(asked.getTime() + FALLBACK_BACKOFF_MS));
      }
      if (!res.ok) throw new UpstreamError(`NASA POWER: ${res.status}`, res.status);
      const normals = parseClimatology((await res.json()) as ClimatologyBody);
      if (normals.months.length === 0) throw new UpstreamError("NASA POWER: no month had a value");
      return {
        kind: "fresh", value: normals, expiresAt: new Date(asked.getTime() + TTL_MS),
        lastModified: null, sourceUpdatedAt: null,
      };
    },
  };
}
