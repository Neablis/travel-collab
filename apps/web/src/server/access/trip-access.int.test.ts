import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SavedDay, TripDetail } from "@tc/contracts";
import { db } from "../db/client";
import { tripDetails } from "../db/schema";
import { executeTripCommand } from "../commands";
import { getTripDetail } from "../projections";
import { saveDay } from "../savedDays";
import { grantMembership } from "./members";
import { acceptInvite, createInvite, revokeInvite } from "./invites";
import { entitleAccounts } from "@/server/test-support/entitledAccount";
import { INVITE_TOKEN_HEADER } from "@/lib/inviteLook";

const OWNER = "trip-access-owner";
const STRANGER = "trip-access-stranger";
const GUEST = "trip-access-guest";

let currentUserId = OWNER;

vi.mock("../auth", () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
}));

const { requireTripAccess, withEffectiveMembers } = await import("./trip-access");
const { GET: GET_TRIP } = await import("@/app/api/trips/[tripId]/route");
const { POST: POST_COMMAND } = await import("@/app/api/trips/[tripId]/commands/route");

// No DB truncation: every test seeds its own randomUUID() trip and reads back
// through it — the convention the sibling route int tests use.
async function seedDay(): Promise<{ tripId: string; dayId: string }> {
  const tripId = randomUUID();
  const dayId = randomUUID();
  await executeTripCommand({ type: "CreateTrip", tripId, name: "Access" }, OWNER);
  await executeTripCommand({ type: "AddDay", tripId, dayId }, OWNER);
  await executeTripCommand(
    { type: "AddActivity", tripId, activityId: randomUUID(), dayId, title: "Ramen" },
    OWNER,
  );
  return { tripId, dayId };
}

type RawDoc = Record<string, unknown> & { activities: Record<string, Record<string, unknown>> };

/**
 * Age the stored projection back to what a doc written before M18 (and before
 * lineage) actually looks like on disk: no `kind`, no `tags`, no `forkedFrom`
 * key at all. Rewriting the row is the only faithful way to get one — a doc is
 * re-written only when its trip next changes, so the real rows in this shape
 * are the ones nobody has touched since.
 */
async function ageDocToPreM18(tripId: string): Promise<void> {
  const rows = await db.select().from(tripDetails).where(eq(tripDetails.tripId, tripId));
  const doc = JSON.parse(JSON.stringify(rows[0]!.doc)) as RawDoc;
  for (const activity of Object.values(doc.activities)) {
    delete activity.kind;
    delete activity.tags;
  }
  delete doc.forkedFrom;
  await db
    .update(tripDetails)
    // The column is `$type<TripDetail>()`, which is precisely the lie under
    // test: what is stored has never been parsed.
    .set({ doc: doc as unknown as TripDetail })
    .where(eq(tripDetails.tripId, tripId));
}

// **M20 link 6: this suite's trip owner has to be able to collaborate.**
// Seeding a trip by command mints no `users` row, and `entitlementsFor` reads a
// session with no row as bare `free` — so without this the owner's granted
// members cap to `viewer` on read and `POST /invites` refuses with 402. All of
// that is the gate working; this suite is about access, not entitlements.
beforeAll(async () => {
  await entitleAccounts([OWNER]);
});

beforeEach(() => {
  currentUserId = OWNER;
});

