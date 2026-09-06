// Imports `travel-collab/content-bundle/v1` files into the running app
// (ADR-041, `docs/guidelines/content-bundles.md`).
//
// Usage:
//   pnpm --filter web dev                          # in one terminal
//   pnpm --filter web content:import               # in another, once it is up
//   pnpm --filter web content:verify               # parse + lint + report, no server
//   pnpm --filter web content:import --dir content/playbooks
//   pnpm --filter web content:import --trip <uuid> # also create the notebooks in that trip
//
// Env: WEB_BASE_URL (or BASE_URL), SEED_USER, INVITE_SUPER_CODE — the same
// three `db-seed.ts` reads, through the same session module.
//
// --- What it does with each section ---
//   trips      → POST /api/trips, then the batch command endpoint, one batch
//                per day. Never a projection write (AGENTS.md invariant 1),
//                and per-day rather than per-trip because one batch is one
//                History entry (see `bundleTripCommandGroups`).
//   playbooks  → POST /api/dev/content/playbooks, which reads the bundle
//                SERVER-side and writes through `newSavedDayRow`/`recordAdd`.
//   notebooks  → validated always; created as pages only when `--trip` names
//                one. A notebook template is trip-agnostic, and writing every
//                template into every trip is the thing `seedIntoNewTrips`
//                exists to avoid.
//   activities → loose stops with no day and no playbook, into `--trip`'s
//                backlog. Also trip-less until one is named, for the same
//                reason.
//
// --- Why --dry-run is the same script ---
// A separate verifier would be a second reader of the same files, free to
// disagree with the importer about what it accepts. This way "it verifies" and
// "it imports" are one code path with the writes switched off, which is the
// only version of that promise worth making.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { BatchableCommand } from "@tc/contracts";
import {
  bundleActivityCommands,
  bundleTripCommandGroups,
  lintBundle,
  parseBundle,
  summarise,
  type ContentBundleV1,
  type Finding,
} from "@tc/fixtures";
import { api, batch, BASE_URL, cmd, createTrip, devSignIn, SEED_PREFIX, type DistributiveOmit } from "./lib/seed-session.ts";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const DEV_USER = process.env.SEED_USER ?? "alice";

// ---- arguments ---------------------------------------------------------

type Options = { dir: string; dryRun: boolean; tripId: string | null };

/**
 * A directory argument, resolved against the CWD and then against the repo
 * root.
 *
 * Both are needed and neither alone is right. `pnpm --filter web content:import
 * -- --dir content/playbooks` runs with `apps/web` as the cwd, so a path a
 * person typed while looking at the repo root does not exist relative to it;
 * but a path they typed while actually inside `apps/web` does, and silently
 * reinterpreting that one would be worse. So: cwd wins when it resolves, repo
 * root is the fallback, and an absolute path is neither.
 */
function resolveDir(value: string): string {
  const fromCwd = resolve(process.cwd(), value);
  if (existsSync(fromCwd)) return fromCwd;
  const fromRoot = resolve(REPO_ROOT, value);
  return existsSync(fromRoot) ? fromRoot : fromCwd;
}

function parseArgs(argv: string[]): Options {
  const options: Options = { dir: join(REPO_ROOT, "content"), dryRun: false, tripId: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    // pnpm forwards script arguments after a bare `--`, and the documented
    // invocation is `pnpm --filter web content:import -- --dir …` — so the
    // separator arrives here as an argument. Refusing it would make the one
    // form the guideline shows the one form that does not work.
    if (arg === "--") continue;
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--dir") options.dir = resolveDir(argv[++i] ?? "");
    else if (arg === "--trip") options.tripId = argv[++i] ?? null;
    else if (arg !== undefined) throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

// ---- reading -----------------------------------------------------------

/**
 * Every `*.json` under `dir`, at any depth, in a stable order — **skipping
 * dot-files and dot-directories.**
 *
 * That exclusion is not tidiness. `content/` is a working directory as well as
 * a source of truth: `scripts/geocode-content.py` writes its resume cache and
 * its review file there, and the moment it did, this function tried to parse
 * `.geocode-review.json` as a bundle and the whole import refused. A stray
 * `.DS_Store.json` would have done the same. A tool's own scratch state living
 * beside the content it works on is normal; treating it as content is the bug.
 */
function bundleFiles(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir).sort();
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    if (entry.startsWith(".")) return [];
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? bundleFiles(path) : path.endsWith(".json") ? [path] : [];
  });
}

