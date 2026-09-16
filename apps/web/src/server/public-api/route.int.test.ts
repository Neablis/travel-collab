// **The seam, against a real database** (M22 Phase 2).
//
// Phase 2 is the phase that decides everything: if `route()` is wrong it is
// wrong thirty-five endpoints later and wrong in the public contract of every
// one of them. So this file drives the two pilot endpoints as HTTP — real
// `Request`s, real headers, real status codes — rather than unit-testing the
// wrapper's parts.
//
// **Two gates in order is the property most worth attacking**, and the test that
// matters most is the one where they disagree: a token whose scopes permit the
// call, owned by a user who is not a member. Scope satisfied, membership not,
// answer refused.
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { executeTripCommand } from "@/server/commands";
import { upsertUser } from "@/server/users";
import { allGrantsFor, issueGrant, revokeGrant } from "@/server/entitlements/grants";
import { livePlanVersion } from "@/server/entitlements/planVersions";
import { mintToken, revokeToken } from "@/server/api-tokens";
import { createInvite, acceptInvite } from "@/server/access/invites";

// No session anywhere in this file — every call is a bearer token, which is the
// credential the public API exists for. The one session test below flips this.
let sessionUserId: string | null = null;
vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (sessionUserId === null ? null : { user: { id: sessionUserId } })),
}));

// One-shot failure injection for the trip gate. Delegates to the real
// implementation otherwise, so every other test in this file keeps its real
// answers — the point is the wrapper's boundary, not a stubbed gate.
let tripGateThrows: Error | null = null;
vi.mock("@/server/access/trip-access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/access/trip-access")>();
  return {
    ...actual,
    tripAccessFor: (...args: Parameters<typeof actual.tripAccessFor>) => {
      if (tripGateThrows !== null) {
        const failure = tripGateThrows;
        tripGateThrows = null;
        return Promise.reject(failure);
      }
      return actual.tripAccessFor(...args);
    },
  };
});

const { db } = await import("@/server/db/client");
const { tripDetails } = await import("@/server/db/schema");
const { eq } = await import("drizzle-orm");

const { GET: LIST_TRIPS } = await import("@/app/api/v1/trips/route");
const { GET: GET_TRIP } = await import("@/app/api/v1/trips/[tripId]/route");

const RUN = randomUUID().slice(0, 8);

async function account(): Promise<string> {
  const id = `v1-${RUN}-${randomUUID().slice(0, 8)}`;
  await upsertUser({ id, email: `${id}@example.test`, name: null, image: null });
  return id;
}

/** Entitled by GRANT — no Stripe, no checkout, no subscription row. */
async function entitled(): Promise<string> {
  const id = await account();
  const premium = livePlanVersion("premium");
  await issueGrant({
    userId: id,
    planId: premium.planId,
    planVersion: premium.version,
    source: "admin",
    grantedBy: "dev-operator",
    reason: "M22 Phase 2 fixture.",
    expiresAt: null,
  });
  return id;
}

async function seedTrip(owner: string, name = "Kyoto"): Promise<string> {
  const tripId = randomUUID();
  const created = await executeTripCommand({ type: "CreateTrip", tripId, name }, owner);
  expect(created.ok).toBe(true);
  return tripId;
}

async function tokenFor(
  owner: string,
  over: Partial<Parameters<typeof mintToken>[1]> = {},
): Promise<string> {
  const minted = await mintToken(owner, {
    name: "Test",
    scopes: ["trips:read"],
    tripIds: null,
    expiresInDays: 30,
    ...over,
  });
  expect(minted.ok).toBe(true);
  return minted.ok ? minted.created.secret : "";
}

const NO_PARAMS = { params: Promise.resolve({} as Record<string, string>) };
const withTrip = (tripId: string) => ({ params: Promise.resolve({ tripId }) });