describe("requireTripAccess", () => {
  it("still answers the ordinary case with the effective member list", async () => {
    const { tripId } = await seedDay();
    const access = await requireTripAccess(tripId, "viewer");
    if ("error" in access) throw new Error(`expected access, got ${access.error.status}`);
    expect(access.userId).toBe(OWNER);
    expect(access.role).toBe("owner");
    expect(access.detail.tripId).toBe(tripId);
    expect(access.detail.members).toEqual([{ userId: OWNER, role: "owner" }]);
  });

  // KI-2026-09-05-x. `trip_details.trip_id` is a uuid column, so a path segment
  // that is not one used to reach Postgres and come back as `22P02 invalid
  // input syntax for type uuid` — a throw out of the seam, which every
  // trip-scoped route turned into a 500 and the board rendered as the literal
  // words "Internal Server Error".
  //
  // 404 and not 400 on purpose: a mistyped shared link and a link to a trip
  // that no longer exists are the same fact to the person holding it, and the
  // seam already refuses to let a caller tell "no such trip" from "not yours".
  //
  // Asserted at BOTH ranks because they take different paths out of the
  // function — `viewer` is the demo trip's rank, so a regression that put the
  // check behind the demo branch would still pass one of them.
  it.each(["viewer", "editor"] as const)(
    "404s a tripId that is not a uuid, rather than throwing (minimum: %s)",
    async (minimum) => {
      const access = await requireTripAccess("not-a-uuid", minimum);
      if (!("error" in access)) throw new Error("a malformed id should not grant access");
      expect(access.error.status).toBe(404);
    },
  );

  it("403s a stranger", async () => {
    const { tripId } = await seedDay();
    currentUserId = STRANGER;
    const access = await requireTripAccess(tripId, "viewer");
    if (!("error" in access)) throw new Error("a stranger should not have access");
    expect(access.error.status).toBe(403);
  });

  // PR #71 review §2. `getTripDetail` returns the stored doc RAW, so typing it
  // `TripDetail` without parsing was a claim nothing checked — the defaults
  // that make a pre-M18 doc legal only exist inside a parse.
  it("supplies the contract's defaults for a doc written before the fields existed", async () => {
    const { tripId } = await seedDay();
    await ageDocToPreM18(tripId);

    const access = await requireTripAccess(tripId, "viewer");
    if ("error" in access) throw new Error(`expected access, got ${access.error.status}`);
    const activities = Object.values(access.detail.activities);
    expect(activities).toHaveLength(1);
    expect(activities[0]!.kind).toBe("planned");
    expect(activities[0]!.tags).toEqual([]);
    expect(access.detail.forkedFrom).toBeNull();
  });

  // The confirmed 500: "Keep this day" on a pre-M18 trip inserted the library
  // row, THEN threw at `SavedDay.parse` because `stopsForDay` had copied
  // `undefined` into a required `SavedStop.kind` — leaving the user a 500 and
  // an orphaned, contract-violating row. This is the route's exact sequence
  // (requireTripAccess → saveDay → SavedDay.parse), one layer down.
  it("lets a day from a pre-M18 trip be kept, as a contract-valid saved day", async () => {
    const { tripId, dayId } = await seedDay();
    await ageDocToPreM18(tripId);

    const access = await requireTripAccess(tripId, "viewer");
    if ("error" in access) throw new Error(`expected access, got ${access.error.status}`);
    const saved = await saveDay({ name: "A kept day", dayIds: [dayId] }, access.detail, OWNER);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(() => SavedDay.parse(saved.value)).not.toThrow();
    expect(saved.value.stops).toEqual([
      expect.objectContaining({ title: "Ramen", kind: "planned", tags: [] }),
    ]);
  });
});

// KI-74. The sibling declared one function below `requireTripAccess`, carrying
// the defect the parse there was added to fix: `withEffectiveMembers` spreads
// whatever it was handed and calls the result a `TripDetail`. Its parameter
// being typed `TripDetail` is not the guarantee it looks like — the raw
// `trip_details.doc` was typed exactly that way for eight milestones and every
// consumer inherited the lie. These are the callers the entry says it never had.
describe("withEffectiveMembers", () => {
  it("supplies the contract's defaults for a doc written before the fields existed", async () => {
    const { tripId } = await seedDay();
    await ageDocToPreM18(tripId);

    // Exactly the way a caller reaches it: the raw projection, typed
    // `TripDetail` by `getTripDetail`'s signature and parsed by nothing.
    const raw = await getTripDetail(tripId);
    if (raw === null) throw new Error("the seeded trip has no projection");

    const detail = await withEffectiveMembers(raw);
    const activities = Object.values(detail.activities);
    expect(activities).toHaveLength(1);
    expect(activities[0]!.kind).toBe("planned");
    expect(activities[0]!.tags).toEqual([]);
    expect(detail.forkedFrom).toBeNull();
  });

  it("still overlays the granted members onto the projected ones", async () => {
    const { tripId } = await seedDay();
    await grantMembership(db, {
      tripId,
      userId: GUEST,
      role: "editor",
      invitedBy: OWNER,
      now: new Date().toISOString(),
    });
    const raw = await getTripDetail(tripId);
    if (raw === null) throw new Error("the seeded trip has no projection");

    const detail = await withEffectiveMembers(raw);
    expect(detail.members).toEqual([
      { userId: OWNER, role: "owner" },
      { userId: GUEST, role: "editor" },
    ]);
  });
});

