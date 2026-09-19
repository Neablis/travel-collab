// **Export and import as real HTTP against real Postgres** (M25 links 1 and 3).
//
// What this layer owns, and it is deliberately NOT the round trip's field
// equality: `packages/fixtures/src/bundle/fromTrip.test.ts` already proves
// bundle → commands → state → `TripDetail` → bundle loses nothing, at a layer
// with no database and no HTTP in it. Re-proving that here would cost a second
// maintenance site and catch one bug (AGENTS.md, *prove it at one layer*).
//
// What only this layer can prove is the part that is about the ENDPOINTS:
//
//   - an upload MINTS ids, so the same file twice is two trips and never a
//     write onto somebody's existing one;
//   - ownership comes from the session and never from the file;
//   - the ceilings refuse rather than truncate, and name their limit;
//   - a malformed file writes NOTHING;
//   - the gates M22 built still apply — scope, role, trip confinement.
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { upsertUser } from "@/server/users";
import { issueGrant } from "@/server/entitlements/grants";
import { livePlanVersion } from "@/server/entitlements/planVersions";
import { mintToken } from "@/server/api-tokens";

vi.mock("@/server/auth", () => ({ auth: vi.fn(async () => null) }));

const { POST: CREATE_TRIP, GET: LIST_TRIPS } = await import("@/app/api/v1/trips/route");
const { GET: GET_TRIP } = await import("@/app/api/v1/trips/[tripId]/route");
const { POST: ADD_DAY } = await import("@/app/api/v1/trips/[tripId]/days/route");
const { POST: ADD_STOP } = await import("@/app/api/v1/trips/[tripId]/activities/route");
const { GET: EXPORT } = await import("@/app/api/v1/trips/[tripId]/export/route");
const { POST: IMPORT } = await import("@/app/api/v1/trips/import/route");

const RUN = randomUUID().slice(0, 8);
const NO_PARAMS = { params: Promise.resolve({} as Record<string, string>) };
const P = (params: Record<string, string>) => ({ params: Promise.resolve(params) });

async function entitled(prefix = "m25"): Promise<string> {
  const id = `${prefix}-${RUN}-${randomUUID().slice(0, 8)}`;
  await upsertUser({ id, email: `${id}@example.test`, name: null, image: null });
  const premium = livePlanVersion("premium");
  await issueGrant({
    userId: id,
    planId: premium.planId,
    planVersion: premium.version,
    source: "admin",
    grantedBy: "dev-operator",
    reason: "M25 export/import fixture.",
    expiresAt: null,
  });
  return id;
}

async function tokenFor(
  owner: string,
  scopes: string[],
  tripIds: string[] | null = null,
): Promise<string> {
  const minted = await mintToken(owner, {
    name: "m25",
    scopes: scopes as Parameters<typeof mintToken>[1]["scopes"],
    tripIds,
    expiresInDays: 30,
  });
  expect(minted.ok).toBe(true);
  return minted.ok ? minted.created.secret : "";
}

