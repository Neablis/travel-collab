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
 *                  around: rewriting it would mean discarding real history.
 *   stop locations the one exception, and it does not rewrite anything. For a
 *                  trip that already exists, each stop's `location` in the file
 *                  is compared with its activity's in the trip, and any that
 *                  differ get an `UpdateActivity` through `executeTripCommand`
 *                  — new events on the existing stream (KI-2026-09-23-e;
 *                  `src/server/bundleLocationReconcile.ts` says how a stop is
 *                  paired with its activity). A stop that pairs with nothing is
 *                  reported and left alone. Every OTHER change to a trip —
 *                  titles, notes, times, costs, stops added or removed — still
 *                  does not reach an imported trip; to publish that, change the
 *                  trip's `key`.
 *
 * `--dry-run` reads the target to say what it would do — which trips it would
 * create, and each stop location it would correct, old → new — and writes
 * nothing.
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
  type BundleTrip,
  type ContentBundleV1,
  type Finding,
} from "@tc/fixtures";
import type { Location } from "@tc/contracts";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db/client";
import { savedDayAdds, savedDays } from "@/server/db/schema";
import { executeTripCommand, executeTripCommandBatch } from "@/server/commands";
import { newSavedDayRow } from "@/server/savedDays";
import { recordAdd } from "@/server/savedDayAdds";
import { recomputeReviewCounters } from "@/server/reviews";
import { carryModeration, restoreModeration } from "@/server/reports";
import { executePageCommand } from "@/server/pageCommands";
import { users } from "@/server/db/schema";
import { getTripDetail } from "@/server/projections";
import { planBundleLocationReconcile, type PlannedLocationUpdate } from "@/server/bundleLocationReconcile";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/**
 * The account the demo trips belong to, when nobody names another.
 *
 * A trip has an owner, and the demo trips should not belong to a person: they
 * would sit in that person's own trip list for good, removable only one
 * DeleteTrip at a time, and a colleague reading the member list would see a
 * name that implies somebody planned these by hand. They were generated.
 *
 * **It cannot be signed in as.** A user id is minted from the OAuth provider's
 * subject (`account.providerAccountId`, PR #150), and no provider will ever
 * return this string — so the row is addressable by the importer and reachable
 * by nobody. It carries no email for the same reason: there is no inbox behind
 * it and a plausible-looking address would suggest otherwise.
 */
const SERVICE_USER = {
  id: "service-ai-library",
  name: "Travel Collab AI",
  email: null,
  image: null,
} as const;

/** Creates the service account if it is absent. Never touches an existing row. */
async function ensureServiceUser(): Promise<void> {
  const now = new Date().toISOString();
  await db
    .insert(users)
    .values({ ...SERVICE_USER, createdAt: now, updatedAt: now })
    // `onConflictDoNothing`, not an upsert: if somebody has renamed this
    // account, that is a decision and not drift to be corrected on every run.
    .onConflictDoNothing({ target: users.id });
}
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
export async function importPlaybooks(bundle: ContentBundleV1, prune: boolean) {
  const resolved = bundle.playbooks.map((p) => resolvePlaybook(bundle.bundle.id, p, bundle.bundle.origin));
  const ids = resolved.map((d) => d.savedDayId);
  let pruned = 0;

  await db.transaction(async (tx) => {
    // Read before the delete below erases it; put back after the re-insert.
    const moderation = await carryModeration(tx, ids);
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
          summary: day.summary,
          stops: day.stops,
          // The declaration, not the stops' floor: a playbook whose LAST
          // authored day has no stops leaves no `dayIndex` behind (ADR-048
          // decision 2, KI-2026-09-24-b). Same as the dev route.
          dayCount: day.dayCount,
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
    // Reviews are NOT deleted with the rows above, and the counters are
    // recomputed from them instead. A re-import rewrites the authored content
    // under the same ids; the stars on it were given by real people and must
    // survive that. `newSavedDayRow` writes the counters as "unreviewed", so
    // without this every re-import would silently zero a reviewed day's rating
    // while its reviews still sat in `saved_day_reviews` (M12 link 2).
    for (const id of ids) await recomputeReviewCounters(tx, id);
    await restoreModeration(tx, moderation);
  });

  return { days: resolved.length, pruned };
}

