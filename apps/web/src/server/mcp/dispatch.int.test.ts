// **A tool call is its v1 request** (ADR-083 §8, M55 D2 and D11), against a
// real database: a retried create keeps one Playbook, a published Playbook's
// days answer with the way through, publishing answers the public URL, a
// cover set and moved through a tool is the one the app then reads, and a trip
// the caller cannot read answers as one that does not exist.
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { ApiScope } from "@tc/contracts";
import { deploymentOrigin } from "@/lib/deploymentOrigin";
import { dayPath } from "@/lib/playbookUrls";
import { grantMembership } from "@/server/access/members";
import { executeTripCommand } from "@/server/commands";
import { db } from "@/server/db/client";
import { apiIdempotencyKeys } from "@/server/db/schema";
import { issueGrant } from "@/server/entitlements/grants";
import { livePlanVersion } from "@/server/entitlements/planVersions";
import type { Fetcher } from "@/server/external/remoteImage/fetchImage";
import type { Resolve } from "@/server/external/remoteImage/guard";
import { mcpResource } from "@/server/oauth/metadata";
import { getSavedDayCover } from "@/server/savedDayCovers";
import { deleteSavedDay } from "@/server/savedDays";
import { connectForTest } from "@/server/test-support/oauthConnection";
import { getTripCover } from "@/server/tripCovers";
import { upsertUser } from "@/server/users";

vi.mock("@/server/auth", () => ({ auth: vi.fn(async () => null) }));

// A test may hold `forgetKey` to order two overlapping calls; otherwise it passes through.
const held = vi.hoisted(() => ({ forget: null as null | ((forget: () => Promise<void>) => Promise<void>) }));
vi.mock("@/server/public-api/idempotency", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/public-api/idempotency")>();
  return {
    ...real,
    forgetKey: (...args: Parameters<typeof real.forgetKey>) =>
      held.forget === null ? real.forgetKey(...args) : held.forget(() => real.forgetKey(...args)),
  };
});

// The real guarded fetcher, given a fake network, as `public-api/cover.int.test.ts` gives it:
// a cover URL's set-time check runs, and no request leaves the machine.
const IMAGE_URL = "https://cdn.example.com/harbour.png";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
vi.mock("@/server/external/remoteImage/fetchImage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/external/remoteImage/fetchImage")>();
  const resolve: Resolve = async () => [{ address: "93.184.216.34", family: 4 }];
  const fetch: Fetcher = async (url) => {
    if (url.href === IMAGE_URL) return new Response(PNG, { headers: { "content-type": "image/png" } });
    throw new Error(`unexpected fetch of ${url.href}`);
  };
  return {
    ...actual,
    fetchRemoteImage: (url: string, limits?: Parameters<typeof actual.fetchRemoteImage>[1]) =>
      actual.fetchRemoteImage(url, limits, { fetch, resolve }),
  };
});

const { callTool } = await import("./dispatch");
const { TOOLS } = await import("@/app/api/mcp/tools");

/** A connected client of a new premium account: a tool caller spending its access token. */
async function connect(scopes: ApiScope[] = ["library:read", "library:write"]) {
  return (await connectAs(scopes)).call;
}

/** `connect`, and the account it acts as. */
async function connectAs(scopes: ApiScope[] = ["library:read", "library:write"]) {
  const ownerId = `mcp-dispatch-${randomUUID().slice(0, 8)}`;
  await upsertUser({ id: ownerId, email: `${ownerId}@example.test`, name: null, image: null });
  const premium = livePlanVersion("premium");
  await issueGrant({
    userId: ownerId,
    planId: premium.planId,
    planVersion: premium.version,
    source: "admin",
    grantedBy: "dev-operator",
    reason: "M55 MCP dispatch fixture.",
    expiresAt: null,
  });
  const { grant, access } = await connectForTest(ownerId, scopes);
  const request = new Request(mcpResource(), { method: "POST", headers: { authorization: `Bearer ${access}` } });
  const call = async (name: string, input: Record<string, unknown>) => {
    const tool = TOOLS.find((t) => t.name === name);
    if (tool === undefined) throw new Error(`There is no tool named ${name}.`);
    const result = await callTool(tool, input, { request, userId: ownerId, grantId: grant.id });
    const text = (result.content[0] as { text: string }).text;
    return { isError: result.isError === true, text, json: () => JSON.parse(text), result };
  };
  return { call, ownerId };
}

