// The rules a schema cannot state.
//
// `parseBundle` answers "is this a bundle" — the shape, the enums, the time
// format, the integer money. Everything below is a rule about the CONTENT: a
// day saved in the future, an author in their own adds ledger, a stop with no
// city, a published day nothing is priced on. Each one is a real defect this
// repo has already paid for once, cited where it is checked.
//
// Pure, and deliberately fs-free: the importer's `--dry-run`, the content test
// and the report script all supply their own files. `today` is passed in for
// the same reason every other module here refuses the clock (invariant 4).

import type { ContentBundleV1, BundlePlaybook, BundleStop, BundleTrip } from "./schema.ts";

export type Severity = "error" | "warning";

export interface Finding {
  severity: Severity;
  /** `<bundle id>/<playbook or trip key>`, or just the bundle id for a whole-file finding. */
  where: string;
  message: string;
}

const err = (where: string, message: string): Finding => ({ severity: "error", where, message });
const warn = (where: string, message: string): Finding => ({ severity: "warning", where, message });

/** A day's total, over the stops that carry a price. `null` when currencies disagree. */
export function totalMinor(stops: BundleStop[]): { total: number; currency: string | null; mixed: boolean } {
  let total = 0;
  let currency: string | null = null;
  let mixed = false;
  for (const stop of stops) {
    if (!stop.cost) continue;
    if (currency === null) currency = stop.cost.currency;
    else if (currency !== stop.cost.currency) mixed = true;
    total += stop.cost.amountMinor;
  }
  return { total, currency, mixed };
}

/**
 * Discover's budget bands, as `apps/web/src/lib/playbooks.ts` sets them
 * (`BUDGET_BAND_EDGES`, moved to $200/$500/$1,000 by Mitchell on PR 104).
 *
 * Restated here rather than imported because `apps/web` is downstream of this
 * package and the direction may not reverse. It is a REPORT input, never an
 * assertion — nothing fails because a band is empty — so a drift between the
 * two costs a slightly wrong table and not a wrong verdict. The band names are
 * what `bandsOf` prints.
 */
const BAND_EDGES_MINOR = [20_000, 50_000, 100_000] as const;
export const BAND_NAMES = ["under200", "200to500", "500to1000", "over1000"] as const;
export type BandName = (typeof BAND_NAMES)[number];

export function bandOf(totalMinorValue: number): BandName {
  if (totalMinorValue < BAND_EDGES_MINOR[0]) return "under200";
  if (totalMinorValue < BAND_EDGES_MINOR[1]) return "200to500";
  if (totalMinorValue < BAND_EDGES_MINOR[2]) return "500to1000";
  return "over1000";
}

const SEASONS = ["winter", "spring", "summer", "autumn"] as const;
export type Season = (typeof SEASONS)[number];

/**
 * The bucket Discover's season filter would put a `keptOn` in.
 *
 * Northern-hemisphere meteorological quarters, matching `Season` in
 * `apps/web/src/lib/playbooks.ts`. Report input, like the bands.
 */
export function seasonOf(iso: string): Season | null {
  const month = new Date(iso).getUTCMonth();
  if (Number.isNaN(month)) return null;
  if (month <= 1 || month === 11) return "winter";
  if (month <= 4) return "spring";
  if (month <= 7) return "summer";
  return "autumn";
}

