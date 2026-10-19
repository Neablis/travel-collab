import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { executeTripCommand } from "@/server/commands";
import { db } from "@/server/db/client";
import { grantMembership } from "@/server/access/members";
import { createInvite } from "@/server/access/invites";
import { entitleAccounts } from "@/server/test-support/entitledAccount";
import { setTripCover } from "@/server/tripCovers";
import { upsertUser, writePreferences } from "@/server/users";
import { tripCoverFactory } from "@tc/factories";
import { DEMO_TRIP_ID } from "@/lib/demoTrip";

// The trip page's server read (`tripFirstData`) against the GET routes it
// stands in for. Its claim is "one policy, one shape": it lets in exactly whom
// the routes let in, and answers each body exactly as its route does. Both
// halves are asserted here, against the real routes and a real database.

const OWNER = "first-data-owner";
const VIEWER = "first-data-viewer";
const STRANGER = "first-data-stranger";

let currentUserId = OWNER;

vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
}));

const { tripFirstData } = await import("./tripFirstData");
const { GET: GET_TRIP } = await import("@/app/api/trips/[tripId]/route");
const { GET: GET_HISTORY } = await import("@/app/api/trips/[tripId]/history/route");
const { GET: GET_ACCESS } = await import("@/app/api/trips/[tripId]/access/route");
const { GET: GET_COVER } = await import("@/app/api/trips/[tripId]/cover/route");
const { GET: GET_PAGES } = await import("@/app/api/trips/[tripId]/pages/route");
const { GET: GET_PAGE } = await import("@/app/api/trips/[tripId]/pages/[pageId]/route");
const { GET: GET_GLOBALS } = await import("@/app/api/trips/[tripId]/globals/route");

const ctx = (tripId: string) => ({ params: Promise.resolve({ tripId }) });
const req = (path: string) => new Request(`http://x${path}`);

/**
 * A trip with a day and a stop, a viewer on it, an invite out, a cover, and its
 * notebooks already seeded. The seeding matters: the first notebook read
 * creates the defaults, which writes to the log, so a comparison straddling it
 * would compare two different trips. The invite and the cover are there so
 * the bodies that depend on who reads have something in them to differ by.
 */
async function seedTrip(): Promise<string> {
  const tripId = randomUUID();
  const dayId = randomUUID();
  await executeTripCommand({ type: "CreateTrip", tripId, name: "First data" }, OWNER);
  await executeTripCommand({ type: "AddDay", tripId, dayId }, OWNER);
  await executeTripCommand({ type: "AddActivity", tripId, activityId: randomUUID(), dayId, title: "Ramen" }, OWNER);
  await grantMembership(db, { tripId, userId: VIEWER, role: "viewer", invitedBy: OWNER, now: new Date().toISOString() });
  await createInvite(tripId, OWNER, { email: null, role: "editor" });
  const cover = tripCoverFactory.build();
  await setTripCover(
    tripId,
    { ...cover, id: cover.unsplashId, downloadLocation: `${cover.photoPageUrl}/download` },
    OWNER,
  );
  await GET_PAGES(req(`/api/trips/${tripId}/pages`), ctx(tripId));
  return tripId;
}

// Each reader has a home airport, and a different one: the globals' home
// zone is the READER's, so a body built for the wrong reader shows.
beforeAll(async () => {
  await entitleAccounts([OWNER]);
  await upsertUser({ id: VIEWER, email: null, name: null, image: null });
  await writePreferences(OWNER, { homeAirport: "NRT" });
  await writePreferences(VIEWER, { homeAirport: "JFK" });
});

beforeEach(() => {
  currentUserId = OWNER;
});

describe("tripFirstData", () => {
  it("answers nothing to a reader the routes refuse", async () => {
    const tripId = await seedTrip();
    currentUserId = STRANGER;
    expect(await tripFirstData(tripId)).toBeNull();
    currentUserId = "";
    expect(await tripFirstData(tripId)).toBeNull();
  });

  it("answers nothing for an unknown trip, a non-id, or the demo trip", async () => {
    expect(await tripFirstData(randomUUID())).toBeNull();
    expect(await tripFirstData("not-a-trip")).toBeNull();
    expect(await tripFirstData(DEMO_TRIP_ID)).toBeNull();
  });

  // The "one shape" claim: each field is the body its route answers, for the
  // same trip and the same reader. Asked as a viewer and as the owner, so the
  // reader-dependent parts — invites (the owner's only), `myRole`, the
  // reader's own home zone — differ between the two and must match per reader.
  it.each([
    ["a viewer", VIEWER, "viewer", 0, "America/New_York"],
    ["the owner", OWNER, "owner", 1, "Asia/Tokyo"],
  ] as const)("answers %s each body exactly as its GET route does", async (_who, reader, role, invites, zone) => {
    const tripId = await seedTrip();
    currentUserId = reader;
    const first = await tripFirstData(tripId);
    if (first === null) throw new Error(`expected first data for ${reader}`);
    expect(first.access.access.myRole).toBe(role);
    expect(first.access.access.invites).toHaveLength(invites);
    expect(first.globals.globals.homeTimeZone).toBe(zone);
    expect(first.cover.cover).not.toBeNull();

    const body = async (res: Response) => {
      expect(res.status).toBe(200);
      return res.json();
    };
    const base = `/api/trips/${tripId}`;
    expect(first.trip).toEqual(await body(await GET_TRIP(req(base), ctx(tripId))));
    expect(first.history).toEqual(await body(await GET_HISTORY(req(`${base}/history`), ctx(tripId))));
    expect(first.access).toEqual(await body(await GET_ACCESS(req(`${base}/access`), ctx(tripId))));
    expect(first.cover).toEqual(await body(await GET_COVER(req(`${base}/cover`), ctx(tripId))));
    expect(first.pages).toEqual(await body(await GET_PAGES(req(`${base}/pages`), ctx(tripId))));
    expect(first.globals).toEqual(await body(await GET_GLOBALS(req(`${base}/globals`), ctx(tripId))));

    // The Overview the lens would pick, as the page route answers it.
    const overview = first.pages.pages.find((p) => p.context.kind === "overview");
    if (overview === undefined || first.overview === null) throw new Error("expected the trip's Overview");
    expect(first.overview.page.id).toBe(overview.id);
    const pageRes = await GET_PAGE(req(`${base}/pages/${overview.id}`), {
      params: Promise.resolve({ tripId, pageId: overview.id }),
    });
    expect(first.overview).toEqual(await body(pageRes));
  });
});