/** How a location reads in the run summary: its name, and its coordinates when it has them. */
function describeLocation(location: Location | null): string {
  if (location === null) return "(no location)";
  const at = location.lat === undefined ? "no coordinates" : `${location.lat}, ${location.lng}`;
  return `${location.name} (${at})`;
}

/**
 * Brings an existing trip's stop LOCATIONS in line with its bundle, and nothing
 * else about it (KI-2026-09-23-e). Each correction is its own `UpdateActivity`
 * through `executeTripCommand`, so it lands as a real event on the trip's
 * stream — the trip's history gains an entry per corrected stop and loses
 * nothing. Nothing is sent when nothing differs, which is what keeps a second
 * run over an unchanged file at zero commands. A dry run prints the plan and
 * sends none of it.
 */
async function reconcileLocations(
  bundle: ContentBundleV1,
  trip: BundleTrip,
  tripId: string,
  ownerId: string,
  dryRun: boolean,
): Promise<{ planned: PlannedLocationUpdate[]; unmatched: string[] }> {
  const plan = await planBundleLocationReconcile(tripId, trip, bundle.activities);
  if (plan === null) return { planned: [], unmatched: [] };
  if (plan.deleted) {
    console.log(`  ${trip.key}: trip is deleted — its stop locations are left alone`);
    return { planned: [], unmatched: [] };
  }
  // Reported, never acted on: adding, removing or retitling a stop is not what
  // this reconciles, and a guessed pairing would put a pin on the wrong stop.
  const unmatched = [
    ...plan.unmatchedStops.map((s) => `${trip.key}: stop in the file with no activity — ${s}`),
    ...plan.unmatchedActivities.map((a) => `${trip.key}: activity with no stop in the file — ${a}`),
  ];
  for (const line of unmatched) console.log(`  unmatched  ${line}`);
  for (const update of plan.updates) {
    console.log(
      `  ${dryRun ? "would move" : "moving"}  ${trip.key} — ${update.bucket}: ${update.title}\n`
        + `      ${describeLocation(update.from)}  →  ${describeLocation(update.to)}`,
    );
    if (dryRun) continue;
    const r = await executeTripCommand(update.command, ownerId);
    if (!r.ok) throw new Error(`${trip.key} (${tripId}) "${update.title}": ${r.error.code} — ${r.error.message}`);
  }
  return { planned: plan.updates, unmatched };
}

/**
 * Demo trips, through the command pipeline: created when absent, resumed when a
 * previous run died before their days, and otherwise left as they are except
 * for their stops' locations, which are reconciled with the file. A dry run
 * reads the target and reports all of that without writing.
 */
