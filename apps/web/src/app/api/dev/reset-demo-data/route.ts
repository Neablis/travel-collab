import { randomUUID } from "node:crypto";
import { auth } from "@/server/auth";
import { executeTripCommand, executeTripCommandBatch } from "@/server/commands";
import { listTripSummaries } from "@/server/projections";
import { JAPAN_TRIP_NAME, japanTripCommands } from "@tc/fixtures";
import { isDemoDataResetEnabled } from "@/lib/demoDataReset";

// Debug-tool endpoint (Mitchell's request, 2026-08-24): wipes the signed-in
// user's own trips and reseeds the 14-day/68-stop Japan demo trip, so a UI
// bug can be reproduced against rich data without a terminal. Preview only —
// isDemoDataResetEnabled() fails closed to a 404 (not a 403) so the route's
// existence isn't advertised outside preview+SEED_DEMO_DATA=true (see
// docs/known-issues.md KI-24 for the shape this deliberately avoids: a
// bypassable env check with only a log line as evidence).
//
// The seed batches ~70 commands into one executeTripCommandBatch call (see
// below), but the delete loop and CreateTrip stay outside it (DeleteTrip
// isn't BatchableCommand, and CreateTrip is a trip's genesis) — a Vercel
// function's default timeout is comfortably enough for that, but not
// necessarily for what used to be ~70 sequential round trips against a
// growing event stream, so this still gets an explicit ceiling.
export const maxDuration = 30;

/**
 * Local calendar date, N days from today, as `YYYY-MM-DD`.
 *
 * Duplicated from scripts/db-seed.ts deliberately: both callers must date the
 * demo trip identically, and the alternative — exporting it from @tc/fixtures —
 * would put a wall-clock read inside a package whose determinism is what
 * `pnpm seed:verify` depends on (ADR-030).
 */
function isoDateInDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function POST(_request: Request) {
  if (!isDemoDataResetEnabled()) {
    return new Response(null, { status: 404 });
  }

  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = session.user.id;

  // Same DeleteTrip-per-trip pattern as scripts/db-seed.ts's
  // deletePriorSeedTrips: a soft delete (M8's RestoreTrip can recover it),
  // never a hard row delete, and scoped to trips this user is a member of —
  // never another user's, never every trip in the table.
  // "Own" means "owner of", not merely "member of": once invites exist (M11
  // link 3) a membership filter would make this route "delete every trip I've
  // been invited to", and DeleteTrip is owner-only (accessPolicy.ts), so each
  // such trip would also fail the pipeline and 400 the whole reset.
  const rows = await listTripSummaries();
  const ownTrips = rows.filter((r) => r.members.some((m) => m.userId === userId && m.role === "owner"));
  for (const trip of ownTrips) {
    const result = await executeTripCommand({ type: "DeleteTrip", tripId: trip.tripId }, userId);
    if (!result.ok) {
      return Response.json({ error: result.error.message, code: result.error.code }, { status: 400 });
    }
  }

  // CreateTrip mints the id server-side (same path POST /api/trips uses),
  // then importJapanTripSeed's commands run through the same command
  // pipeline any real user's actions would — never a direct projection
  // write (AGENTS.md invariant 1).
  const tripId = randomUUID();
  const created = await executeTripCommand(
    { type: "CreateTrip", tripId, name: JAPAN_TRIP_NAME },
    userId,
  );
  if (!created.ok) {
    return Response.json({ error: created.error.message, code: created.error.code }, { status: 400 });
  }

  // The SAME commands db:seed runs locally, from @tc/fixtures (ADR-030). This
  // route used to build its own from the raw design-handoff export, which
  // carried no tags at all and only 51 of 72 coordinates — six of those
  // pointing at the wrong venue. A preview deployment therefore showed a
  // materially thinner, partly wrong trip than any local browser walk did,
  // which is exactly backwards for the environment reviews happen in.
  //
  // Dated relative to today, like db:seed, so the demo trip is always upcoming
  // and the homepage hero always has something to show.
  const commands = japanTripCommands(tripId, { startDate: isoDateInDays(10) });

  // One executeTripCommandBatch call, not ~70 sequential executeTripCommand
  // calls — and deliberately one batch rather than the fixture's own
  // per-day grouping (japanTripCommandGroups), trading History readability for
  // all-or-nothing rollback on a throwaway preview reset: SetTripDates, SetTripBudget and AddActivity (everything
  // importJapanTripSeed emits) are all BatchableCommand
  // (packages/contracts/src/trip.ts), so the whole seed decides and appends
  // under one batchId inside one transaction — a rejection partway through
  // rolls the whole batch back rather than leaving N of ~70 activities
  // committed. It still leaves the bare, dateless trip CreateTrip already
  // committed above (CreateTrip isn't batchable — a stream's genesis command
  // can't share a transaction with commands that require the stream to
  // already exist), a far smaller blast radius than before but not zero.
  // Not Promise.all either: batching preserves the seed's per-day/per-stop
  // ordering (AddActivity appends to the end of a day's activityIds —
  // packages/domain/src/trip/evolve.ts), which concurrent writers against
  // one stream would not.
  const seeded = await executeTripCommandBatch(commands, userId);
  if (!seeded.ok) {
    return Response.json({ error: seeded.error.message, code: seeded.error.code }, { status: 400 });
  }
  const detail = seeded.detail;

  return Response.json({
    ok: true,
    tripId,
    days: detail.days.length,
    activities: Object.keys(detail.activities).length,
  });
}
