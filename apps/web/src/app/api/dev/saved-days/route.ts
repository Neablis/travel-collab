import {
  JAPAN_SAVED_DAYS,
  JAPAN_SOURCE_TRIP,
  STARTER_SAVED_DAYS,
  STARTER_SOURCE_TRIP,
  type SeededSavedDay,
} from "@tc/fixtures";
import { inArray } from "drizzle-orm";
import { isDevLoginEnabled } from "@/lib/devLogin";
import { auth } from "@/server/auth";
import { db } from "@/server/db/client";
import { savedDayAdds, savedDays } from "@/server/db/schema";
import { newSavedDayRow } from "@/server/savedDays";
import { recordAdd } from "@/server/savedDayAdds";

export const runtime = "nodejs";

// Seeds the demo library (M11b). Called by `scripts/db-seed.ts`, which is an
// HTTP client by construction — "never a direct DB write" is the first line of
// that file, and the reason it holds for trips (an inserted projection row has
// no event behind it) is a reason to keep the seam even where it does not
// apply. A saved day is CRUD, not event-sourced, so what a route buys here is
// different but just as real: the seed writes rows through the SAME functions a
// user's save and a user's add go through, so a rule that changes in
// `savedDays.ts` changes what the demo database contains, rather than agreeing
// with it until somebody notices.
//
// Dev-gated, and the gate is `isDevLoginEnabled()` rather than the demo-reset
// route's preview-only check: this is called by the local seed script, which
// cannot authenticate at all without dev login, so the two are the same
// permission. It fails closed on production the same way — VERCEL_ENV is set by
// Vercel and never by us.
//
// The fixture's own ids are used verbatim, which is what makes re-seeding
// idempotent without a "[Seed] " name prefix: the delete below removes exactly
// the rows this route writes and nothing a person created.
//
// TWO fixtures, one write path (2026-09-01). `JAPAN_SAVED_DAYS` is the gate's
// set — five days over two owners whose numbers M11b's exit gate compares — and
// `STARTER_SAVED_DAYS` is the content set: six curated days over three other
// owners, across four seasons and all three budget bands, so a fresh database
// has a library worth browsing rather than an empty Discover. They are
// concatenated rather than merged because the first one's counts are asserted
// and the second one's are not; see the starter file's own header.
export async function POST() {
  if (!isDevLoginEnabled()) {
    return new Response(null, { status: 404 });
  }
  // The gate above is the real control; this is only so the route cannot be
  // called by something that has not even signed in as a dev user.
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }

  const seeded: SeededSavedDay[] = [...JAPAN_SAVED_DAYS, ...STARTER_SAVED_DAYS];
  const ids = seeded.map((day) => day.savedDayId);
  const now = new Date();

  /**
   * When a day entered the library.
   *
   * The Japan set carries no date and gets "now", which is what it has always
   * had. The starter set authors one per day, because Discover's season filter
   * buckets from exactly this column — seeded with `now` for every row, all
   * eleven days would land in one season and three quarters of that control
   * would return nothing in a fresh database.
   *
   * An unparseable `keptOn` falls back to `now` rather than writing an invalid
   * date into a `notNull` column: the fixture is checked in and typechecked, so
   * this is the shape of the guard rather than a case anyone expects to hit.
   */
  const keptAt = (day: SeededSavedDay): Date => {
    if (day.keptOn === undefined) return now;
    const at = new Date(day.keptOn);
    return Number.isNaN(at.getTime()) ? now : at;
  };

  // One transaction: a half-seeded library — days present, ledger rows missing —
  // would put `saved_days.adds` and `saved_day_adds` in exactly the disagreement
  // the whole link exists to prevent, and it would do it in the database every
  // demo and every e2e run reads from.
  await db.transaction(async (tx) => {
    // `saved_day_adds` has no foreign key (the no-FK convention this schema uses
    // throughout), so the ledger rows are cleared explicitly rather than
    // cascading. Deleting the days first would orphan them.
    await tx.delete(savedDayAdds).where(inArray(savedDayAdds.savedDayId, ids));
    await tx.delete(savedDays).where(inArray(savedDays.id, ids));

    for (const day of seeded) {
      // A snapshot of a trip that is deliberately NOT in the database — see
      // the Japan fixture's own note: credit has to survive the source being
      // renamed or deleted, so the demo carries that state rather than
      // avoiding it. The starter days name four different such trips, so the
      // "Kept out of …" line is not the same sentence on every card.
      const source = STARTER_SOURCE_TRIP[day.savedDayId] ?? JAPAN_SOURCE_TRIP;
      await tx.insert(savedDays).values(
        newSavedDayRow({
          savedDayId: day.savedDayId,
          ownerId: day.ownerId,
          name: day.name,
          stops: day.stops,
          visibility: day.visibility,
          sourceTripId: source.id,
          sourceTripName: source.name,
          createdAt: keptAt(day),
        }),
      );
      // Through `recordAdd`, so the counter is moved by the ledger and not
      // written beside it. The eligibility rule (`addCounts`) is deliberately
      // NOT consulted: these rows are declared history, and the trips they name
      // are ids in a fixture rather than rows this database has — the fixture's
      // own `verify.ts` is what enforces that none of them breaks the rule
      // (`savedDayLedgerViolations`).
      for (const add of day.addedBy) {
        await recordAdd(tx, {
          savedDayId: day.savedDayId,
          tripId: add.tripId,
          addedBy: add.addedBy,
          createdAt: keptAt(day),
        });
      }
    }
  });

  return Response.json({
    savedDays: ids.length,
    adds: seeded.reduce((n, day) => n + day.addedBy.length, 0),
  });
}
