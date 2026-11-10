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
import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { executeTripCommand } from "@/server/commands";
import { upsertUser, writePreferences } from "@/server/users";
import { allGrantsFor, issueGrant, revokeGrant } from "@/server/entitlements/grants";
import { livePlanVersion } from "@/server/entitlements/planVersions";
import { mintToken, revokeToken } from "@/server/api-tokens";
import { legacyScryptDigest } from "@/server/api-tokens/legacyScrypt";
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

// The same one-shot shape for the credential step. `resolveActor` is the FIRST
// thing every request touches and the first thing that reads the database, so a
// throw there is the widest hole the envelope can have.
let credentialThrows: Error | null = null;
vi.mock("@/server/public-api/actor", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/public-api/actor")>();
  return {
    ...actual,
    resolveActor: (...args: Parameters<typeof actual.resolveActor>) => {
      if (credentialThrows !== null) {
        const failure = credentialThrows;
        credentialThrows = null;
        return Promise.reject(failure);
      }
      return actual.resolveActor(...args);
    },
  };
});

// `route()` calls `poppyGate` with the real network; the agent's documents are
// served from memory here, as `sessions.int.test.ts` serves them.
let poppyDeps: import("@/server/poppy/sessionHeader").SessionDeps = {};
vi.mock("@/server/poppy/sessions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/poppy/sessions")>();
  return { ...actual, poppyGate: (request: Request, deps?: import("@/server/poppy/sessionHeader").SessionDeps) => actual.poppyGate(request, { ...poppyDeps, ...deps }) };
});

const { runInMcpDispatch } = await import("@/server/oauth/dispatchContext");
const { oauthIssuer } = await import("@/server/oauth/metadata");
const { db } = await import("@/server/db/client");
const { apiTokens, tripDetails } = await import("@/server/db/schema");
const { eq } = await import("drizzle-orm");