const get = (url: string, secret?: string) =>
  new Request(url, {
    headers: secret === undefined ? {} : { authorization: `Bearer ${secret}` },
  });

describe("credential resolution", () => {
  it("serves a valid token", async () => {
    const owner = await entitled();
    const tripId = await seedTrip(owner);
    const res = await GET_TRIP(get("http://localhost/api/v1/trips/x", await tokenFor(owner)), withTrip(tripId));
    expect(res.status).toBe(200);
    expect((await res.json()).tripId).toBe(tripId);
  });

  // **401 carries `WWW-Authenticate`**, because a bearer scheme that does not is
  // asking the caller to guess.
  it("refuses an anonymous request with a bearer challenge and the envelope", async () => {
    const res = await LIST_TRIPS(get("http://localhost/api/v1/trips"), NO_PARAMS);
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toBe("Bearer");
    const body = await res.json();
    expect(body.error.code).toBe("unauthenticated");
    // The envelope, not the BFF's bare string — `{ error: "unauthenticated" }`
    // is what `/api/*` answers and what v1 deliberately does not.
    expect(typeof body.error).not.toBe("string");
    expect(typeof body.error.message).toBe("string");
  });

  // **An expired token answers differently from a revoked one** (Decision 13),
  // so an integrator learns "mint a new one" rather than "you were cut off".
  it("tells an expired token from a revoked one", async () => {
    const owner = await entitled();
    const expiring = await tokenFor(owner, { expiresInDays: 1 });
    const revoked = await tokenFor(owner);

    // The wrapper reads the clock itself, so expiry is exercised by minting a
    // token that is already past — a day's life, checked two days on, is the
    // same code path `verifyToken` takes.
    const minted = await mintToken(
      owner,
      { name: "Already dead", scopes: ["trips:read"], tripIds: null, expiresInDays: 1 },
      new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
    );
    const deadSecret = minted.ok ? minted.created.secret : "";
    const expiredRes = await LIST_TRIPS(get("http://localhost/api/v1/trips", deadSecret), NO_PARAMS);
    expect(expiredRes.status).toBe(401);
    expect((await expiredRes.json()).error.code).toBe("token-expired");

    const all = await mintToken(owner, {
      name: "To revoke",
      scopes: ["trips:read"],
      tripIds: null,
      expiresInDays: 30,
    });
    if (all.ok) await revokeToken(owner, all.created.token.tokenId);
    const revokedRes = await LIST_TRIPS(
      get("http://localhost/api/v1/trips", all.ok ? all.created.secret : ""),
      NO_PARAMS,
    );
    expect(revokedRes.status).toBe(401);
    expect((await revokedRes.json()).error.code).toBe("token-revoked");

    expect(expiring).not.toBe(revoked);
  });

  // **A presented bearer token is never silently downgraded to the session.**
  // A browser holding a cookie AND a dead token must not appear to succeed —
  // that is how a broken integration looks healthy in exactly one environment.
  it("does not fall back to the session when a bearer token is present and bad", async () => {
    const owner = await entitled();
    await seedTrip(owner);
    sessionUserId = owner;
    try {
      const res = await LIST_TRIPS(get("http://localhost/api/v1/trips", "tc_notarealsecret"), NO_PARAMS);
      expect(res.status).toBe(401);
      expect((await res.json()).error.code).toBe("unauthenticated");
    } finally {
      sessionUserId = null;
    }
  });

  // A session actor satisfies every scope — the frontend acts as the user with
  // the user's full authority, which is what it already does today.
  it("serves a session with no token at all", async () => {
    const owner = await entitled();
    const tripId = await seedTrip(owner);
    sessionUserId = owner;
    try {
      const res = await GET_TRIP(get("http://localhost/api/v1/trips/x"), withTrip(tripId));
      expect(res.status).toBe(200);
    } finally {
      sessionUserId = null;
    }
  });

  // **A lapse disables rather than revokes**, so the refusal names the plan and
  // not the token — and every token comes back when the plan does.
  it("refuses a live token whose owner stopped being entitled, with 402", async () => {
    const owner = await entitled();
    const tripId = await seedTrip(owner);
    const secret = await tokenFor(owner);
    expect((await GET_TRIP(get("http://localhost/x", secret), withTrip(tripId))).status).toBe(200);

    // Take the entitlement away while the token stays perfectly valid. The
    // wrapper reads the real clock, so the lapse has to be a real revocation of
    // the grant rather than a clock the test moves.
    const [grant] = await allGrantsFor(owner);
    expect(await revokeGrant(grant!.id, "dev-operator")).toBe(true);

    const res = await GET_TRIP(get("http://localhost/x", secret), withTrip(tripId));
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error.code).toBe("not-entitled");
    // Names the plan, not the token — the token is fine and will work again.
    expect(body.error.message).toContain("plan");

    // Re-entitle: the same secret works again, with nothing written to it.
    const premium = livePlanVersion("premium");
    await issueGrant({
      userId: owner,
      planId: premium.planId,
      planVersion: premium.version,
      source: "admin",
      grantedBy: "dev-operator",
      reason: "Resubscribed.",
      expiresAt: null,
    });
    expect((await GET_TRIP(get("http://localhost/x", secret), withTrip(tripId))).status).toBe(200);
  });
});

