import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseBundle } from "./schema.ts";
import { lintBundle, summarise } from "./lint.ts";
import { resolvePlaybook } from "./toPlaybooks.ts";
import { bundleTripCommands } from "./toCommands.ts";

// The checked-in content, checked.
//
// This is the `content/` half of what `pnpm seed:verify` does for the Japan
// fixture, and it exists for the same reason: seed content is the one kind of
// code nobody typechecks, because it is not code. A bundle that says a day was
// saved next March, or puts its own author in its adds ledger, parses perfectly
// and is wrong in a way only a reader would notice — six weeks later, in
// Discover, where the day sorts above every real one.
//
// It runs on every `pnpm --filter @tc/fixtures test`, so a bundle added in a
// later PR is checked by CI without anybody remembering to run a script.
// `pnpm content:verify` prints the same findings plus the summary table.

const CONTENT_DIR = fileURLToPath(new URL("../../../../content/", import.meta.url));

/** Every `*.json` under `content/`, at any depth. */
function bundleFiles(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return bundleFiles(path);
    return path.endsWith(".json") ? [path] : [];
  });
}

const files = bundleFiles(CONTENT_DIR);

// A fixed date, not `new Date()`. `keptOn` is checked against "today", and a
// suite whose verdict changes at midnight is a suite that fails on a Tuesday
// for reasons nobody can reproduce. The content is authored against a known
// date; this is that date.
const TODAY = "2026-09-06";

describe("content/ bundles", () => {
  it("there is content to check", () => {
    // Without this the whole file passes vacuously the day somebody moves the
    // directory — every `it.each` over an empty list is a green run that
    // checked nothing.
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((f) => [f.slice(CONTENT_DIR.length), f]))("%s parses as content-bundle/v1", (_name, path) => {
    expect(() => parseBundle(JSON.parse(readFileSync(path, "utf8")))).not.toThrow();
  });

  it("has no content errors", () => {
    const errors = files.flatMap((path) =>
      lintBundle(parseBundle(JSON.parse(readFileSync(path, "utf8"))), TODAY)
        .filter((f) => f.severity === "error")
        .map((f) => `${f.where}: ${f.message}`),
    );
    expect(errors).toEqual([]);
  });

  it("every bundle id is unique across the whole set", () => {
    // Ids are derived from `(bundle.id, key)`, so two files sharing a bundle id
    // are two libraries writing the same rows.
    const ids = files.map((path) => parseBundle(JSON.parse(readFileSync(path, "utf8"))).bundle.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every playbook resolves to a row and every trip to commands", () => {
    // The schema says the file is well-formed; this says the CONVERTERS can
    // carry it the rest of the way. A stop the schema accepts and
    // `bundleTripCommands` cannot emit is a bundle that imports halfway.
    for (const path of files) {
      const bundle = parseBundle(JSON.parse(readFileSync(path, "utf8")));
      for (const playbook of bundle.playbooks) {
        const row = resolvePlaybook(bundle.bundle.id, playbook, bundle.bundle.origin);
        expect(row.savedDayId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
        expect(row.stops).toHaveLength(playbook.stops.length);
      }
      for (const trip of bundle.trips) {
        const commands = bundleTripCommands(bundle.bundle.id, trip, { today: TODAY });
        const added = commands.filter((c) => c.type === "AddActivity").length;
        expect(added).toBe(trip.days.reduce((n, d) => n + d.stops.length, 0) + trip.backlog.length);
      }
    }
  });

  it("derived ids are stable and collision-free across the whole set", () => {
    // The whole reason ids are derived from keys is that re-importing a bundle
    // must UPDATE its rows rather than duplicate them. A hash collision between
    // two keys would make one day overwrite another — silently, and only in the
    // database. Cheap to check over a few hundred slugs; impossible to notice
    // otherwise.
    const ids = new Map<string, string>();
    for (const path of files) {
      const bundle = parseBundle(JSON.parse(readFileSync(path, "utf8")));
      for (const playbook of bundle.playbooks) {
        const row = resolvePlaybook(bundle.bundle.id, playbook, bundle.bundle.origin);
        const previous = ids.get(row.savedDayId);
        expect(previous, `${bundle.bundle.id}/${playbook.key} collides with ${previous}`).toBeUndefined();
        ids.set(row.savedDayId, `${bundle.bundle.id}/${playbook.key}`);
        // Deriving twice must give the same answer, or "re-import updates" is
        // not true at all.
        expect(resolvePlaybook(bundle.bundle.id, playbook, bundle.bundle.origin).savedDayId).toBe(row.savedDayId);
      }
    }
  });

  // Discover has a filter over each of these, and a bucket with no occupant is
  // a control that does nothing — which the starter library's own header flags
  // as an open gap it was too small to close (six days cannot fill four seasons
  // and four price bands). This asserts the set closes it.
  it("fills every season and every budget band Discover filters on", () => {
    const bundles = files.map((path) => parseBundle(JSON.parse(readFileSync(path, "utf8"))));
    const summary = summarise(bundles);
    for (const [season, count] of Object.entries(summary.seasons)) {
      expect(count, `no published playbook lands in ${season}`).toBeGreaterThan(0);
    }
    for (const [band, count] of Object.entries(summary.bands)) {
      expect(count, `no published playbook lands in the ${band} budget band`).toBeGreaterThan(0);
    }
  });

  it("is authored by more than one person", () => {
    // "Everyone" being a superset of "Yours" only means something when the two
    // differ — the starter library's own rule, applied to the whole set.
    const bundles = files.map((path) => parseBundle(JSON.parse(readFileSync(path, "utf8"))));
    expect(Object.keys(summarise(bundles).owners).length).toBeGreaterThan(3);
  });
});