const { GET: LIST_TRIPS } = await import("@/app/api/v1/trips/route");
const { GET: DISCOVER } = await import("@/app/api/v1/discover/playbooks/route");
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
    // Poppy 7: a signed-out caller learns which scope to sign in for.
    expect(res.headers.get("WWW-Authenticate")).toBe('Bearer scope="trips:read"');
    const body = await res.json();
    expect(body.error.code).toBe("unauthenticated");
    // The envelope, not the BFF's bare string — `{ error: "unauthenticated" }`
    // is what `/api/*` answers and what v1 deliberately does not.
    expect(typeof body.error).not.toBe("string");
    expect(typeof body.error.message).toBe("string");
  });

  // **An OAuth refusal says where to get a token** (ADR-083 §7, RFC 9728): the
  // bare `Bearer` a `tc_` refusal sends would leave an MCP client nowhere to go.
  it("refuses an OAuth access token with the resource_metadata challenge", async () => {
    const res = await runInMcpDispatch(() =>
      LIST_TRIPS(get("http://localhost/api/v1/trips", `tco_${randomBytes(32).toString("base64url")}`), NO_PARAMS),
    );
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("unauthenticated");
    expect(res.headers.get("WWW-Authenticate")).toBe(
      `Bearer resource_metadata="${oauthIssuer()}/.well-known/oauth-protected-resource/api/mcp", error="invalid_token"`,
    );
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

  // **Revoked by us, so the message says so** (ADR-083 §3). The integrator did
  // nothing; "this token was revoked" alone would send them looking for who did.
  it("tells a token revoked when storage changed what happened and what to do", async () => {
    const owner = await entitled();
    const secret = `tc_${randomBytes(32).toString("base64url")}`;
    await db.insert(apiTokens).values({
      id: randomUUID(),
      ownerId: owner,
      name: "Before 0069",
      tokenHash: await legacyScryptDigest(secret, process.env.API_TOKEN_PEPPER!),
      keyVersion: "scrypt",
      prefix: secret.slice(0, 8),
      scopes: ["trips:read"],
      tripIds: null,
      createdAt: new Date("2026-09-01T00:00:00.000Z"),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      revokedAt: new Date("2026-10-28T09:00:00.000Z"),
      revokedReason: "storage-changed",
    });
    const res = await LIST_TRIPS(get("http://localhost/api/v1/trips", secret), NO_PARAMS);
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toBe("Bearer");
    expect((await res.json()).error).toEqual({
      code: "token-revoked",
      message: "This token was revoked when token storage changed on 2026-10-28. Mint a new one.",
    });
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
    expect(res.headers.get("WWW-Authenticate")).toBe('Bearer error="insufficient_scope", scope="trips:read"');
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

// M38, Mitchell's decision 2026-10-07: `/v1` does not name co-members. A token
// is a third party's, and the trips list is the one read where it would learn
// who else is on every trip at once. `GET /api/trips` carries the personas for
// Home; this list keeps the bare `{ userId, role, travelling }` it published in
// 1.9.0, even when every member has chosen a persona.
describe("GET /v1/trips does not name the members", () => {
  it("carries each member's id, role and travelling, and no name or persona", async () => {
    const owner = await entitled();
    await upsertUser({ id: owner, email: `${owner}@example.test`, name: "Kit Marlowe", image: null });
    await writePreferences(owner, { displayName: "Kit", avatar: "tent", color: "teal" });
    const tripId = await seedTrip(owner);
    const res = await LIST_TRIPS(get("http://localhost/api/v1/trips", await tokenFor(owner)), NO_PARAMS);
    expect(res.status).toBe(200);
    const body = await res.json();
    const trip = body.items.find((t: { tripId: string }) => t.tripId === tripId);
    expect(trip.members).toEqual([{ userId: owner, role: "owner", travelling: true }]);
    const raw = JSON.stringify(trip);
    for (const leak of ["Kit", "tent", "teal", "@example.test"]) expect(raw).not.toContain(leak);
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

  // **The step above that one, and the hole it left was wider.** Every request
  // passes the credential check, trip-scoped or not, so an unreachable
  // `api_tokens` took the envelope off the whole API rather than off one route.
  // Observed on production with `0023_api_tokens` unapplied: no token answered
  // `401` in the envelope, a well-formed bearer answered a bare `500` with an
  // empty body. A refusal is NOT this case — `resolveActor` returns those — so
  // anything it throws is infrastructure and belongs in `server-error`.
  it("answers a failing credential lookup with the error envelope, not a crash", async () => {
    credentialThrows = new Error('relation "api_tokens" does not exist');
    const res = await LIST_TRIPS(get("http://localhost/api/v1/trips", "irrelevant-the-lookup-throws"), NO_PARAMS);
    expect(credentialThrows, "the credential step should have consumed the failure").toBeNull();

    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(body.error.code).toBe("server-error");
    // The driver named our table; the caller does not get to read it.
    expect(JSON.stringify(body)).not.toContain("api_tokens");
  });

  // **A trip this server cannot parse is a 500 IN THE ENVELOPE.** `getTripDetail`
  // throws on a doc that fails `TripDetail`, and the trip gate runs before the
  // handler's try/catch — so the ZodError left `route()` entirely and the caller
  // got whatever Next renders for an unhandled throw, not an `ApiError`.
  it("answers a malformed stored trip with the error envelope, not a crash", async () => {
    const owner = await entitled();
    const tripId = await seedTrip(owner, "Kyoto");
    const secret = await tokenFor(owner);

    // Members kept readable: only a member is told the trip is broken (KI-2026-10-28-c).
    await db
      .update(tripDetails)
      .set({ doc: { tripId, name: 7, members: [{ userId: owner, role: "owner" }] } as unknown as never })
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

// **A Personal Agent's Session header** (Poppy 5.3, M60 part 3): verified
// before the actor when it is present, and a request without it is the request
// every test above already sends.
const agentCaches = new WeakMap<object, ReturnType<typeof import("@/server/cache/redis").createRedisCache>>();
const agentAddresses = new WeakMap<object, string>();
const agentAddress = (agent: object) =>
  agentAddresses.get(agent) ?? agentAddresses.set(agent, `203.0.113.${1 + Math.floor(Math.random() * 250)}`).get(agent)!;
describe("a request that carries Poppy-Session", () => {
  async function agentRequest(
    over: { headers?: Record<string, string | null>; token?: string; session?: Record<string, unknown>; path?: string; agent?: Awaited<ReturnType<typeof import("@/server/poppy/testAgent").makeTestAgent>>; unknown?: true } = {},
  ) {
    const path = over.path ?? "/api/v1/trips";
    const { makeTestAgent, publicResolve } = await import("@/server/poppy/testAgent");
    const { createMemoryClient } = await import("@/server/cache/memory");
    const { createRedisCache } = await import("@/server/cache/redis");
    const { deploymentOrigin } = await import("@/lib/deploymentOrigin");
    const agent = over.agent ?? (await makeTestAgent({ issuer: oauthIssuer() }));
    // One cache per agent, so its document is fetched, and charged to the shared signed-out
    // fetch quota, once however many requests a test sends; and an address of its own, so the
    // other suites that sign Sessions do not share this one's per-address share.
    const cache = (agentCaches.get(agent) ?? agentCaches.set(agent, createRedisCache(createMemoryClient())).get(agent))!;
    // Someone has allowed it: a Session header naming a client with no row is refused without a fetch,
    // except on a route that declares `signedOut`. `unknown` leaves it with no row.
    const { resolveClient, storeClient } = await import("@/server/oauth/clients");
    const known = over.unknown === true ? null : await resolveClient(agent.clientId, { fetch: agent.fetch, resolve: publicResolve, cache, userId: "route-test-owner" });
    if (known?.ok) await storeClient(known.client, new Date());
    poppyDeps = { cache, clientDeps: { fetch: agent.fetch, resolve: publicResolve, cache } };
    const jwt = await agent.session({
      htu: `${deploymentOrigin()}${path}`,
      // Signed over the token it rides with, so the check that fails is whose token it is, not `ath`.
      ...(over.token === undefined ? {} : { accessToken: over.token }),
      ...over.session,
    });
    const headers: Record<string, string> = { "poppy-session": jwt, "poppy-version": "0.4", "x-forwarded-for": agentAddress(agent) };
    for (const [name, value] of Object.entries(over.headers ?? {})) {
      if (value === null) delete headers[name];
      else headers[name] = value;
    }
    if (over.token !== undefined) headers.authorization = `Bearer ${over.token}`;
    return { agent, request: new Request(`http://localhost${path}`, { headers }) };
  }

  it("refuses a header that fails as invalid_session, a 400 outside the envelope, before the credential", async () => {
    const { request } = await agentRequest({ session: { aud: "https://other.test" } });
    const res = await LIST_TRIPS(request, NO_PARAMS);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_session" });
  });

  it("refuses a missing or incompatible Poppy-Version as version_unsupported", async () => {
    for (const version of [null, "0.3"]) {
      const { request } = await agentRequest({ headers: { "poppy-version": version } });
      const res = await LIST_TRIPS(request, NO_PARAMS);
      expect(res.status, String(version)).toBe(400);
      expect(await res.json()).toEqual({ error: "version_unsupported" });
    }
  });

  it("verifies the header and then leaves the credential's answer as it was, writing no Session", async () => {
    const { agent, request } = await agentRequest();
    const res = await LIST_TRIPS(request, NO_PARAMS);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("unauthenticated");
    // Anyone with a document and a key set can sign a Session for a sid of their choosing: no row until a token is accepted.
    const { db } = await import("@/server/db/client");
    const { agentSessions } = await import("@/server/db/schema");
    const { eq } = await import("drizzle-orm");
    expect(await db.select().from(agentSessions).where(eq(agentSessions.clientId, agent.clientId))).toHaveLength(0);
  });

  it("refuses a tc_ token beside a Session header, since it was issued to no client", async () => {
    const { request } = await agentRequest({ token: await tokenFor(await entitled()) });
    const res = await LIST_TRIPS(request, NO_PARAMS);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_session", error_description: expect.stringContaining("issued to another client") });
  });

  it("answers a failure of its own as the envelope's server-error, never a bare 500", async () => {
    const { request } = await agentRequest();
    poppyDeps = { ...poppyDeps, cache: { get: async () => { throw new Error("boom"); }, set: async () => undefined } as never };
    const res = await LIST_TRIPS(request, NO_PARAMS);
    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe("server-error");
  });

  // **Signed out** (Poppy 5.4, 7; ADR-089 decision 5): no access token is a signed-out
  // request, and the only routes that answer one declare `signedOut`. A Session header
  // is what makes it a Personal Agent and not an anonymous caller.
  describe("with no access token", () => {
    const DISCOVER_PATH = "/api/v1/discover/playbooks";

    it("reaches a route that declares signedOut and no other", async () => {
      const read = await agentRequest({ path: DISCOVER_PATH });
      const res = await DISCOVER(read.request, NO_PARAMS);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ items: expect.any(Array) });

      const trips = await agentRequest();
      const refused = await LIST_TRIPS(trips.request, NO_PARAMS);
      expect(refused.status).toBe(401);
      expect((await refused.json()).error.code).toBe("unauthenticated");
    });

    it("is still 401 without a Session header, and with a credential that is not a bearer token", async () => {
      expect((await DISCOVER(get("http://localhost/api/v1/discover/playbooks"), NO_PARAMS)).status).toBe(401);
      const { request } = await agentRequest({ path: DISCOVER_PATH, headers: { authorization: "Basic abc" } });
      expect((await DISCOVER(request, NO_PARAMS)).status).toBe(401);
    });

    it("writes the Session a signed-out request opens, and is limited per client_id and sid", async () => {
      const previous = process.env.SIGNED_OUT_READ_RATE_LIMIT_PER_SESSION_HOURLY;
      process.env.SIGNED_OUT_READ_RATE_LIMIT_PER_SESSION_HOURLY = "2";
      try {
        const { makeTestAgent } = await import("@/server/poppy/testAgent");
        const agent = await makeTestAgent({ issuer: oauthIssuer() });
        const sid = randomUUID();
        const statuses: number[] = [];
        for (let call = 0; call < 3; call++) {
          const { request } = await agentRequest({ path: DISCOVER_PATH, session: { sid }, agent });
          statuses.push((await DISCOVER(request, NO_PARAMS)).status);
        }
        expect(statuses).toEqual([200, 200, 429]);
        // Another Session of the same agent is its own share.
        const other = await agentRequest({ path: DISCOVER_PATH, session: { sid: randomUUID() }, agent });
        expect((await DISCOVER(other.request, NO_PARAMS)).status).toBe(200);
      } finally {
        if (previous === undefined) delete process.env.SIGNED_OUT_READ_RATE_LIMIT_PER_SESSION_HOURLY;
        else process.env.SIGNED_OUT_READ_RATE_LIMIT_PER_SESSION_HOURLY = previous;
      }
    });
  });

  // One agent opens as many Sessions as `agentSessionOpenQuota` allows, each with its own read
  // share, so the Session share alone lets one client_id spend the deployment's whole ceiling.
  it("limits signed-out reads per client_id across its Sessions", async () => {
    const previous = process.env.SIGNED_OUT_READ_RATE_LIMIT_PER_CLIENT_HOURLY;
    process.env.SIGNED_OUT_READ_RATE_LIMIT_PER_CLIENT_HOURLY = "2";
    try {
      const { makeTestAgent } = await import("@/server/poppy/testAgent");
      const agent = await makeTestAgent({ issuer: oauthIssuer() });
      const statuses: number[] = [];
      for (let call = 0; call < 3; call++) {
        const { request } = await agentRequest({ path: "/api/v1/discover/playbooks", session: { sid: randomUUID() }, agent });
        statuses.push((await DISCOVER(request, NO_PARAMS)).status);
      }
      expect(statuses).toEqual([200, 200, 429]);
      // Another client_id has its own share.
      const other = await agentRequest({ path: "/api/v1/discover/playbooks" });
      expect((await DISCOVER(other.request, NO_PARAMS)).status).toBe(200);
    } finally {
      if (previous === undefined) delete process.env.SIGNED_OUT_READ_RATE_LIMIT_PER_CLIENT_HOURLY;
      else process.env.SIGNED_OUT_READ_RATE_LIMIT_PER_CLIENT_HOURLY = previous;
    }
  });

  // **An agent nobody has Allowed** (ADR-089 decision 5): signed-out reads work for any conforming
  // agent, so on a `signedOut` route its metadata is fetched without a stored row, under a
  // quota of its own. Everywhere else a client with no row is refused as before.
  describe("an agent with no stored client row", () => {
    const DISCOVER_PATH = "/api/v1/discover/playbooks";

    it("reads signed-out Discover, and nothing else, and is not stored as a client", async () => {
      const { makeTestAgent } = await import("@/server/poppy/testAgent");
      const agent = await makeTestAgent({ issuer: oauthIssuer() });
      const read = await agentRequest({ path: DISCOVER_PATH, agent, unknown: true });
      expect((await DISCOVER(read.request, NO_PARAMS)).status).toBe(200);

      const trips = await agentRequest({ agent, unknown: true });
      const refused = await LIST_TRIPS(trips.request, NO_PARAMS);
      expect(refused.status).toBe(400);
      expect(await refused.json()).toMatchObject({ error: "invalid_session", error_description: expect.stringContaining("unknown-client") });

      const { storedClientRowId } = await import("@/server/oauth/clients");
      expect(await storedClientRowId(agent.clientId)).toBeNull();
    });

    it("is refused once its address has fetched its share of unknown agents", async () => {
      const previous = process.env.OAUTH_SIGNED_OUT_UNKNOWN_FETCH_RATE_LIMIT_PER_IP_HOURLY;
      process.env.OAUTH_SIGNED_OUT_UNKNOWN_FETCH_RATE_LIMIT_PER_IP_HOURLY = "2";
      try {
        // An agent costs two fetches, its document and its key set.
        const { makeTestAgent } = await import("@/server/poppy/testAgent");
        const address = `198.51.100.${1 + Math.floor(Math.random() * 250)}`;
        const statuses: number[] = [];
        for (let call = 0; call < 2; call++) {
          const agent = await makeTestAgent({ issuer: oauthIssuer() });
          const { request } = await agentRequest({ path: DISCOVER_PATH, agent, unknown: true, headers: { "x-forwarded-for": address } });
          statuses.push((await DISCOVER(request, NO_PARAMS)).status);
        }
        expect(statuses).toEqual([200, 400]);
      } finally {
        if (previous === undefined) delete process.env.OAUTH_SIGNED_OUT_UNKNOWN_FETCH_RATE_LIMIT_PER_IP_HOURLY;
        else process.env.OAUTH_SIGNED_OUT_UNKNOWN_FETCH_RATE_LIMIT_PER_IP_HOURLY = previous;
      }
    });
  });

  // An agent over its own ceiling is served nothing, so its refused requests must not spend the
  // global share every other agent draws on.
  it("does not let one agent over its ceiling starve another through the global share", async () => {
    const { rateLimitCounters } = await import("@/server/db/schema");
    const { like } = await import("drizzle-orm");
    const saved = {
      client: process.env.SIGNED_OUT_READ_RATE_LIMIT_PER_CLIENT_HOURLY,
      global: process.env.SIGNED_OUT_READ_RATE_LIMIT_GLOBAL_HOURLY,
    };
    // Earlier tests in this file have already read signed out in this hour.
    await db.delete(rateLimitCounters).where(like(rateLimitCounters.bucket, "signed-out-read%"));
    process.env.SIGNED_OUT_READ_RATE_LIMIT_PER_CLIENT_HOURLY = "2";
    process.env.SIGNED_OUT_READ_RATE_LIMIT_GLOBAL_HOURLY = "4";
    try {
      const { makeTestAgent } = await import("@/server/poppy/testAgent");
      const greedy = await makeTestAgent({ issuer: oauthIssuer() });
      const statuses: number[] = [];
      for (let call = 0; call < 6; call++) {
        const { request } = await agentRequest({ path: "/api/v1/discover/playbooks", session: { sid: randomUUID() }, agent: greedy });
        statuses.push((await DISCOVER(request, NO_PARAMS)).status);
      }
      expect(statuses).toEqual([200, 200, 429, 429, 429, 429]);
      const other = await agentRequest({ path: "/api/v1/discover/playbooks" });
      expect((await DISCOVER(other.request, NO_PARAMS)).status).toBe(200);
    } finally {
      for (const [name, value] of [
        ["SIGNED_OUT_READ_RATE_LIMIT_PER_CLIENT_HOURLY", saved.client],
        ["SIGNED_OUT_READ_RATE_LIMIT_GLOBAL_HOURLY", saved.global],
      ] as const) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  // The kill switch (ADR-089 decision 3): Poppy 7 names a refused `client_id` as `invalid_session`.
  // The description is what tells a block from any other Session failure, which share the code.
  describe("a blocked client_id", () => {
    const REFUSED = { error: "invalid_session", error_description: "this client_id is refused" };

    it("is refused signed out, until it is unblocked", async () => {
      const { oauthClientBlocks } = await import("@/server/db/schema");
      const { request, agent } = await agentRequest({ path: "/api/v1/discover/playbooks" });
      expect((await DISCOVER(request, NO_PARAMS)).status).toBe(200);
      await db.insert(oauthClientBlocks).values({ clientId: agent.clientId, blockedAt: new Date(), blockedBy: "dev-operator" });
      const again = await agentRequest({ path: "/api/v1/discover/playbooks", agent });
      const blocked = await DISCOVER(again.request, NO_PARAMS);
      expect(blocked.status).toBe(400);
      expect(await blocked.json()).toEqual(REFUSED);
      await db.delete(oauthClientBlocks).where(eq(oauthClientBlocks.clientId, agent.clientId));
      const back = await agentRequest({ path: "/api/v1/discover/playbooks", agent });
      expect((await DISCOVER(back.request, NO_PARAMS)).status).toBe(200);
    });

    // A token it already holds outlives the block by up to an hour, and an agent the operator
    // no longer trusts is one that may leave the Session header off.
    it("is refused with an access token it already holds, even without a Session header", async () => {
      const { oauthClientBlocks, oauthClients } = await import("@/server/db/schema");
      const { connectForTest } = await import("@/server/test-support/oauthConnection");
      const { access, grant } = await connectForTest(await entitled(), ["trips:read"], new Date(), oauthIssuer());
      const open = await LIST_TRIPS(get("http://localhost/api/v1/trips", access), NO_PARAMS);
      expect(open.status).toBe(200);
      // Blocks name a protocol client_id, which only a CIMD client has.
      const cimdUrl = `https://blocked-${randomUUID()}.example/client.json`;
      await db.update(oauthClients).set({ kind: "cimd", cimdUrl, registeredIpHash: null }).where(eq(oauthClients.id, grant.clientId));
      await db.insert(oauthClientBlocks).values({ clientId: cimdUrl, blockedAt: new Date(), blockedBy: "dev-operator" });
      const blocked = await LIST_TRIPS(get("http://localhost/api/v1/trips", access), NO_PARAMS);
      expect(blocked.status).toBe(400);
      expect(await blocked.json()).toEqual(REFUSED);
      await db.delete(oauthClientBlocks).where(eq(oauthClientBlocks.clientId, cimdUrl));
      expect((await LIST_TRIPS(get("http://localhost/api/v1/trips", access), NO_PARAMS)).status).toBe(200);
    });
  });
});
