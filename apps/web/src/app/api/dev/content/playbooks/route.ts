import { parseBundle, resolvePlaybook, type ResolvedPlaybook } from "@tc/fixtures";
import { inArray } from "drizzle-orm";
import { isDevLoginEnabled } from "@/lib/devLogin";
import { auth } from "@/server/auth";
import { db } from "@/server/db/client";
import { savedDayAdds, savedDays } from "@/server/db/schema";
import { newSavedDayRow } from "@/server/savedDays";
import { recordAdd } from "@/server/savedDayAdds";

export const runtime = "nodejs";

// Writes one content bundle's playbook days into the library
// (`travel-collab/content-bundle/v1`, ADR-041). Called by
// `scripts/import-content.ts`.
//
// --- Why this is a route and not a direct write from the script ---
// The same reason `POST /api/dev/saved-days` next door is one: `cities` and
// `adds` are DERIVED, and the derivations live server-side in `newSavedDayRow`
// and `recordAdd`. A script that inserted rows itself would carry a second copy
// of `citiesOfStops` and a second way of moving the counter — and would agree
// with the real save path until somebody changed one of them. Going through
// here means a rule that changes in `savedDays.ts` changes what an imported
// library contains, rather than agreeing with it until somebody notices.
//
// --- Why this one takes a BODY and its neighbour does not ---
// `/api/dev/saved-days` reads its fixture out of `@tc/fixtures`, server-side,
// and that is right for content compiled into the app. This content is files on
// disk under `content/`, which the app does not bundle and a serverless
// function cannot read — so the script sends it. The trade is real and is
// bounded three ways:
//
//   1. **The gate is the same.** `isDevLoginEnabled()` fails closed to a 404 in
//      production exactly as its neighbour does — `VERCEL_ENV` is set by Vercel
//      and never by us — and the caller must also hold a dev session.
//   2. **The SERVER validates.** The body is parsed with `parseBundle`, not
//      trusted: a request whose stops do not satisfy the contract's own schemas
//      is a 400 here, not a malformed row.
//   3. **The derivations still happen here.** The body supplies authored
//      content only. Nothing in it can set `cities` or `adds`.
//
// --- Idempotency ---
// Every id is derived from `(bundle.id, key)` (`bundleId`), so re-importing a
// bundle deletes and rewrites exactly the rows it wrote last time and nothing a
// person created. That is the same property the fixture route gets from its
// fixture declaring its own ids — here the ids come from the file's slugs
// instead, which is what lets a content author never see a uuid.
export async function POST(request: Request) {
  if (!isDevLoginEnabled()) {
    return new Response(null, { status: 404 });
  }
  // The gate above is the real control; this is only so the route cannot be
  // called by something that has not even signed in as a dev user.
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }

  let resolved: ResolvedPlaybook[];
  let bundleId: string;
  try {
    const body = await request.json();
    const bundle = parseBundle(body);
    bundleId = bundle.bundle.id;
    resolved = bundle.playbooks.map((p) => resolvePlaybook(bundleId, p, bundle.bundle.origin));
  } catch (error) {
    // The parse error itself, not a generic 400: the caller is a script whose
    // whole job is to tell somebody which line of which file is wrong.
    return Response.json(
      { error: error instanceof Error ? error.message : "not a content-bundle/v1 document" },
      { status: 400 },
    );
  }

  if (resolved.length === 0) {
    return Response.json({ bundle: bundleId, savedDays: 0, adds: 0 });
  }

  const ids = resolved.map((day) => day.savedDayId);
  const now = new Date();
  // An unparseable `keptOn` falls back to now rather than writing an invalid
  // date into a notNull column. `lintBundle` already refuses one, so this is
  // the shape of the guard rather than a case anybody expects to hit.
  const keptAt = (day: ResolvedPlaybook): Date => {
    if (day.keptOn === undefined) return now;
    const at = new Date(day.keptOn);
    return Number.isNaN(at.getTime()) ? now : at;
  };

  // One transaction, for the reason the fixture route gives: a half-seeded
  // library — days present, ledger rows missing — puts `saved_days.adds` and
  // `saved_day_adds` in exactly the disagreement the ledger exists to prevent.
  await db.transaction(async (tx) => {
    // Ledger first: `saved_day_adds` has no foreign key (the no-FK convention
    // this schema uses throughout), so deleting the days first would orphan it.
    await tx.delete(savedDayAdds).where(inArray(savedDayAdds.savedDayId, ids));
    await tx.delete(savedDays).where(inArray(savedDays.id, ids));

    for (const day of resolved) {
      await tx.insert(savedDays).values(
        newSavedDayRow({
          savedDayId: day.savedDayId,
          ownerId: day.ownerId,
          name: day.name,
          stops: day.stops,
          visibility: day.visibility,
          authorKind: day.authorKind,
          sourceTripId: day.sourceTripId,
          sourceTripName: day.sourceTripName,
          createdAt: keptAt(day),
        }),
      );
      // Through `recordAdd`, so the counter is moved BY the ledger rather than
      // written beside it. `addCounts`' eligibility rule is deliberately not
      // consulted: these rows are declared history, and the trips they name are
      // ids in a file rather than rows this database has — `lintBundle` is what
      // enforces that none of them breaks the rule (an author in their own
      // ledger, two adds naming one trip).
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
    bundle: bundleId,
    savedDays: ids.length,
    adds: resolved.reduce((n, day) => n + day.addedBy.length, 0),
  });
}