describe("the two gates, in order", () => {
  // **The test that matters most.** Scope satisfied, membership not.
  it("refuses a token whose scope permits the call on a trip its owner cannot read", async () => {
    const owner = await entitled();
    const stranger = await entitled();
    const tripId = await seedTrip(owner, "Private");

    const res = await GET_TRIP(get("http://localhost/x", await tokenFor(stranger)), withTrip(tripId));
    // 403 and not 404: `tripAccessFor` answers `forbidden` for a stranger and
    // for an under-privileged member alike, so neither learns the trip exists.
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("forbidden");
  });

  // **A token can never grant more than its owner holds, and it degrades
  // automatically**: the role gate is the same query it always was, so nothing
  // about the token has to be reconciled when a membership changes.
  it("follows the owner's membership without any token write", async () => {
    const owner = await entitled();
    const guest = await entitled();
    const tripId = await seedTrip(owner, "Shared");
    const secret = await tokenFor(guest);

    const before = await GET_TRIP(get("http://localhost/x", secret), withTrip(tripId));
    expect(before.status).toBe(403);

    const invite = await createInvite(tripId, owner, { role: "editor", email: null });
    await acceptInvite(invite.token, guest);

    const after = await GET_TRIP(get("http://localhost/x", secret), withTrip(tripId));
    expect(after.status).toBe(200);
  });

  it("refuses a token that does not hold the scope, and names the scope", async () => {
    const owner = await entitled();
    const tripId = await seedTrip(owner);
    const secret = await tokenFor(owner, { scopes: ["notebook:read"] });

    const res = await GET_TRIP(get("http://localhost/x", secret), withTrip(tripId));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("insufficient-scope");
    // Naming the scope leaks nothing a caller does not know about its own token
    // and saves a support round trip.
    expect(body.error.message).toContain("trips:read");
    expect(body.error.details).toEqual({ required: "trips:read" });
  });

  // `trips:write` does not imply `trips:read`. A scope is a set, not a rank.
  it("does not let a write scope satisfy a read scope", async () => {
    const owner = await entitled();
    const tripId = await seedTrip(owner);
    const secret = await tokenFor(owner, { scopes: ["trips:write"] });
    const res = await GET_TRIP(get("http://localhost/x", secret), withTrip(tripId));
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("insufficient-scope");
  });

  it("confines a trip-scoped token to the trips it names", async () => {
    const owner = await entitled();
    const mine = await seedTrip(owner, "Named");
    const other = await seedTrip(owner, "Not named");
    const secret = await tokenFor(owner, { tripIds: [mine] });

    expect((await GET_TRIP(get("http://localhost/x", secret), withTrip(mine))).status).toBe(200);
    const refused = await GET_TRIP(get("http://localhost/x", secret), withTrip(other));
    // 403 before the membership question, so the answer cannot leak whether the
    // owner is a member of a trip their token does not name.
    expect(refused.status).toBe(403);
    expect((await refused.json()).error.code).toBe("trip-out-of-scope");
  });

  // **A route with no trip dimension refuses a trip-scoped token.** Listing
  // every trip from a credential restricted to one is a widening, and the safe
  // answer is the boring one.
  it("refuses a trip-scoped token on an endpoint that is not about one trip", async () => {
    const owner = await entitled();
    const tripId = await seedTrip(owner);
    const secret = await tokenFor(owner, { tripIds: [tripId] });
    const res = await LIST_TRIPS(get("http://localhost/api/v1/trips", secret), NO_PARAMS);
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("trip-out-of-scope");
  });
});

