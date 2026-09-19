import { randomUUID } from "node:crypto";
import { isCalendarDate } from "@tc/domain";
import { bundleTripCommandGroups, TripImportBundle, type BundleTrip } from "@tc/fixtures";
import { TripDetail } from "@tc/contracts";
import { orThrow, PublicApiError, runBatch, runCommand } from "@/server/public-api/commands";
import { route } from "@/server/public-api/route";

// **A file becomes a trip** (M25 link 3) — `parseBundle` as a user surface
// rather than a script.
//
// The machinery has existed since ADR-041 and has been unreachable by any user:
// the schema, the linter, the pure converters and a real importer, called by
// exactly one route that is behind `isDevLoginEnabled()` and 404s in
// production. This is the door.
//
// --- Four things this has to decide that the script never did ---
//
// **1. Ids are MINTED, never derived.** `bundleId(namespace, key)` hashes
// `(bundle.id, key)` to a stable uuid so that re-importing authored content
// UPDATES the same rows — which is exactly wrong for an upload. Passing an
// explicit `tripId` is what turns that off: `bundleTripCommandGroups` then
// mints every day and stop id from `crypto.randomUUID()` and never calls
// `tripIdFor`. So the same file uploaded twice produces two trips, and a file
// whose content would derive onto somebody else's existing trip cannot touch
// it. One `randomUUID()` and the absence of one call.
//
// **2. Ownership comes from the session, and it comes from nowhere else.**
// `CreateTrip` makes its actor the owner (`evolveTrip`), and the actor here is
// whoever presented the credential. The only `ownerId` the FORMAT has is
// `BundlePlaybook.ownerId`, and this endpoint writes no playbook at all — see
// below — so there is no field on any path that could reach an owner column.
// It is a property of the shape rather than a scrub step somebody has to
// remember.
//
// **3. Size has a ceiling, refused rather than clamped.** Two of them, both
// named in their refusal. See `MAX_UPLOAD_BYTES` and the count check.
//
// **4. All-or-nothing.** A file that does not parse imports nothing — the
// wrapper refuses it against `ContentBundleV1` before a single write. The
// half this was going to have to decide, what an upload does with the
// linter's WARNINGS, does not exist: the content rules do not run on uploads
// (question 3), so there are no warnings and no partial state to design.
//
// --- What it ignores, and why ignoring beats refusing ---
// `playbooks`, `notebooks` and the loose `activities` wishlist are read past —
// the body is `TripImportBundle`, the same document narrowed to the sections an
// upload writes, so a file carrying them still imports its trip and the
// published reference stops promising they do anything. Refusing such a file
// would make the format's own versioning story a lie: a bundle exported by a
// later version of this product, or hand-authored out of `content/`, will
// legitimately carry more than this endpoint writes. ADR-041's dev door for
// playbooks stays exactly as wide as it was.
//
// --- The endpoint shape, and the one constraint it carries from M22 ---
// **No trip dimension**, so `route()` refuses a trip-confined token for free:
// creating a NEW trip from a credential restricted to named trips is a
// widening, the same reason `POST /v1/trips` refuses one.
//
// A static segment under `trips/` rather than `/v1/imports`, because this IS a
// trip creation and no trip id is ever the literal string `import`.

/**
 * **2 MB.** Measured rather than guessed: the largest authored trip in
 * `content/` is 10 days and 66 stops in 55 KB, so a stop with a location, notes
 * and a cost costs about 830 bytes. The stop ceiling below is 1,000, which is
 * roughly 830 KB — this leaves comfortable headroom above it while staying well
 * under the 4.5 MB a Vercel function will accept at all, so the refusal a
 * caller gets is ours and legible rather than the platform's.
 */
const MAX_UPLOAD_BYTES = 2_000_000;

/**
 * **1,000 stops and 366 days**, and the counts matter more than the bytes.
 *
 * One stop is one `AddActivity` is one event, so a file's stop count is the
 * work it asks the command pipeline to do — and a 2 MB file of `{"stops":[]}`
 * would be 140,000 empty days without this. 1,000 is about fifteen times the
 * largest trip anybody has authored here; 366 is a trip longer than a year,
 * which is not a trip.
 */
const MAX_STOPS = 1_000;
const MAX_DAYS = 366;

