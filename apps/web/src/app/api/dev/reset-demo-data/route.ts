import { randomUUID } from "node:crypto";
import { auth } from "@/server/auth";
import { executeTripCommand } from "@/server/commands";
import { listTripSummaries } from "@/server/projections";
import { importJapanTripSeed, parseTripSeed } from "@/lib/japanTripImporter";
import { isDemoDataResetEnabled } from "@/lib/demoDataReset";
// A static import, not a runtime fs.readFileSync: this route is
// preview-only, and Vercel's Root Directory for this project is apps/web
// (docs/milestones/M0-walking-skeleton.md) — `.design-sync/` sits outside
// it, so a path read at request time would depend on output-file-tracing
// including a file the deploy's root directory doesn't own. A static import
// sidesteps that entirely: the bundler (tsconfig's resolveJsonModule) inlines
// the JSON into the compiled route at build time, same as any other module.
import rawJapanTripSeed from "../../../../../../../.design-sync/handoff/data/japan-trip-seed.json";

// Debug-tool endpoint (Mitchell's request, 2026-08-24): wipes the signed-in
// user's own trips and reseeds the 14-day/68-stop Japan demo trip, so a UI
// bug can be reproduced against rich data without a terminal. Preview only —
// isDemoDataResetEnabled() fails closed to a 404 (not a 403) so the route's
// existence isn't advertised outside preview+SEED_DEMO_DATA=true (see
// docs/known-issues.md KI-24 for the shape this deliberately avoids: a
// bypassable env check with only a log line as evidence).
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
  const rows = await listTripSummaries();
  const ownTrips = rows.filter((r) => r.members.some((m) => m.userId === userId));
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
    { type: "CreateTrip", tripId, name: "Japan: Tokyo → Kyoto → Osaka" },
    userId,
  );
  if (!created.ok) {
    return Response.json({ error: created.error.message, code: created.error.code }, { status: 400 });
  }

  const seed = parseTripSeed(rawJapanTripSeed);
  const commands = importJapanTripSeed(seed, tripId);

  // Sequential, not Promise.all: these are ordered AddActivity calls against
  // the same trip's event stream, and the command pipeline's optimistic
  // concurrency check would reject concurrent writers on one stream.
  let detail = created.detail;
  for (const command of commands) {
    const result = await executeTripCommand(command, userId);
    if (!result.ok) {
      return Response.json({ error: result.error.message, code: result.error.code }, { status: 400 });
    }
    detail = result.detail;
  }

  return Response.json({
    ok: true,
    tripId,
    days: detail.days.length,
    activities: Object.keys(detail.activities).length,
  });
}
