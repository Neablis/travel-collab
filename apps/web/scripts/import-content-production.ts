/**
 * Imports `content/` into a real database — the production path.
 *
 * Env:  DATABASE_URL          the target database (a repo secret in CI)
 *       CONTENT_OWNER_ID      the user id that owns the demo trips
 * Args: --dry-run  parse, lint and report; write nothing
 *       --prune    remove rows a bundle no longer declares (see below)
 *       --dir      default `content/`
 *       --skip-trips / --skip-playbooks
 *
 * --- Why this is not `import-content.ts` ---
 * That script talks HTTP to a dev server and signs in through the dev-login
 * route, which fails closed to a 404 in production exactly as it should. This
 * one runs server-side against the database directly.
 *
 * What it does NOT do is reimplement anything. Trips go through
 * `executeTripCommand` — the same pipeline `POST /api/trips` uses, so
 * AGENTS.md invariant 1 holds and a demo trip's history is real events. Days go
 * through `newSavedDayRow` and `recordAdd`, so `cities` and `adds` are derived
 * by the one implementation that owns them. Notebooks go through `createPage`.
 * The only thing this file owns is the ORDER of those calls.
 *
 * Reaching them needs `scripts/lib/ts-resolve.mjs`: `apps/web/src/**` writes
 * extensionless relative imports because Next resolves them, and Node does not.
 * Hence `node --import ./scripts/lib/ts-resolve-register.mjs`.
 *
 * --- Idempotency ---
 * Everything is keyed by an id derived from the file, so a second run converges
 * instead of duplicating:
 *
 *   playbook days  `playbookIdFor(bundle.id, key)` — deleted and rewritten, so
 *                  an edited day updates in place.
 *   trips          `tripIdFor(bundle.id, key)` — CREATE-IF-ABSENT. A trip is an
 *                  event stream, and re-running CreateTrip against one that
 *                  exists is rejected by the domain (`trip-already-exists`),
 *                  which is the correct answer rather than an error to work
 *                  around: rewriting it would mean discarding real history. To
 *                  publish changed trip content, change the trip's `key`.
 *
 * `--prune` closes the remaining gap. Re-import replaces what a bundle
 * declares; it cannot see what a bundle has STOPPED declaring. `source_bundle`
 * (migration 0018) records where a row came from, so "everything from this
 * bundle, minus what it now declares" is answerable. Only rows with that column
 * set are ever considered, so a day a person saved cannot be caught by it.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, inArray, isNotNull, notInArray } from "drizzle-orm";
import {
  bundleActivityCommands,
  bundleTripCommandGroups,
  lintBundle,
  parseBundle,
  resolvePlaybook,
  tripIdFor,
  type ContentBundleV1,
  type Finding,
} from "@tc/fixtures";
import { db } from "@/server/db/client";
import { savedDayAdds, savedDays } from "@/server/db/schema";
import { executeTripCommand, executeTripCommandBatch } from "@/server/commands";
import { newSavedDayRow } from "@/server/savedDays";
import { recordAdd } from "@/server/savedDayAdds";
import { createPage } from "@/server/pages";
import { getTripDetail } from "@/server/projections";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const today = (): string => new Date().toISOString().slice(0, 10);

type Options = {
  dir: string;
  dryRun: boolean;
  prune: boolean;
  skipTrips: boolean;
  skipPlaybooks: boolean;
};

function parseArgs(argv: string[]): Options {
  const o: Options = {
    dir: join(REPO_ROOT, "content"),
    dryRun: false,
    prune: false,
    skipTrips: false,
    skipPlaybooks: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") continue; // pnpm forwards args after a bare `--`
    if (arg === "--dry-run") o.dryRun = true;
    else if (arg === "--prune") o.prune = true;
    else if (arg === "--skip-trips") o.skipTrips = true;
    else if (arg === "--skip-playbooks") o.skipPlaybooks = true;
    else if (arg === "--dir") {
      const value = argv[++i];
      if (!value) throw new Error("--dir needs a path");
      const fromCwd = resolve(process.cwd(), value);
      o.dir = existsSync(fromCwd) ? fromCwd : resolve(REPO_ROOT, value);
    } else if (arg?.startsWith("--")) throw new Error(`unknown argument ${arg}`);
  }
  return o;
}

/** Dot-files are a tool's scratch state, never content (the geocoder writes there). */
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