/** The one trip an upload carries, or a 400 saying why this file is not one. */
function theTrip(bundle: TripImportBundle): BundleTrip {
  // **Exactly one.** The response is the created `TripDetail`, symmetric with
  // `POST /v1/trips`, and a `route()` resource validates against exactly one
  // response schema — the same constraint that made this milestone reject
  // `GET /v1/trips/{id}?format=bundle`. "Import N trips" would need a
  // collection response and a partial-failure story, and this milestone has
  // already decided import is all-or-nothing.
  //
  // The cost, stated: the four authored bundles under `content/` are not
  // user-importable. They are dev content with their own door.
  if (bundle.trips.length === 0) {
    throw new PublicApiError(400, "This file contains no trip to import.");
  }
  if (bundle.trips.length > 1) {
    throw new PublicApiError(
      400,
      `This file contains ${bundle.trips.length} trips. Import takes one at a time.`,
    );
  }
  const trip = bundle.trips[0]!;

  // Grouped digits, matching the wrapper's own `too large` message. A limit a
  // person has to count the zeroes in is a limit they will misread.
  const count = (n: number) => n.toLocaleString("en-US");
  if (trip.days.length > MAX_DAYS) {
    throw new PublicApiError(
      400,
      `That trip has ${count(trip.days.length)} days. The limit is ${count(MAX_DAYS)}.`,
    );
  }
  const stops = trip.days.reduce((n, day) => n + day.stops.length, 0) + trip.backlog.length;
  if (stops > MAX_STOPS) {
    throw new PublicApiError(
      400,
      `That trip has ${count(stops)} stops. The limit is ${count(MAX_STOPS)}.`,
    );
  }

  // **Shape is not calendar validity**, and the difference is a write that
  // cannot be undone by the caller. `BundleTrip.startDate` is a regex, so
  // `2027-02-30` parses and the domain then refuses `SetTripDates` — after
  // `CreateTrip` has already committed, leaving an empty husk of a trip the
  // uploader did not ask for. Refusing it here makes the realistic
  // post-parse failure a clean 400 with nothing written. `isCalendarDate` is
  // the same predicate `decide.ts` uses (KI-77) and the same one the trip
  // PATCH route reaches for, so this refuses exactly what the domain would.
  if (trip.startDate !== undefined && !isCalendarDate(trip.startDate)) {
    throw new PublicApiError(400, `"${trip.startDate}" is not a date on the calendar.`);
  }
  return trip;
}

export const { POST } = route({
  POST: {
    scope: "trips:write",
    // **The schema, and only the schema** (question 3). `TripImportBundle`
    // carries `parseBundle`'s own `BundleTrip`, so a malformed stop, an
    // impossible time window or a fractional cost is a 400 naming the path that
    // is wrong — and the CONTENT lint rules deliberately do not run: three of
    // them are errors a legitimate trip trips by ordinary use (an empty trip,
    // stops out of clock order after a board reorder, a backlog item carrying a
    // time window), so running them would reject real trips on day one.
    //
    // Declaring it as the body schema is also what buys the readable error for
    // free: the wrapper answers 400 with zod's own issue list under `details`.
    // No error handling is written by hand.
    body: TripImportBundle,
    maxBodyBytes: MAX_UPLOAD_BYTES,
    response: TripDetail,
    handle: async ({ actor, body }) => {
      const bundle = body as TripImportBundle;
      const trip = theTrip(bundle);

      const tripId = randomUUID();
      const created = orThrow(await runCommand(actor, { type: "CreateTrip", tripId, name: trip.name }));

      const commands = bundleTripCommandGroups(bundle.bundle.id, trip, {
        today: new Date().toISOString().slice(0, 10),
        // **The whole of "an upload can never overwrite a trip".** Supplied,
        // so `tripIdFor` is never consulted and every other id is minted.
        tripId,
      }).flat();

      // An empty trip is a real thing to export and therefore a real thing to
      // import, and `runBatch` refuses an empty command list as "this patch
      // changes nothing" — correctly, for a PATCH. Here there is simply
      // nothing more to do.
      if (commands.length === 0) return created;

      // **One batch, deliberately, where the seed script uses several.**
      // `bundleTripCommandGroups` splits into a group per day because one
      // History entry per day is what makes an AUTHORING run readable. An
      // upload is one action by one person, so one entry is the honest shape —
      // and atomicity is not a preference here but a gate requirement: any
      // rejection inside a batch appends nothing, so a refusal cannot leave a
      // half-written trip.
      const outcome = await runBatch(actor, commands);
      if (!outcome.ok) {
        // **The one window this endpoint has, closed rather than documented.**
        // `CreateTrip` is not a `BatchableCommand`, so it cannot ride in the
        // batch above and the import is unavoidably two writes. If the second
        // fails, the first has committed, and the uploader would be left with
        // an empty trip they did not ask for and did not name. The soft delete
        // is the command path's own inverse (`RestoreTrip` exists), so this
        // uses the domain rather than reaching past it.
        //
        // Best-effort on purpose: the caller's error is the batch's refusal,
        // not whatever went wrong cleaning up after it.
        await runCommand(actor, { type: "DeleteTrip", tripId }).catch(() => undefined);
        throw new PublicApiError(outcome.status, outcome.message);
      }
      return outcome.detail;
    },
  },
});