export async function importTrips(bundle: ContentBundleV1, ownerId: string, { dryRun = false } = {}) {
  let created = 0;
  let skipped = 0;
  let resumed = 0;
  const planned: PlannedLocationUpdate[] = [];
  const unmatched: string[] = [];
  for (const trip of bundle.trips) {
    const tripId = tripIdFor(bundle.bundle.id, trip.key);
    if (dryRun) {
      // The same three outcomes the real run below reaches, read rather than
      // attempted: no CreateTrip is sent to find out whether the trip exists.
      const existing = await getTripDetail(tripId);
      if (existing === null) created++;
      else if (existing.days.length === 0) resumed++;
      else {
        skipped++;
        const r = await reconcileLocations(bundle, trip, tripId, ownerId, true);
        planned.push(...r.planned);
        unmatched.push(...r.unmatched);
      }
      continue;
    }
    // CreateTrip is NOT part of the command groups — `bundleTripCommandGroups`
    // starts at SetTripDates, because the dev importer gets its trip from
    // `POST /api/trips` first. Here there is no route, so the genesis command
    // is issued directly, against the DERIVED id rather than a minted one.
    //
    // The domain rejecting it with `trip-already-exists` IS the idempotency
    // check: the trip is an event stream, and a second import does not build
    // it again. Rewriting it would mean discarding real history, so it does
    // not — the one thing it does do is `reconcileLocations`, which appends.
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
        const r = await reconcileLocations(bundle, trip, tripId, ownerId, false);
        planned.push(...r.planned);
        unmatched.push(...r.unmatched);
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
      // Through the command path like everything else this script writes. An
      // imported notebook gets its `PageCreated` event at import rather than
      // waiting for `pageCommands`' lazy genesis to backfill it on first edit —
      // the trip already exists and `ownerId` is its owner, so the command's
      // access check passes for the same reason the trip commands above do.
      const r = await executePageCommand(
        {
          type: "CreatePage",
          tripId,
          pageId: randomUUID(),
          title: notebook.title,
          context: { tripId },
          content: notebook.content,
        },
        ownerId,
      );
      if (!r.ok) throw new Error(`${trip.key} (${tripId}) notebook "${notebook.title}": ${r.error.message}`);
    }
    created++;
  }
  // For real, a resumed trip also passes through `created++`; on a dry run it
  // never reaches it, so `created` already counts only the trips that would be.
  return {
    created: dryRun ? created : created - resumed,
    skipped,
    resumed,
    reconciled: planned.length,
    planned,
    unmatched,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const named = (process.env.CONTENT_OWNER_ID ?? "").trim();
  const ownerId = named || SERVICE_USER.id;
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

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
    if (!options.skipPlaybooks) console.log(`  would write ${days} playbook day(s)`);
    if (options.skipTrips) return;
    // Reads the target — which trips exist, and where their stops are — so the
    // plan printed is the one a real run would carry out. Nothing is written.
    let wouldCreate = 0, wouldResume = 0, present = 0, wouldMove = 0;
    for (const bundle of bundles) {
      const r = await importTrips(bundle, ownerId, { dryRun: true });
      wouldCreate += r.created;
      wouldResume += r.resumed;
      present += r.skipped;
      wouldMove += r.reconciled;
    }
    console.log(`\n  trips that would be created   ${wouldCreate}`);
    if (wouldResume > 0) console.log(`  trips that would be resumed   ${wouldResume}`);
    console.log(`  trips already present         ${present}`);
    console.log(`  stop locations it would move  ${wouldMove}`);
    return;
  }

  if (!options.skipTrips) {
    if (named) {
      console.log(`  demo trips will be owned by ${named} (CONTENT_OWNER_ID)`);
    } else {
      await ensureServiceUser();
      console.log(`  demo trips will be owned by "${SERVICE_USER.name}" (${SERVICE_USER.id}) — `
                  + `a service account, created if absent, that cannot be signed in as`);
    }
  }

  let days = 0, pruned = 0, created = 0, skipped = 0, resumed = 0, reconciled = 0, unmatched = 0;
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
      reconciled += r.reconciled;
      unmatched += r.unmatched.length;
    }
  }

  console.log(`\n  playbook days written  ${days}`);
  if (options.prune) console.log(`  stale rows pruned      ${pruned}`);
  if (options.skipTrips) return;
  console.log(`  trips created          ${created}`);
  if (resumed > 0) console.log(`  trips resumed          ${resumed}  (existed but had no days — a previous run died mid-import)`);
  console.log(`  trips already present  ${skipped}  (stop locations reconciled; other content needs a key change)`);
  console.log(`  stop locations moved   ${reconciled}`);
  if (unmatched > 0) console.log(`  stops left unmatched   ${unmatched}  (listed above; nothing was done to them)`);
}

// Run only when this file IS the command, so `importContentProduction.int.test.ts`
// can import `importTrips` and drive it against a real database. Without the
// guard, importing the module runs a whole import and then `process.exit`s the
// test runner. Same guard, and the same reason for `argv[1]` over
// `import.meta.main`, as `geocode-japan-seed.mts`.
const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().then(
    () => process.exit(process.exitCode ?? 0),
    (error) => {
      console.error(error);
      process.exit(1);
    },
  );
}