/** Playbook days for one bundle, in one transaction, plus any prune. */
async function importPlaybooks(bundle: ContentBundleV1, prune: boolean) {
  const resolved = bundle.playbooks.map((p) => resolvePlaybook(bundle.bundle.id, p, bundle.bundle.origin));
  const ids = resolved.map((d) => d.savedDayId);
  let pruned = 0;

  await db.transaction(async (tx) => {
    // Ledger first: `saved_day_adds` has no foreign key (this schema's
    // convention), so removing the days first would orphan it.
    if (ids.length > 0) {
      await tx.delete(savedDayAdds).where(inArray(savedDayAdds.savedDayId, ids));
      await tx.delete(savedDays).where(inArray(savedDays.id, ids));
    }

    if (prune) {
      // Only rows this bundle wrote, and only those it no longer declares.
      // `isNotNull` is belt-and-braces over the equality — a NULL
      // `source_bundle` is a person's own day and must never be reachable here.
      const stale = await tx
        .select({ id: savedDays.id })
        .from(savedDays)
        .where(
          and(
            isNotNull(savedDays.sourceBundle),
            eq(savedDays.sourceBundle, bundle.bundle.id),
            ids.length > 0 ? notInArray(savedDays.id, ids) : undefined,
          ),
        );
      const staleIds = stale.map((r) => r.id);
      if (staleIds.length > 0) {
        await tx.delete(savedDayAdds).where(inArray(savedDayAdds.savedDayId, staleIds));
        await tx.delete(savedDays).where(inArray(savedDays.id, staleIds));
        pruned = staleIds.length;
      }
    }

    for (const day of resolved) {
      const at = day.keptOn ? new Date(day.keptOn) : new Date();
      await tx.insert(savedDays).values(
        newSavedDayRow({
          savedDayId: day.savedDayId,
          ownerId: day.ownerId,
          name: day.name,
          stops: day.stops,
          visibility: day.visibility,
          authorKind: day.authorKind,
          sourceBundle: bundle.bundle.id,
          sourceTripId: day.sourceTripId,
          sourceTripName: day.sourceTripName,
          createdAt: Number.isNaN(at.getTime()) ? new Date() : at,
        }),
      );
      for (const add of day.addedBy) {
        // Same shape the dev route uses: the ledger row carries the day's own
        // kept-on date, not now — these are declared history, not fresh adds.
        await recordAdd(tx, {
          savedDayId: day.savedDayId,
          tripId: add.tripId,
          addedBy: add.addedBy,
          createdAt: Number.isNaN(at.getTime()) ? new Date() : at,
        });
      }
    }
  });

  return { days: resolved.length, pruned };
}