/** Today, `YYYY-MM-DD`. The one clock read in the whole import. */
const today = (): string => new Date().toISOString().slice(0, 10);

// ---- the report --------------------------------------------------------

function printSummary(bundles: ContentBundleV1[]): void {
  const s = summarise(bundles);
  console.log("");
  console.log(`  bundles          ${s.bundles}`);
  console.log(`  trips            ${s.trips}`);
  console.log(`  playbook days    ${s.playbooks}  (${s.publicPlaybooks} public)`);
  console.log(`  notebooks        ${s.notebooks}`);
  console.log(`  stops            ${s.stops}`);
  console.log(`  cities           ${s.cities}`);
  console.log(`  authors          ${Object.keys(s.owners).length}`);
  console.log(`  written by       ${Object.entries(s.authorKinds).map(([k, n]) => `${k} ${n}`).join(" · ")}`);
  // The two rows worth reading: Discover has a filter over each, and a bucket
  // with no occupant is a control that does nothing.
  console.log(`  seasons          ${Object.entries(s.seasons).map(([k, n]) => `${k} ${n}`).join(" · ")}`);
  console.log(`  budget bands     ${Object.entries(s.bands).map(([k, n]) => `${k} ${n}`).join(" · ")}`);
  console.log("");
}

function printFindings(findings: Finding[]): void {
  for (const finding of findings) {
    const mark = finding.severity === "error" ? "ERROR" : "warn ";
    console.log(`  ${mark}  ${finding.where}: ${finding.message}`);
  }
}

// ---- writing -----------------------------------------------------------

/**
 * Clears the trips a previous import of THESE bundles created — by name, not by
 * prefix.
 *
 * **The prefix-wide sweep `db-seed.ts` does would be wrong here, and the reason
 * is `db:reseed`.** That command runs `db:seed` and then this importer, so a
 * sweep over everything named `[Seed] …` would delete the Japan, Rochester and
 * Portland trips `db:seed` had just finished writing. Matching the exact names
 * this run is about to create keeps the two composable in either order and
 * still makes a re-import replace rather than duplicate.
 *
 * `db-seed.ts` keeps its wider sweep on purpose: it runs first, and "reset the
 * seed content" is what it means.
 *
 * A soft delete through the command pipeline (`DeleteTrip`), never a row delete
 * — M8's `RestoreTrip` can recover it.
 *
 * Note this is NOT the derived-id idempotency the playbooks get. A trip's id is
 * minted by `POST /api/trips`, because `CreateTrip` is a trip's genesis and the
 * server owns that id; so "the same trip twice" is prevented by clearing first,
 * not by writing to a known id.
 */
async function deletePriorImports(cookie: string, names: string[]): Promise<number> {
  if (names.length === 0) return 0;
  const wanted = new Set(names.map((name) => `${SEED_PREFIX}${name}`));
  const { trips } = await api(cookie, "GET", "/api/trips");
  const prior = trips.filter((t: { name: string }) => wanted.has(t.name));
  for (const trip of prior) await cmd(cookie, trip.tripId, { type: "DeleteTrip" });
  return prior.length;
}

async function importTrips(cookie: string, bundle: ContentBundleV1): Promise<number> {
  let count = 0;
  for (const trip of bundle.trips) {
    const { tripId } = await createTrip(cookie, trip.name);
    // The server minted the id, so it is passed in rather than derived — the
    // commands must name the trip that actually exists.
    for (const group of bundleTripCommandGroups(bundle.bundle.id, trip, { tripId, today: today() })) {
      await batch(
        cookie,
        tripId,
        group.map(({ tripId: _t, ...command }) => command as DistributiveOmit<BatchableCommand, "tripId">),
      );
    }
    count++;
  }
  return count;
}

/**
 * A bundle's loose `activities`, into `tripId`'s backlog.
 *
 * One batch, so a wishlist reads as one History entry rather than N — the same
 * shape the Japan fixture gives its four parked ideas.
 */
async function importActivities(cookie: string, bundle: ContentBundleV1, tripId: string): Promise<number> {
  if (bundle.activities.length === 0) return 0;
  await batch(
    cookie,
    tripId,
    bundleActivityCommands(tripId, bundle.activities).map(
      ({ tripId: _t, ...command }) => command as DistributiveOmit<BatchableCommand, "tripId">,
    ),
  );
  return bundle.activities.length;
}