const req = (secret: string, body?: unknown, method = "GET") =>
  new Request("http://localhost/x", {
    method,
    headers: {
      authorization: `Bearer ${secret}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

/** A real trip, built entirely through v1's own write endpoints. */
async function seedTrip(secret: string, name = "Kyoto") {
  const created = await CREATE_TRIP(req(secret, { name }, "POST"), NO_PARAMS);
  expect(created.status).toBe(201);
  const tripId = (await created.json()).tripId as string;

  const withDay = await ADD_DAY(req(secret, {}, "POST"), P({ tripId }));
  expect(withDay.status).toBe(201);
  const dayId = (await withDay.json()).days[0].dayId as string;

  const withStop = await ADD_STOP(
    req(
      secret,
      {
        title: "Fushimi Inari",
        dayId,
        timeWindow: { start: "09:00", end: "11:30" },
        notes: "Go early.",
        kind: "booked",
        cost: { amountMinor: 0, currency: "JPY" },
      },
      "POST",
    ),
    P({ tripId }),
  );
  expect(withStop.status).toBe(201);
  return { tripId, dayId };
}

async function exportTrip(secret: string, tripId: string) {
  const response = await EXPORT(req(secret), P({ tripId }));
  expect(response.status).toBe(200);
  return { response, bundle: await response.json() };
}

describe("GET /v1/trips/{tripId}/export", () => {
  // **The response body IS the file.** Only a `collection` gets the
  // `{ items, nextCursor }` envelope, and an enveloped export would have passed
  // every other test in this milestone while what a person downloaded was
  // un-importable.
  it("answers the bundle itself, as an attachment", async () => {
    const owner = await entitled();
    const secret = await tokenFor(owner, ["trips:read", "trips:write"]);
    const { tripId } = await seedTrip(secret);

    const { response, bundle } = await exportTrip(secret, tripId);
    expect(bundle.$schema).toBe("travel-collab/content-bundle/v1");
    expect(bundle.trips).toHaveLength(1);
    expect(bundle.trips[0].name).toBe("Kyoto");
    expect(bundle).not.toHaveProperty("items");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="kyoto.json"');
  });

  // Scope first, then the unchanged role gate — M22's two gates, unmodified by
  // a new endpoint, which is the whole claim of "the directory is the registry".
  it("refuses a token without trips:read, and one confined to another trip", async () => {
    const owner = await entitled();
    const full = await tokenFor(owner, ["trips:read", "trips:write"]);
    const { tripId } = await seedTrip(full);

    const writeOnly = await tokenFor(owner, ["trips:write"]);
    expect((await EXPORT(req(writeOnly), P({ tripId }))).status).toBe(403);

    const elsewhere = await tokenFor(owner, ["trips:read"], [randomUUID()]);
    expect((await EXPORT(req(elsewhere), P({ tripId }))).status).toBe(403);
  });

  // **403, and the same 403 an under-privileged member gets** — telling a
  // stranger apart from a member without the rank would confirm the trip
  // exists (`trip-access.ts`). 404 is reserved for a trip that is genuinely
  // not there. That is `tripAccessFor`'s answer and not this endpoint's to
  // soften; asserting 404 here would have been asserting a leak.
  it("refuses somebody else's trip without saying whether it exists", async () => {
    const mine = await tokenFor(await entitled(), ["trips:read", "trips:write"]);
    const { tripId } = await seedTrip(mine);
    const theirs = await tokenFor(await entitled(), ["trips:read"]);
    expect((await EXPORT(req(theirs), P({ tripId }))).status).toBe(403);
    // An id nobody owns is the one case that 404s.
    expect((await EXPORT(req(theirs), P({ tripId: randomUUID() }))).status).toBe(404);
  });
});

describe("POST /v1/trips/import", () => {
  // **The milestone's safety property.** The same file twice is two trips —
  // never one trip written twice, which is what the content script does on
  // purpose and what would be catastrophic for an upload.
  it("mints fresh ids, so the same file twice is two trips", async () => {
    const owner = await entitled();
    const secret = await tokenFor(owner, ["trips:read", "trips:write"]);
    const { tripId } = await seedTrip(secret);
    const { bundle } = await exportTrip(secret, tripId);

    const first = await IMPORT(req(secret, bundle, "POST"), NO_PARAMS);
    expect(first.status).toBe(201);
    const a = await first.json();

    const second = await IMPORT(req(secret, bundle, "POST"), NO_PARAMS);
    expect(second.status).toBe(201);
    const b = await second.json();

    expect(a.tripId).not.toBe(b.tripId);
    expect(a.tripId).not.toBe(tripId);
    expect(a.days[0].dayId).not.toBe(b.days[0].dayId);
    expect(Object.keys(a.activities)[0]).not.toBe(Object.keys(b.activities)[0]);

    // And the trip it was exported from is untouched by either.
    const original = await GET_TRIP(req(secret), P({ tripId }));
    expect((await original.json()).days).toHaveLength(1);
  });

  // **Ownership comes from the session, never from the file.** The only
  // `ownerId` the format has is a playbook's, and no playbook is written — so
  // this is a property of the shape. Asserted anyway, because the gate box asks
  // for a test that fails if an uploaded field ever reaches an owner column.
  it("takes ownership from the caller, and a file naming another account cannot claim it", async () => {
    const author = await entitled("author");
    const authorSecret = await tokenFor(author, ["trips:read", "trips:write"]);
    const { tripId } = await seedTrip(authorSecret, "Author's trip");
    const { bundle } = await exportTrip(authorSecret, tripId);

    const stranger = await entitled("stranger");
    const strangerSecret = await tokenFor(stranger, ["trips:read", "trips:write"]);

    const claimed = {
      ...bundle,
      // Both places a file could try to name an owner.
      bundle: { ...bundle.bundle, ownerId: author },
      playbooks: [
        {
          key: "theirs",
          name: "Theirs",
          ownerId: author,
          sourceTrip: { name: "T" },
          stops: [{ title: "A stop" }],
        },
      ],
    };

    const imported = await IMPORT(req(strangerSecret, claimed, "POST"), NO_PARAMS);
    expect(imported.status).toBe(201);
    const detail = await imported.json();
    expect(detail.members).toEqual([{ userId: stranger, role: "owner" }]);
    expect(detail.members.map((m: { userId: string }) => m.userId)).not.toContain(author);

    // The author cannot reach the stranger's copy, which is the same statement
    // from the other side. 403 rather than 404, deliberately — see the export
    // test above for why that is the answer that leaks least.
    expect((await GET_TRIP(req(authorSecret), P({ tripId: detail.tripId }))).status).toBe(403);
  });

  /** Every trip this credential can currently see. */
  async function tripIdsOf(secret: string): Promise<string[]> {
    const list = await LIST_TRIPS(req(secret), NO_PARAMS);
    expect(list.status).toBe(200);
    return ((await list.json()).items as { tripId: string }[]).map((t) => t.tripId).sort();
  }

  // A malformed file writes nothing — there is no partial state to design,
  // because the refusal happens before the first command.
  //
  // **"Writes nothing" is asserted, not asserted-about.** The first version of
  // this test checked only the 400, so a regression that created a trip and
  // *then* answered 400 would have passed it while the sentence in its own name
  // became false (CodeRabbit, PR #191). The trip collection either side of the
  // call is what makes the claim mean something.
  it("refuses a malformed bundle with a readable error and writes nothing", async () => {
    const owner = await entitled();
    const secret = await tokenFor(owner, ["trips:read", "trips:write"]);
    const tripsBefore = await tripIdsOf(secret);

    const before = await IMPORT(
      req(
        secret,
        {
          $schema: "travel-collab/content-bundle/v1",
          bundle: { id: "broken", name: "Broken", origin: "human" },
          // A time window that ends before it starts — the schema's own rule.
          trips: [
            {
              key: "b",
              name: "Broken",
              days: [{ stops: [{ title: "Backwards", timeWindow: { start: "12:00", end: "09:00" } }] }],
            },
          ],
        },
        "POST",
      ),
      NO_PARAMS,
    );
    expect(before.status).toBe(400);
    const error = (await before.json()).error;
    expect(error.code).toBe("invalid-request");
    // Zod's own issue list, naming the path. No error handling written by hand.
    expect(JSON.stringify(error.details)).toContain("timeWindow");
    expect(await tripIdsOf(secret)).toEqual(tripsBefore);
  });

  // **Nothing that can THROW runs after the first write.** `addDays` calls
  // `toISOString()`, which throws on an out-of-range date — and while the
  // commands were built after `CreateTrip`, that throw left an empty trip the
  // uploader never asked for, with the refusal branch not yet in scope
  // (CodeRabbit, PR #191). Two things fix it and this asserts both: the schema
  // bounds `startsInDays`, so the reachable version is a 400; and the commands
  // are built first, so any remaining throw happens before anything is written.
  it("refuses an absurd startsInDays as a 400, and writes no trip", async () => {
    const owner = await entitled();
    const secret = await tokenFor(owner, ["trips:read", "trips:write"]);
    const tripsBefore = await tripIdsOf(secret);

    const refused = await IMPORT(
      req(
        secret,
        {
          $schema: "travel-collab/content-bundle/v1",
          bundle: { id: "far", name: "Far", origin: "human" },
          trips: [
            {
              key: "far",
              name: "Far future",
              startsInDays: Number.MAX_SAFE_INTEGER,
              days: [{ stops: [{ title: "A stop" }] }],
            },
          ],
        },
        "POST",
      ),
      NO_PARAMS,
    );
    expect(refused.status).toBe(400);
    expect((await refused.json()).error.code).toBe("invalid-request");
    expect(await tripIdsOf(secret)).toEqual(tripsBefore);
  });

  it("refuses a file that is not one trip, saying which it is", async () => {
    const owner = await entitled();
    const secret = await tokenFor(owner, ["trips:read", "trips:write"]);
    const envelope = {
      $schema: "travel-collab/content-bundle/v1",
      bundle: { id: "many", name: "Many", origin: "human" },
    };
    const trip = (key: string) => ({ key, name: key, days: [{ stops: [{ title: "A stop" }] }] });

    const none = await IMPORT(req(secret, { ...envelope, trips: [] }, "POST"), NO_PARAMS);
    expect(none.status).toBe(400);
    expect((await none.json()).error.message).toContain("no trip");

    const two = await IMPORT(
      req(secret, { ...envelope, trips: [trip("a"), trip("b")] }, "POST"),
      NO_PARAMS,
    );
    expect(two.status).toBe(400);
    expect((await two.json()).error.message).toContain("2 trips");
  });

  // **Refused with the limit named, not truncated, not a timeout, not a 500.**
  it("refuses an oversized upload and names the limit", async () => {
    const owner = await entitled();
    const secret = await tokenFor(owner, ["trips:read", "trips:write"]);
    const envelope = {
      $schema: "travel-collab/content-bundle/v1",
      bundle: { id: "big", name: "Big", origin: "human" },
    };

    // Too many stops, inside the byte ceiling.
    const stops = Array.from({ length: 1_001 }, (_, i) => ({ title: `Stop ${i}` }));
    const manyStops = await IMPORT(
      req(secret, { ...envelope, trips: [{ key: "b", name: "Big", days: [{ stops }] }] }, "POST"),
      NO_PARAMS,
    );
    expect(manyStops.status).toBe(400);
    expect((await manyStops.json()).error.message).toContain("limit is 1,000");

    // Too many days, well inside both the byte ceiling and the stop ceiling.
    const days = Array.from({ length: 367 }, () => ({ stops: [] }));
    const manyDays = await IMPORT(
      req(secret, { ...envelope, trips: [{ key: "b", name: "Big", days }] }, "POST"),
      NO_PARAMS,
    );
    expect(manyDays.status).toBe(400);
    expect((await manyDays.json()).error.message).toContain("limit is 366");

    // And past the byte ceiling, which is measured rather than claimed.
    const fat = {
      ...envelope,
      trips: [{ key: "b", name: "Big", days: [{ stops: [{ title: "x", notes: "y".repeat(1_999) }] }] }],
      // A section the endpoint ignores is still weight on the wire.
      notebooks: Array.from({ length: 1_200 }, (_, i) => ({ key: `n${i}`, filler: "z".repeat(1_800) })),
    };
    const oversized = await IMPORT(req(secret, fat, "POST"), NO_PARAMS);
    expect(oversized.status).toBe(400);
    expect((await oversized.json()).error.message).toContain("2,000,000 bytes");
  });

  // **The ceiling holds with no `Content-Length` to read**, which is the case
  // the header check cannot catch and the one a chunked upload actually
  // presents. The test above sends a string body, so the runtime sets a length
  // and the cheap early-out fires; this sends a stream, so the only thing that
  // can refuse it is the count kept while reading (CodeRabbit, PR #191).
  it("refuses an oversized chunked body, which carries no content-length", async () => {
    const owner = await entitled();
    const secret = await tokenFor(owner, ["trips:read", "trips:write"]);
    const tripsBefore = await tripIdsOf(secret);

    const chunk = new TextEncoder().encode("x".repeat(100_000));
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        // Comfortably past the 2,000,000-byte ceiling if it is ever all read.
        if (sent >= 3_000_000) return controller.close();
        sent += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });

    const request = new Request("http://localhost/x", {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body,
      // Node requires this to send a stream body at all.
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    expect(request.headers.get("content-length")).toBeNull();

    const refused = await IMPORT(request, NO_PARAMS);
    expect(refused.status).toBe(400);
    expect((await refused.json()).error.message).toContain("2,000,000 bytes");
    expect(await tripIdsOf(secret)).toEqual(tripsBefore);
  });

  // Creating a NEW trip from a credential confined to named trips is a
  // widening, and the wrapper refuses it without this endpoint saying anything.
  it("refuses a trip-confined token", async () => {
    const owner = await entitled();
    const full = await tokenFor(owner, ["trips:read", "trips:write"]);
    const { tripId } = await seedTrip(full);
    const { bundle } = await exportTrip(full, tripId);

    const confined = await tokenFor(owner, ["trips:read", "trips:write"], [tripId]);
    const refused = await IMPORT(req(confined, bundle, "POST"), NO_PARAMS);
    expect(refused.status).toBe(403);
    expect((await refused.json()).error.code).toBe("trip-out-of-scope");
  });

  // **A dateless trip stays dateless through real storage**, which is the half
  // of question 2 that `tripStartDate`'s old `?? 0` would have silently dated.
  // Proven here as well as in the pure layer because "the projection came back
  // with a date" is a different claim from "the commands carried none".
  it("round-trips a dateless trip through Postgres without dating it", async () => {
    const owner = await entitled();
    const secret = await tokenFor(owner, ["trips:read", "trips:write"]);
    const { tripId } = await seedTrip(secret, "No dates");

    const { bundle } = await exportTrip(secret, tripId);
    expect(bundle.trips[0]).not.toHaveProperty("startDate");
    expect(bundle.trips[0]).not.toHaveProperty("startsInDays");

    const imported = await IMPORT(req(secret, bundle, "POST"), NO_PARAMS);
    expect(imported.status).toBe(201);
    const detail = await imported.json();
    expect(detail.startDate).toBeNull();
    expect(detail.days).toHaveLength(1);
    expect(detail.days[0].date).toBeNull();
    expect(Object.values(detail.activities)[0]).toMatchObject({ title: "Fushimi Inari" });
  });
});