/** Demo trips, through the command pipeline, create-if-absent. */
async function importTrips(bundle: ContentBundleV1, ownerId: string) {
  let created = 0;
  let skipped = 0;
  let resumed = 0;
  for (const trip of bundle.trips) {
    const tripId = tripIdFor(bundle.bundle.id, trip.key);
    // CreateTrip is NOT part of the command groups — `bundleTripCommandGroups`
    // starts at SetTripDates, because the dev importer gets its trip from
    // `POST /api/trips` first. Here there is no route, so the genesis command
    // is issued directly, against the DERIVED id rather than a minted one.
    //
    // The domain rejecting it with `trip-already-exists` IS the idempotency
    // check: the trip is an event stream, and a second import has nothing to
    // do. Rewriting it would mean discarding real history, so it does not.
    const created_ = await executeTripCommand(
      { type: "CreateTrip", tripId, name: trip.name },
      ownerId,
    );
    if (!created_.ok) {
      if (created_.error.code !== "trip-already-exists") {
        throw new Error(`${trip.key}: ${created_.error.code} — ${created_.error.message}`);
      }
      // It exists — but "exists" is not the same as "finished". CreateTrip and
      // the content that follows it are separate transactions, so a run that
      // died in between leaves a trip with no days, which a plain skip would
      // then step over on every future run: an empty demo trip in production,
      // permanently, and no error anywhere. An empty one is resumed instead.
      const existing = await getTripDetail(tripId);
      if (existing && existing.days.length > 0) {
        skipped++;
        continue;
      }
      resumed++;
    }

    const groups = bundleTripCommandGroups(bundle.bundle.id, trip, { tripId, today: today() });
    for (const group of groups) {
      if (group.length === 0) continue;
      // The batch takes the command ARRAY itself, not a { tripId, commands }
      // wrapper — it reads the trip from the commands and rejects a batch that
      // spans two.
      const r = await executeTripCommandBatch(group, ownerId);
      if (!r.ok) throw new Error(`${trip.key} (${tripId}): ${r.error.message}`);
    }
    if (bundle.activities.length > 0) {
      const r = await executeTripCommandBatch(bundleActivityCommands(tripId, bundle.activities), ownerId);
      if (!r.ok) throw new Error(`${trip.key} (${tripId}) backlog: ${r.error.message}`);
    }
    for (const notebook of bundle.notebooks) {
      await createPage(tripId, { title: notebook.title, context: { tripId }, content: notebook.content }, ownerId);
    }
    created++;
  }
  return { created: created - resumed, skipped, resumed };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const ownerId = process.env.CONTENT_OWNER_ID ?? "";
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  // Not for a dry run: it writes nothing, so it needs no owner, and demanding
  // one is a needless obstacle in front of the command whose entire purpose is
  // to be safe to run.
  if (!options.dryRun && !options.skipTrips && !ownerId) {
    throw new Error("CONTENT_OWNER_ID is required to own the demo trips (or pass --skip-trips)");
  }

  // Parse and lint EVERYTHING before writing anything. A run that imports nine
  // bundles and then rejects the tenth leaves a database nobody can reason
  // about, and this is production.
  const files = bundleFiles(options.dir);
  const bundles: ContentBundleV1[] = [];
  const findings: Finding[] = [];
  for (const file of files) {
    let bundle: ContentBundleV1;
    try {
      bundle = parseBundle(JSON.parse(readFileSync(file, "utf8")));
    } catch (error) {
      console.error(`  ${file}\n    ${error instanceof Error ? error.message : error}`);
      process.exitCode = 1;
      return;
    }
    bundles.push(bundle);
    findings.push(...lintBundle(bundle, today()));
  }
  const errors = findings.filter((f) => f.severity === "error");
  for (const f of findings) console.log(`  ${f.severity === "error" ? "ERROR" : "warn "} ${f.where}: ${f.message}`);
  if (errors.length > 0) {
    console.error(`\n  ${errors.length} error(s); nothing was written.`);
    process.exitCode = 1;
    return;
  }

  const target = (process.env.DATABASE_URL.match(/@([^/?]+)/) ?? [, "?"])[1];
  console.log(`\n  ${bundles.length} bundle(s) from ${options.dir}`);
  console.log(`  target ${target}${options.dryRun ? "  (DRY RUN — nothing will be written)" : ""}`);
  if (options.dryRun) {
    const days = bundles.reduce((n, b) => n + b.playbooks.length, 0);
    const trips = bundles.reduce((n, b) => n + b.trips.length, 0);
    console.log(`  would write ${days} playbook day(s) and up to ${trips} trip(s)`);
    return;
  }

  let days = 0, pruned = 0, created = 0, skipped = 0, resumed = 0;
  for (const bundle of bundles) {
    if (!options.skipPlaybooks) {
      const r = await importPlaybooks(bundle, options.prune);
      days += r.days;
      pruned += r.pruned;
    }
    if (!options.skipTrips) {
      const r = await importTrips(bundle, ownerId);
      created += r.created;
      skipped += r.skipped;
      resumed += r.resumed;
    }
  }

  console.log(`\n  playbook days written  ${days}`);
  if (options.prune) console.log(`  stale rows pruned      ${pruned}`);
  console.log(`  trips created          ${created}`);
  if (resumed > 0) console.log(`  trips resumed          ${resumed}  (existed but had no days — a previous run died mid-import)`);
  console.log(`  trips already present  ${skipped}  (change a trip's key to publish new content)`);
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