// *Have a look first* (M27 D12). A pending invite's token reads the trip it was
// minted for, as a viewer, with no session — and nothing else.
describe("requireTripAccess with an invite token", () => {
  it("reads the invite's own trip as a viewer, signed out", async () => {
    const { tripId } = await seedDay();
    const invite = await createInvite(tripId, OWNER, { email: null, role: "editor" });
    currentUserId = "";

    const access = await requireTripAccess(tripId, "viewer", { inviteToken: invite.token });
    if ("error" in access) throw new Error(`refused: ${access.error.status}`);
    // A viewer even for an EDITOR invite: looking is not joining.
    expect(access.role).toBe("viewer");
    expect(access.detail.tripId).toBe(tripId);
  });

  it("reads nothing but that trip", async () => {
    const { tripId } = await seedDay();
    const { tripId: other } = await seedDay();
    const invite = await createInvite(tripId, OWNER, { email: null, role: "viewer" });
    currentUserId = "";

    const access = await requireTripAccess(other, "viewer", { inviteToken: invite.token });
    expect("error" in access && access.error.status).toBe(403);
  });

  it("stops working the moment the invite is spent or revoked", async () => {
    const { tripId } = await seedDay();
    const spent = await createInvite(tripId, OWNER, { email: null, role: "viewer" });
    const revoked = await createInvite(tripId, OWNER, { email: null, role: "viewer" });
    expect((await acceptInvite(spent.token, GUEST)).ok).toBe(true);
    expect((await revokeInvite(tripId, revoked.inviteId)).ok).toBe(true);
    currentUserId = "";

    for (const token of [spent.token, revoked.token, "no-such-token"]) {
      const access = await requireTripAccess(tripId, "viewer", { inviteToken: token });
      expect("error" in access && access.error.status).toBe(403);
    }
  });

  it("never grants more than viewer — every write asks for editor or owner", async () => {
    const { tripId } = await seedDay();
    const invite = await createInvite(tripId, OWNER, { email: null, role: "editor" });
    currentUserId = "";

    for (const minimum of ["editor", "owner"] as const) {
      const access = await requireTripAccess(tripId, minimum, { inviteToken: invite.token });
      expect("error" in access && access.error.status).toBe(403);
    }
  });

  // The header, when present, is the only thing consulted: a surface built to
  // be read-only must not be handed the reader's own editor role.
  it("answers with the token even for a signed-in owner, never their own role", async () => {
    const { tripId } = await seedDay();
    const invite = await createInvite(tripId, OWNER, { email: null, role: "editor" });
    currentUserId = OWNER;

    const access = await requireTripAccess(tripId, "viewer", { inviteToken: invite.token });
    if ("error" in access) throw new Error(`refused: ${access.error.status}`);
    expect(access.role).toBe("viewer");
  });

  it("does not serve a deleted trip to somebody who is not on it", async () => {
    const { tripId } = await seedDay();
    const invite = await createInvite(tripId, OWNER, { email: null, role: "viewer" });
    expect((await executeTripCommand({ type: "DeleteTrip", tripId }, OWNER)).ok).toBe(true);
    currentUserId = "";

    const access = await requireTripAccess(tripId, "viewer", { inviteToken: invite.token });
    expect("error" in access && access.error.status).toBe(404);
  });

  // The route half: the header reaches the seam through `inviteTokenOf`, and a
  // write route — which never passes it — answers as if it were not there.
  it("is read from the request by the trip route, and ignored by the command route", async () => {
    const { tripId, dayId } = await seedDay();
    const invite = await createInvite(tripId, OWNER, { email: null, role: "editor" });
    currentUserId = "";
    const headers = { [INVITE_TOKEN_HEADER]: invite.token };
    const params = { params: Promise.resolve({ tripId }) };

    const read = await GET_TRIP(new Request("http://test/x", { headers }), params);
    expect(read.status).toBe(200);

    const write = await POST_COMMAND(
      new Request("http://test/x", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ type: "AddActivity", tripId, dayId, activityId: randomUUID(), title: "Sneaked in" }),
      }),
      params,
    );
    expect(write.status).toBe(401);
  });
});