/** One stop written inline, as `playbooks.int.test.ts` writes them. */
function stop(title: string) {
  return {
    title,
    timeWindow: { start: "09:00", end: "10:00" },
    location: { name: title, city: "Lisbon", countryCode: "PT" },
    notes: null,
    anchors: [],
    kind: "planned",
    tags: [],
    cost: { amountMinor: 0, currency: "EUR" },
  };
}

const TWO_DAYS = {
  name: `Two days in Lisbon ${randomUUID().slice(0, 6)}`,
  summary: "From the Lisbon tourism board's guide.",
  days: [{ stops: [stop("Belém Tower")] }, { stops: [stop("Alfama")] }],
};

describe("create_playbook", () => {
  it("returns the same Playbook when a call is retried, rather than keeping it twice", async () => {
    const call = await connect();
    const first = await call("create_playbook", TWO_DAYS);
    expect(first.isError, first.text).toBe(false);
    const again = await call("create_playbook", TWO_DAYS);
    expect(again.json().playbook.playbookId).toBe(first.json().playbook.playbookId);
    const mine = await call("list_my_playbooks", {});
    expect(mine.json().items.filter((p: { name: string }) => p.name === TWO_DAYS.name)).toHaveLength(1);
  });

  // The key is derived from the input, so a model cannot mint a new one: a
  // replay of something no longer true would answer it for a day.
  it("makes the Playbook again when the one it made has since been deleted", async () => {
    const { call, ownerId } = await connectAs();
    const first = (await call("create_playbook", TWO_DAYS)).json().playbook;
    expect(await deleteSavedDay(first.playbookId, ownerId)).toBe("deleted");
    const again = await call("create_playbook", TWO_DAYS);
    expect(again.isError, again.text).toBe(false);
    expect(again.json().playbook.playbookId).not.toBe(first.playbookId);
    expect((await call("get_playbook", { playbookId: again.json().playbook.playbookId })).isError).toBe(false);
  });

  it("runs again rather than replaying a refusal it kept", async () => {
    const { call, ownerId } = await connectAs();
    const first = (await call("create_playbook", TWO_DAYS)).json().playbook;
    // What a create from a trip the caller had not yet joined would have kept.
    await db
      .update(apiIdempotencyKeys)
      .set({ statusCode: 404, response: { error: { code: "not-found", message: "No such trip." } } })
      .where(eq(apiIdempotencyKeys.userId, ownerId));
    const again = await call("create_playbook", TWO_DAYS);
    expect(again.isError, again.text).toBe(false);
    expect(again.json().playbook.playbookId).not.toBe(first.playbookId);
  });

  // A kept 5xx came after the handler's writes (ADR-051): running again would keep the Playbook twice.
  it("replays a 5xx it kept rather than running again", async () => {
    const { call, ownerId } = await connectAs();
    expect((await call("create_playbook", TWO_DAYS)).isError).toBe(false);
    await db
      .update(apiIdempotencyKeys)
      .set({ statusCode: 500, response: { error: { code: "internal", message: "The answer failed its schema." } } })
      .where(eq(apiIdempotencyKeys.userId, ownerId));
    expect((await call("create_playbook", TWO_DAYS)).isError).toBe(true);
    const mine = await call("list_my_playbooks", {});
    expect(mine.json().items.filter((p: { name: string }) => p.name === TWO_DAYS.name)).toHaveLength(1);
  });

  // Two identical calls that both replayed a stale answer: the first forgets it
  // and makes the Playbook; the second must replay that, not forget it as well.
  it("keeps one Playbook when two overlapping calls both replayed an answer they forget", async () => {
    const { call, ownerId } = await connectAs();
    const first = (await call("create_playbook", TWO_DAYS)).json().playbook;
    expect(await deleteSavedDay(first.playbookId, ownerId)).toBe("deleted");
    let arrived = 0;
    let bothReplayed!: () => void;
    const barrier = new Promise<void>((resolve) => (bothReplayed = resolve));
    const calls: Promise<Awaited<ReturnType<typeof call>>>[] = [];
    // Both wait here until both have replayed; the second then waits for the first call to finish.
    held.forget = async (forget) => {
      const second = ++arrived === 2;
      if (second) bothReplayed();
      await barrier;
      if (second) await Promise.race(calls);
      await forget();
    };
    try {
      calls.push(call("create_playbook", TWO_DAYS), call("create_playbook", TWO_DAYS));
      const [a, b] = await Promise.all(calls);
      expect(arrived).toBe(2);
      expect(b!.json().playbook.playbookId).toBe(a!.json().playbook.playbookId);
    } finally {
      held.forget = null;
    }
    const mine = await call("list_my_playbooks", {});
    expect(mine.json().items.filter((p: { name: string }) => p.name === TWO_DAYS.name)).toHaveLength(1);
  });
});