function lintStops(where: string, stops: BundleStop[], what: string): Finding[] {
  const findings: Finding[] = [];
  if (stops.length === 0) return [err(where, `${what} has no stops`)];

  // Chronology. `AddActivity` appends to the end of a day, and the board's
  // Day-columns lens and the calendar render `day.activityIds` VERBATIM — so
  // written order IS the order a person sees, and a day written out of order
  // reads 9pm-first on two real surfaces. (That was a live defect once:
  // docs/design-feedback/2026-08-26-design-sync-ui-audit.md A1.)
  let previousEnd: string | null = null;
  let previousTitle = "";
  for (const stop of stops) {
    if (!stop.timeWindow) continue;
    if (previousEnd !== null && stop.timeWindow.start < previousEnd) {
      findings.push(
        err(
          where,
          `"${stop.title}" starts at ${stop.timeWindow.start}, before "${previousTitle}" ends at ${previousEnd} — stops are stored in written order`,
        ),
      );
    }
    previousEnd = stop.timeWindow.end;
    previousTitle = stop.title;
  }

  // A stop with no city is a stop `citiesOfStops` cannot see, so a playbook
  // made of them is a playbook Discover's city search — the primary way anybody
  // finds one — can never match (M11b link 1).
  const placeless = stops.filter((s) => s.location?.city === undefined);
  if (placeless.length > 0) {
    findings.push(
      warn(
        where,
        `${placeless.length} of ${stops.length} stops carry no location.city (${placeless
          .slice(0, 3)
          .map((s) => `"${s.title}"`)
          .join(", ")}${placeless.length > 3 ? ", …" : ""}) — Discover matches on city`,
      ),
    );
  }

  const { mixed } = totalMinor(stops);
  if (mixed) {
    // `savedDayFacts` refuses to sum a day whose priced stops disagree, so the
    // card shows "—" and the budget filter cannot see it (ADR-008 makes
    // currency trip-level).
    findings.push(err(where, `${what} mixes currencies — its total will not sum`));
  }
  return findings;
}

function lintPlaybook(bundleId: string, playbook: BundlePlaybook, today: string): Finding[] {
  const where = `${bundleId}/${playbook.key}`;
  const findings = lintStops(where, playbook.stops, "playbook");

  if (playbook.keptOn !== undefined) {
    const at = new Date(playbook.keptOn);
    if (Number.isNaN(at.getTime())) {
      findings.push(err(where, `keptOn "${playbook.keptOn}" is not a date`));
    } else if (playbook.keptOn.slice(0, 10) > today) {
      // `keptOn` seeds `created_at` and `published_at`, and Discover's "newest"
      // sorts on them — a day created in the future sorts above every real one
      // and is the freshest-looking thing in a fresh database. Found by
      // CodeRabbit on PR 104, three times in one file.
      findings.push(err(where, `keptOn ${playbook.keptOn.slice(0, 10)} is in the future (today is ${today})`));
    }
  }

  // "Copying your own day into your own trip does not count" — the ledger rule
  // the leaderboard's credibility rests on (M11b link 4), and the one thing a
  // hand-written ledger gets wrong.
  const self = playbook.addedBy.filter((add) => add.addedBy === playbook.ownerId);
  if (self.length > 0) {
    findings.push(err(where, `${playbook.ownerId} appears in their own adds ledger`));
  }

  // `saved_day_adds` is keyed on (saved_day_id, trip_id), so two adds naming
  // one trip collapse into one row and the day quietly loses a count.
  const tripIds = playbook.addedBy.map((a) => a.tripId).filter((id): id is string => id !== undefined);
  if (new Set(tripIds).size !== tripIds.length) {
    findings.push(err(where, "two adds name the same tripId — the ledger's primary key would collapse them"));
  }

  const { total } = totalMinor(playbook.stops);
  if (playbook.visibility === "public" && total === 0) {
    // A published day with nothing priced shows "—" and is invisible to the
    // budget filter — the starter library's own first bullet.
    findings.push(warn(where, "published with nothing priced — it shows no cost and the budget filter cannot see it"));
  }
  return findings;
}

function lintTrip(bundleId: string, trip: BundleTrip): Finding[] {
  const where = `${bundleId}/${trip.key}`;
  const findings: Finding[] = [];
  if (trip.days.length === 0) return [err(where, "trip has no days")];

  trip.days.forEach((day, i) => {
    const label = day.label ?? `day ${i + 1}`;
    if (day.stops.length === 0) {
      // Not an error: `db-seed.ts` leaves one Rochester day empty ON PURPOSE,
      // to exercise the sparkline's empty case. It is worth saying out loud
      // when a whole trip is written that way by accident.
      findings.push(warn(where, `"${label}" has no stops`));
      return;
    }
    findings.push(...lintStops(`${where} · ${label}`, day.stops, `"${label}"`));
  });

  for (const stop of trip.backlog) {
    if (stop.timeWindow) {
      findings.push(err(where, `backlog item "${stop.title}" carries a time window — a parked idea has no slot yet`));
    }
  }

  const all = [...trip.days.flatMap((d) => d.stops), ...trip.backlog];
  const { total } = totalMinor(all);
  if (trip.budget && total > trip.budget.amountMinor) {
    // Not an error either — an over-budget trip is a real state the board is
    // built to show, and `@tc/factories` has a scenario for it. Said out loud
    // because a DEMO trip that opens over budget is usually a typo in a cost.
    findings.push(
      warn(where, `stops total ${total} against a budget of ${trip.budget.amountMinor} — the trip opens over budget`),
    );
  }
  return findings;
}