describe("pagination, decided once in the wrapper", () => {
  it("pages a collection with an opaque cursor and stops cleanly", async () => {
    const owner = await entitled();
    for (let i = 0; i < 3; i += 1) await seedTrip(owner, `Trip ${i}`);
    const secret = await tokenFor(owner);

    const first = await LIST_TRIPS(get("http://localhost/api/v1/trips?limit=2", secret), NO_PARAMS);
    expect(first.status).toBe(200);
    const page1 = await first.json();
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();

    const second = await LIST_TRIPS(
      get(`http://localhost/api/v1/trips?limit=2&cursor=${encodeURIComponent(page1.nextCursor)}`, secret),
      NO_PARAMS,
    );
    const page2 = await second.json();
    // No overlap: a keyset page cannot repeat a row a previous page served.
    const ids1 = page1.items.map((t: { tripId: string }) => t.tripId);
    const ids2 = page2.items.map((t: { tripId: string }) => t.tripId);
    expect(ids1.filter((id: string) => ids2.includes(id))).toEqual([]);
    // A short page is the end, and says so rather than making the caller ask.
    expect(page2.nextCursor).toBeNull();
  });

  // **Refused, not clamped.** A caller who asked for 5,000 and silently got 200
  // will page forever and never know why.
  it("refuses a limit outside its bounds rather than clamping it", async () => {
    const owner = await entitled();
    const secret = await tokenFor(owner);
    for (const limit of ["0", "201", "abc", "1.5", "-1"]) {
      const res = await LIST_TRIPS(
        get(`http://localhost/api/v1/trips?limit=${limit}`, secret),
        NO_PARAMS,
      );
      expect(res.status, limit).toBe(400);
      expect((await res.json()).error.code, limit).toBe("invalid-request");
    }
  });

  // **The promise the cursor comment makes, kept.** A cursor we did not mint
  // costs a first page — but "did not mint" was only checked for the SHAPE, so
  // `invalid|invalid` reached the `::timestamptz` cast and Postgres raised
  // inside the query. The caller got a 500 for an opaque string we told them
  // not to interpret.
  it("treats a cursor it did not mint as no cursor at all", async () => {
    const owner = await entitled();
    await seedTrip(owner, "Kyoto");
    const secret = await tokenFor(owner);

    const first = await LIST_TRIPS(get("http://localhost/api/v1/trips", secret), NO_PARAMS);
    const expected = (await first.json()).items;

    for (const cursor of ["invalid|invalid", "not-a-date|" + randomUUID(), "|", "nonsense"]) {
      const res = await LIST_TRIPS(
        get(`http://localhost/api/v1/trips?cursor=${encodeURIComponent(cursor)}`, secret),
        NO_PARAMS,
      );
      expect(res.status, cursor).toBe(200);
      expect((await res.json()).items, cursor).toEqual(expected);
    }
  });
});