describe("update_playbook", () => {
  it("answers a published Playbook's new days with unpublish, edit, republish", async () => {
    const call = await connect();
    const { playbook } = (await call("create_playbook", TWO_DAYS)).json();
    expect((await call("publish_playbook", { playbookId: playbook.playbookId })).isError).toBe(false);
    const edit = await call("update_playbook", {
      playbookId: playbook.playbookId,
      expectedVersion: playbook.version,
      days: [{ stops: [stop("Sintra")] }],
    });
    expect(edit.isError).toBe(true);
    expect(edit.text).toBe(
      "This Playbook is published, so its days cannot change. Call unpublish_playbook, then update_playbook " +
        "with the new days, then publish_playbook again.",
    );
  });

  it("does not publish because a model sent visibility it was never offered", async () => {
    const call = await connect();
    const { playbook } = (await call("create_playbook", TWO_DAYS)).json();
    const edit = await call("update_playbook", {
      playbookId: playbook.playbookId,
      expectedVersion: playbook.version,
      name: `${TWO_DAYS.name} (edited)`,
      visibility: "public",
    });
    expect(edit.isError, edit.text).toBe(false);
    expect(edit.json().playbook.visibility).toBe("private");
  });
});

describe("publish_playbook", () => {
  it("answers the Playbook's public URL", async () => {
    const call = await connect();
    const { playbook } = (await call("create_playbook", TWO_DAYS)).json();
    const published = (await call("publish_playbook", { playbookId: playbook.playbookId })).json();
    expect(published.playbook.visibility).toBe("public");
    expect(published.url).toBe(`${deploymentOrigin()}${dayPath(published.playbook)}`);
    expect(published.url).toMatch(/\/playbooks\/day\/two-days-in-lisbon-/);
  });
});

describe("the cover tools", () => {
  const COVER = { url: IMAGE_URL, alt: "The harbour at dusk", credit: { name: "Port of Leith" }, position: 30 };

  it("set a Playbook's cover from a URL and move it, as the app then reads it", async () => {
    const call = await connect();
    const { playbook } = (await call("create_playbook", TWO_DAYS)).json();
    const set = await call("set_playbook_cover", { playbookId: playbook.playbookId, ...COVER });
    expect(set.isError, set.text).toBe(false);
    const moved = await call("move_playbook_cover", { playbookId: playbook.playbookId, position: 80 });
    expect(moved.isError, moved.text).toBe(false);
    expect(await getSavedDayCover(playbook.playbookId)).toMatchObject({ source: "url", url: IMAGE_URL, position: 80 });
  });

  it("set a trip's cover from a URL and move it, as the app then reads it", async () => {
    const { call, ownerId } = await connectAs(["trips:read", "trips:write"]);
    const tripId = randomUUID();
    expect((await executeTripCommand({ type: "CreateTrip", tripId, name: "Leith" }, ownerId)).ok).toBe(true);
    const set = await call("set_trip_cover", { tripId, ...COVER });
    expect(set.isError, set.text).toBe(false);
    const moved = await call("move_trip_cover", { tripId, position: 15 });
    expect(moved.isError, moved.text).toBe(false);
    expect(await getTripCover(tripId)).toMatchObject({ source: "url", url: IMAGE_URL, position: 15 });
  });
});

