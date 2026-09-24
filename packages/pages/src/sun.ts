// Sunrise, sunset and the golden hour for a place and a date (M14 link 11;
// widget brainstorm tier B).
//
// **NOAA's solar-position equations, written out here rather than a library.**
// The brainstorm offered either; these are about forty lines, public domain
// (NOAA Global Monitoring Laboratory's solar calculator, after Meeus,
// *Astronomical Algorithms*), and this package's only dependencies are
// `@tc/contracts` and `zod` — a third for one function would be the larger
// change. Accuracy is about a minute away from the poles; the tests hold two.
//
// Pure: a date string and a point in, UTC instants out. No clock, no zone —
// turning an instant into "04:25" is `clock.ts`'s job, with the zone the server
// computed.

/** An instant (UTC ms), or the sun stays `"up"` / `"down"` past that altitude all day. */
export type SunTime = number | "up" | "down";

export interface SunEvents {
  sunrise: SunTime;
  sunset: SunTime;
  /** Morning golden hour: sunrise until the sun is six degrees up. */
  goldenMorningEnd: SunTime;
  /** Evening golden hour: from six degrees up until sunset. */
  goldenEveningStart: SunTime;
}

const rad = (deg: number) => (deg * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

// The altitude of the sun's centre at the moment its upper limb meets a flat
// horizon: 34′ of refraction plus 16′ of semi-diameter. NOAA's figure.
const HORIZON = -0.833;
// The golden hour's usual photographer's bound (SunCalc and most apps use it).
const GOLDEN = 6;

/** Declination (degrees) and the equation of time (minutes) at a Julian day. */
function solar(julianDay: number): { declination: number; equationOfTime: number } {
  const t = (julianDay - 2451545) / 36525;
  const meanLongitude = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const meanAnomaly = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const eccentricity = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const m = rad(meanAnomaly);
  const centre =
    Math.sin(m) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * m) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * m) * 0.000289;
  const omega = rad(125.04 - 1934.136 * t);
  const apparentLongitude = rad(meanLongitude + centre - 0.00569 - 0.00478 * Math.sin(omega));
  const meanObliquity = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliquity = rad(meanObliquity + 0.00256 * Math.cos(omega));
  const declination = deg(Math.asin(Math.sin(obliquity) * Math.sin(apparentLongitude)));
  const y = Math.tan(obliquity / 2) ** 2;
  const l0 = rad(meanLongitude);
  const equationOfTime = 4 * deg(
    y * Math.sin(2 * l0) -
      2 * eccentricity * Math.sin(m) +
      4 * eccentricity * y * Math.sin(m) * Math.cos(2 * l0) -
      0.5 * y * y * Math.sin(4 * l0) -
      1.25 * eccentricity * eccentricity * Math.sin(2 * m),
  );
  return { declination, equationOfTime };
}

/**
 * When the sun crosses `altitude` on the way up (or down), near solar noon of
 * the UTC calendar day starting at `dayStart`.
 *
 * Iterated: the declination and equation of time are read at the estimate and
 * the estimate recomputed, three times. The first guess is solar noon, and at
 * high latitude a sunrise can be nine hours from it — far enough that the
 * sun's position at noon misplaces it by minutes.
 */
function crossing(dayStart: number, lat: number, lng: number, altitude: number, rising: boolean): SunTime {
  let minutes = 720 - 4 * lng;
  for (let pass = 0; pass < 3; pass++) {
    const { declination, equationOfTime } = solar((dayStart + minutes * 60_000) / 86_400_000 + 2440587.5);
    const cosHourAngle =
      (Math.sin(rad(altitude)) - Math.sin(rad(lat)) * Math.sin(rad(declination))) /
      (Math.cos(rad(lat)) * Math.cos(rad(declination)));
    if (cosHourAngle > 1) return "down";
    if (cosHourAngle < -1) return "up";
    const hourAngle = deg(Math.acos(cosHourAngle));
    const noon = 720 - 4 * lng - equationOfTime;
    minutes = rising ? noon - 4 * hourAngle : noon + 4 * hourAngle;
  }
  return dayStart + minutes * 60_000;
}

/**
 * The day's sun, for `isoDate` at a point (`lng` east-positive).
 *
 * The date is read as the UTC calendar day, and the events are the ones around
 * that day's solar noon at `lng` — which is the local calendar day's noon
 * wherever the zone roughly follows the sun. Where it does not, a sunset can
 * land after local midnight (Reykjavik in June), and that is real: the caller
 * prints it with the date it falls on.
 */
export function sunEvents(isoDate: string, lat: number, lng: number): SunEvents {
  const dayStart = Date.parse(`${isoDate}T00:00:00Z`);
  return {
    sunrise: crossing(dayStart, lat, lng, HORIZON, true),
    sunset: crossing(dayStart, lat, lng, HORIZON, false),
    goldenMorningEnd: crossing(dayStart, lat, lng, GOLDEN, true),
    goldenEveningStart: crossing(dayStart, lat, lng, GOLDEN, false),
  };
}