async function importNotebooks(cookie: string, bundle: ContentBundleV1, tripId: string): Promise<number> {
  for (const notebook of bundle.notebooks) {
    await api(cookie, "POST", `/api/trips/${tripId}/pages`, {
      title: notebook.title,
      context: { tripId },
      content: notebook.content,
    });
  }
  return bundle.notebooks.length;
}

// ---- run ---------------------------------------------------------------

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const files = bundleFiles(options.dir);
  if (files.length === 0) {
    throw new Error(`no *.json bundles under ${options.dir}`);
  }

  // PARSE AND LINT EVERYTHING FIRST, before a single write. A run that imports
  // four files and then refuses the fifth leaves a library nobody asked for and
  // no way to tell which half landed.
  const parsed: { path: string; bundle: ContentBundleV1 }[] = [];
  const findings: Finding[] = [];
  for (const path of files) {
    const name = relative(REPO_ROOT, path);
    let bundle: ContentBundleV1;
    try {
      bundle = parseBundle(JSON.parse(readFileSync(path, "utf8")));
    } catch (error) {
      console.error(`\n${name} is not a content-bundle/v1 document:\n${(error as Error).message}`);
      process.exit(1);
    }
    parsed.push({ path: name, bundle });
    findings.push(...lintBundle(bundle, today()));
  }

  console.log(`${parsed.length} bundle(s) under ${relative(REPO_ROOT, options.dir) || "."}:`);
  for (const { path, bundle } of parsed) {
    console.log(
      `  ${path} — ${bundle.trips.length} trip(s), ${bundle.playbooks.length} playbook(s), ` +
        `${bundle.notebooks.length} notebook(s), ${bundle.activities.length} loose activity(s), ` +
        `written by ${bundle.bundle.origin}`,
    );
  }
  printSummary(parsed.map((p) => p.bundle));
  if (findings.length > 0) printFindings(findings);

  const errors = findings.filter((f) => f.severity === "error");
  if (errors.length > 0) {
    console.error(`\n${errors.length} error(s) — nothing imported.`);
    process.exit(1);
  }

  if (options.dryRun) {
    console.log(`Dry run: nothing written.${findings.length > 0 ? ` ${findings.length} warning(s) above.` : " No findings."}`);
    return;
  }

  console.log(`Importing into ${BASE_URL} as "${DEV_USER}"...`);
  const cookie = await devSignIn(BASE_URL, DEV_USER);

  const cleared = await deletePriorImports(
    cookie,
    parsed.flatMap((p) => p.bundle.trips.map((t) => t.name)),
  );
  if (cleared > 0) console.log(`  cleared ${cleared} trip(s) from a previous import`);

  let trips = 0;
  let savedDays = 0;
  let adds = 0;
  let notebooks = 0;
  let activities = 0;
  for (const { path, bundle } of parsed) {
    trips += await importTrips(cookie, bundle);
    if (bundle.playbooks.length > 0) {
      // The raw file, re-read rather than re-serialised from `bundle`: the
      // route parses it itself (see its header — the SERVER validates), and
      // handing it anything but the bytes on disk would mean two documents
      // could differ and only one of them was checked.
      const raw = JSON.parse(readFileSync(join(REPO_ROOT, path), "utf8"));
      const result = await api(cookie, "POST", "/api/dev/content/playbooks", raw);
      savedDays += result.savedDays;
      adds += result.adds;
    }
    if (options.tripId !== null) {
      activities += await importActivities(cookie, bundle, options.tripId);
      notebooks += await importNotebooks(cookie, bundle, options.tripId);
    }
  }

  console.log(
    `Imported ${trips} trip(s), ${savedDays} playbook day(s) with ${adds} adds-ledger row(s)` +
      (options.tripId !== null
        ? `, ${notebooks} notebook(s) and ${activities} backlog item(s) into ${options.tripId}`
        : "") +
      ".",
  );
  if (
    options.tripId === null &&
    parsed.some((p) => p.bundle.notebooks.length > 0 || p.bundle.activities.length > 0)
  ) {
    console.log(
      "Notebooks and loose activities were validated but not created — pass --trip <uuid> to put them in a trip.",
    );
  }
}

main().catch((err) => {
  console.error(`\nimport failed: ${err.message}`);
  process.exit(1);
});