describe("a trip the caller cannot read", () => {
  const ALL: ApiScope[] = ["trips:read", "trips:write", "notebook:read", "notebook:write"];

  /** A private trip of another account's, and that account. */
  async function strangersTrip() {
    const ownerId = `mcp-stranger-${randomUUID().slice(0, 8)}`;
    await upsertUser({ id: ownerId, email: `${ownerId}@example.test`, name: null, image: null });
    const tripId = randomUUID();
    expect((await executeTripCommand({ type: "CreateTrip", tripId, name: "Private" }, ownerId)).ok).toBe(true);
    return { ownerId, tripId };
  }

  // v1 answers a stranger `forbidden` (M22); over MCP that would tell a model
  // the trip exists (M55's *Two gates hold*), so it answers as a missing id.
  it.each([
    ["get_trip", (tripId: string) => ({ tripId })],
    ["list_notebook_pages", (tripId: string) => ({ tripId })],
    ["get_notebook_page", (tripId: string) => ({ tripId, pageId: randomUUID() })],
    ["update_notebook_page", (tripId: string) => ({ tripId, pageId: randomUUID(), title: "Mine now" })],
    ["set_trip_cover", (tripId: string) => ({ tripId, url: IMAGE_URL, alt: "The harbour", position: 30 })],
    ["move_trip_cover", (tripId: string) => ({ tripId, position: 15 })],
    // Its trip is in the body, where v1 gates it.
    ["create_playbook", (tripId: string) => ({ name: "Kept", source: { tripId, days: [{ dayId: randomUUID() }] } })],
  ])("%s answers a stranger's trip as it answers an id that does not exist", async (name, input) => {
    const call = await connect([...ALL, "library:write"]);
    const { tripId } = await strangersTrip();
    const missing = await call(name, input(randomUUID()));
    expect(missing).toMatchObject({ isError: true, text: "No such trip. (not-found)" });
    const stranger = await call(name, input(tripId));
    expect(stranger.result).toEqual(missing.result);
  });

  // A member short of the role can read the trip, so it learns nothing new and keeps the reason.
  it("still tells a viewer it may not edit the trip", async () => {
    const { call, ownerId: viewer } = await connectAs(ALL);
    const { ownerId, tripId } = await strangersTrip();
    await grantMembership(db, { tripId, userId: viewer, role: "viewer", invitedBy: ownerId, now: new Date().toISOString() });
    const moved = await call("move_trip_cover", { tripId, position: 15 });
    expect(moved).toMatchObject({ isError: true, text: "You do not have access to this trip. (forbidden)" });
  });

  // The re-check as viewer reaches the parse a stranger never does: a member
  // whose trip will not parse is still a member, and is not told it is missing.
  it("still tells a viewer it may not edit a trip that will not parse", async () => {
    const { call, ownerId: viewer } = await connectAs(ALL);
    const { ownerId, tripId } = await strangersTrip();
    const now = new Date().toISOString();
    await grantMembership(db, { tripId, userId: viewer, role: "viewer", invitedBy: ownerId, now });
    // A role no `TripRole` names fails only the overlay's parse, after the role
    // check. The owner is premium, or the lapse cap would make it a viewer.
    const premium = livePlanVersion("premium");
    await issueGrant({
      userId: ownerId,
      planId: premium.planId,
      planVersion: premium.version,
      source: "admin",
      grantedBy: "dev-operator",
      reason: "M55 MCP dispatch fixture.",
      expiresAt: null,
    });
    const odd = `mcp-odd-${randomUUID().slice(0, 8)}`;
    await upsertUser({ id: odd, email: `${odd}@example.test`, name: null, image: null });
    await grantMembership(db, { tripId, userId: odd, role: "bogus" as never, invitedBy: ownerId, now });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const moved = await call("move_trip_cover", { tripId, position: 15 });
    errors.mockRestore();
    expect(moved).toMatchObject({ isError: true, text: "You do not have access to this trip. (forbidden)" });
  });

  // The scope gate runs first, and its 403 is not the trip's: it names the scope to grant.
  it("still answers a missing scope as insufficient-scope", async () => {
    const call = await connect(["library:read"]);
    const { tripId } = await strangersTrip();
    const refused = await call("get_trip", { tripId });
    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(/^This token does not hold the "trips:read" scope\. \(insufficient-scope\)/);
  });
});