/** Every rule, over one bundle. `today` is `YYYY-MM-DD`. */
export function lintBundle(bundle: ContentBundleV1, today: string): Finding[] {
  const id = bundle.bundle.id;
  const findings: Finding[] = [];

  const keys = [...bundle.playbooks.map((p) => p.key), ...bundle.trips.map((t) => t.key)];
  const seen = new Set<string>();
  for (const key of keys) {
    // Ids are derived from `(bundle.id, key)`, so a repeated key inside one
    // file is two rows fighting over one id — the second import overwrites the
    // first and the library quietly loses a day.
    if (seen.has(key)) findings.push(err(`${id}/${key}`, "duplicate key inside this bundle"));
    seen.add(key);
  }
  for (const playbook of bundle.playbooks) findings.push(...lintPlaybook(id, playbook, today));
  for (const trip of bundle.trips) findings.push(...lintTrip(id, trip));
  return findings;
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

export interface ContentSummary {
  bundles: number;
  trips: number;
  playbooks: number;
  notebooks: number;
  stops: number;
  publicPlaybooks: number;
  owners: Record<string, number>;
  cities: number;
  seasons: Record<Season, number>;
  bands: Record<BandName, number>;
  authorKinds: Record<string, number>;
}

/**
 * What the whole set looks like, across every bundle.
 *
 * The two rows worth reading are `seasons` and `bands`: Discover has a filter
 * over each, and a bucket with no occupant is *"a control over data that does
 * not exist is a control that does nothing"* — the exact gap the starter
 * library's header flagged and could not fix on its own, because six days
 * cannot fill four seasons and four price bands at once. A set this size can.
 */
export function summarise(bundles: ContentBundleV1[]): ContentSummary {
  const summary: ContentSummary = {
    bundles: bundles.length,
    trips: 0,
    playbooks: 0,
    notebooks: 0,
    stops: 0,
    publicPlaybooks: 0,
    owners: {},
    cities: 0,
    seasons: { winter: 0, spring: 0, summer: 0, autumn: 0 },
    bands: { under200: 0, "200to500": 0, "500to1000": 0, over1000: 0 },
    authorKinds: {},
  };
  const cities = new Set<string>();
  for (const bundle of bundles) {
    summary.trips += bundle.trips.length;
    summary.notebooks += bundle.notebooks.length;
    for (const stop of bundle.activities) {
      summary.stops++;
      if (stop.location?.city) cities.add(stop.location.city);
    }
    for (const trip of bundle.trips) {
      for (const stop of [...trip.days.flatMap((d) => d.stops), ...trip.backlog]) {
        summary.stops++;
        if (stop.location?.city) cities.add(stop.location.city);
      }
    }
    for (const playbook of bundle.playbooks) {
      summary.playbooks++;
      const kind = playbook.origin ?? bundle.bundle.origin;
      summary.authorKinds[kind] = (summary.authorKinds[kind] ?? 0) + 1;
      summary.owners[playbook.ownerId] = (summary.owners[playbook.ownerId] ?? 0) + 1;
      for (const stop of playbook.stops) {
        summary.stops++;
        if (stop.location?.city) cities.add(stop.location.city);
      }
      if (playbook.visibility !== "public") continue;
      summary.publicPlaybooks++;
      // Seasons and bands describe what Discover can FIND, so only published
      // days count: a private day occupies no bucket in a filter that never
      // returns it.
      if (playbook.keptOn) {
        const season = seasonOf(playbook.keptOn);
        if (season) summary.seasons[season]++;
      }
      const { total } = totalMinor(playbook.stops);
      if (total > 0) summary.bands[bandOf(total)]++;
    }
  }
  summary.cities = cities.size;
  return summary;
}