describe("the answers a caller cannot fix, and the ones they can", () => {
  // RFC 7235 makes the auth-scheme case-insensitive. A client that lowercases
  // its headers was told it had sent no credential at all, which is the 401 an
  // integrator cannot debug because their token IS valid.
  it("accepts the bearer scheme in any case, and trims nothing into the digest", async () => {
    const owner = await entitled();
    const tripId = await seedTrip(owner);
    const secret = await tokenFor(owner);

    for (const header of [`Bearer ${secret}`, `bearer ${secret}`, `BEARER ${secret}`, `Bearer  ${secret} `]) {
      const res = await GET_TRIP(
        new Request("http://localhost/api/v1/trips/x", { headers: { authorization: header } }),
        withTrip(tripId),
      );
      expect(res.status, header.slice(0, 8)).toBe(200);
    }
  });

  // The other half of the same boundary. `tripAccessFor` deliberately lets a
  // database failure through — it is not "this trip is unreadable" — and that
  // call sits ABOVE the handler's try/catch, so without its own catch the
  // throw left `route()` and the envelope with it.
  it("answers a failing trip gate with the error envelope, not a crash", async () => {
    const owner = await entitled();
    const tripId = await seedTrip(owner, "Kyoto");
    const secret = await tokenFor(owner);

    tripGateThrows = new Error("connection terminated unexpectedly");
    const res = await GET_TRIP(get("http://localhost/api/v1/trips/x", secret), withTrip(tripId));
    expect(tripGateThrows, "the gate should have consumed the failure").toBeNull();

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("server-error");
    // Never the driver's words — a caller does not get to read our stack.
    expect(JSON.stringify(body)).not.toContain("connection terminated");
  });

  // **A trip this server cannot parse is a 500 IN THE ENVELOPE.** `getTripDetail`
  // throws on a doc that fails `TripDetail`, and the trip gate runs before the
  // handler's try/catch — so the ZodError left `route()` entirely and the caller
  // got whatever Next renders for an unhandled throw, not an `ApiError`.
  it("answers a malformed stored trip with the error envelope, not a crash", async () => {
    const owner = await entitled();
    const tripId = await seedTrip(owner, "Kyoto");
    const secret = await tokenFor(owner);

    await db
      .update(tripDetails)
      .set({ doc: { tripId, name: 7 } as unknown as never })
      .where(eq(tripDetails.tripId, tripId));

    const res = await GET_TRIP(get("http://localhost/api/v1/trips/x", secret), withTrip(tripId));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("server-error");
    // And never the parse issues: the shape of a stored document is not
    // something an API client gets to read.
    expect(JSON.stringify(body)).not.toContain("invalid_type");
  });
});

describe("the endpoint declares, and the wrapper does the rest", () => {
  // The pilots are one declaration each. This asserts the thing a reader of
  // those two files would have to take on trust: that no handler body contains
  // auth, scopes, errors, pagination or rate limiting.
  it("keeps every cross-cutting concern out of the route files", async () => {
    const { readFileSync } = await import("node:fs");
    const { stripComments } = await import("@/test-support/stripComments");
    const files = [
      "src/app/api/v1/trips/route.ts",
      "src/app/api/v1/trips/[tripId]/route.ts",
    ];
    for (const file of files) {
      // **Comments stripped first**, because those files EXPLAIN what they do
      // not contain — the first version of this test read the raw source and
      // failed on the sentence "no `auth()`" in a comment saying there is none.
      const source = stripComments(readFileSync(`${process.cwd()}/${file}`, "utf8"));
      for (const concern of [
        "auth(",
        "Authorization",
        "WWW-Authenticate",
        "status: 401",
        "status: 403",
        "consumeQuota",
        "Retry-After",
        "safeParse",
        "nextCursor",
        "requireTripAccess",
      ]) {
        expect(source, `${file} contains ${concern}`).not.toContain(concern);
      }
    }
  });
});
