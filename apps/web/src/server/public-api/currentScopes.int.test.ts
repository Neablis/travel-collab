// The current scopes: what a token that only needs the trip under way now can
// see and change — and what stays hidden from it.
//
// A current trip is one whose `tripNow` phase is `underway` or `soon` (a start
// within `SOON_DAYS = 3`); planning, ended and undated trips are never current,
// and neither is a deleted one. `current:read` also carries the read-only scopes
// that are not trip-scoped (`library:read`, `account:read`) and the Notebook on
// a current trip — but never `places:read`, whose every lookup spends the shared
// geocoding budget. `current:write` changes days and stops and undoes, redoes or
// reverts, on a current trip only — no trip creation, no sharing, no Notebook
// or library writes. Neither scope implies the other, as with `trips:read` and
// `trips:write` (ADR-045 rule 4).
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { upsertUser } from "@/server/users";
import { issueGrant } from "@/server/entitlements/grants";
import { livePlanVersion } from "@/server/entitlements/planVersions";
import { mintToken } from "@/server/api-tokens";
import { connectForTest } from "@/server/test-support/oauthConnection";
import { oauthIssuer } from "@/server/oauth/metadata";

vi.mock("@/server/auth", () => ({ auth: vi.fn(async () => null) }));
// The route handlers resolve a session through `@/server/auth` when no Bearer
// token is present; the real module loads next-auth, whose `next/server`
// import fails under vitest in this pnpm layout. Every sibling suite mocks it
// the same way, and every call here carries a Bearer token, so no session is
// ever consulted.

const { GET: LIST_TRIPS, POST: CREATE_TRIP } = await import("@/app/api/v1/trips/route");
const { GET: GET_TRIP, DELETE: DELETE_TRIP } = await import("@/app/api/v1/trips/[tripId]/route");
const { GET: TODAY } = await import("@/app/api/v1/trips/[tripId]/today/route");
const { GET: HISTORY } = await import("@/app/api/v1/trips/[tripId]/history/route");
const { GET: HISTORY_ENTRY } = await import("@/app/api/v1/trips/[tripId]/history/[seq]/route");
const { POST: UNDO } = await import("@/app/api/v1/trips/[tripId]/history/undo/route");
const { GET: LIST_PAGES, POST: ADD_PAGE } = await import("@/app/api/v1/trips/[tripId]/pages/route");
const { POST: ADD_DAY } = await import("@/app/api/v1/trips/[tripId]/days/route");
const { DELETE: REMOVE_DAY } = await import("@/app/api/v1/trips/[tripId]/days/[dayId]/route");
const { POST: ADD_STOP } = await import("@/app/api/v1/trips/[tripId]/activities/route");
const { DELETE: REMOVE_STOP } = await import("@/app/api/v1/trips/[tripId]/activities/[activityId]/route");
const { GET: LIST_LIBRARY } = await import("@/app/api/v1/library/route");
const { GET: LIST_SHARES, POST: CREATE_SHARE } = await import("@/app/api/v1/trips/[tripId]/shares/route");
const { POST: REDO } = await import("@/app/api/v1/trips/[tripId]/history/redo/route");
const { POST: REVERT } = await import("@/app/api/v1/trips/[tripId]/history/revert/route");
const { PATCH: PATCH_STOP } = await import("@/app/api/v1/trips/[tripId]/activities/[activityId]/route");
const { PATCH: EDIT_PAGE, DELETE: DELETE_PAGE } = await import("@/app/api/v1/trips/[tripId]/pages/[pageId]/route");
const { POST: CREATE_PLAYBOOK } = await import("@/app/api/v1/playbooks/route");
const { GET: COVER_GET } = await import("@/app/api/v1/playbooks/[playbookId]/cover/route");
const { GET: DISCOVER } = await import("@/app/api/v1/discover/playbooks/route");
const { GET: ACCOUNT } = await import("@/app/api/v1/account/route");
const { GET: GEOCODE } = await import("@/app/api/v1/geocode/route");

// The clock is frozen at a Tuesday evening: the underway trip is on its second
// day, the soon trip starts in two days, the ended one finished four days ago,
// the planning one starts in three weeks, and the undated one has no dates at
// all — so no test depends on the real day it runs.
const AT = Date.parse("2027-03-09T20:00:00.000Z");
const RUN = randomUUID().slice(0, 8);
const P = (params: Record<string, string>) => ({ params: Promise.resolve(params) });

async function entitled(): Promise<string> {
  const id = `v1c-${RUN}-${randomUUID().slice(0, 8)}`;
  await upsertUser({ id, email: `${id}@example.test`, name: null, image: null });
  const premium = livePlanVersion("premium");
  await issueGrant({
    userId: id,
    planId: premium.planId,
    planVersion: premium.version,
    source: "admin",
    grantedBy: "dev-operator",
    reason: "M22 Phase 4 fixture.",
    expiresAt: null,
  });
  return id;
}

async function tokenFor(owner: string, scopes: string[]): Promise<string> {
  const minted = await mintToken(owner, {
    name: "current-scopes",
    scopes: scopes as Parameters<typeof mintToken>[1]["scopes"],
    tripIds: null,
    expiresInDays: 30,
  });
  expect(minted.ok).toBe(true);
  return minted.ok ? minted.created.secret : "";
}

const req = (secret: string, body?: unknown, method = "GET", url = "http://localhost/x") =>
  new Request(url, {
    method,
    headers: {
      authorization: `Bearer ${secret}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

async function trip(secret: string, name: string, dates?: { startDate: string; endDate: string }) {
  const created = await CREATE_TRIP(req(secret, { name, ...dates }, "POST"), P({}));
  expect(created.status).toBe(201);
  return (await created.json()).tripId as string;
}

/** The refusal body for a trip the credential cannot see: a 404 that names no trip. */
async function expectNotFound(res: Response) {
  expect(res.status).toBe(404);
  const body = await res.json();
  expect(body.error.code).toBe("not-found");
  expect(body.error.message).toBe("No such trip.");
}

/** The refusal body for a scope the credential does not hold. */
async function expectInsufficientScope(res: Response, required: string) {
  expect(res.status).toBe(403);
  const body = await res.json();
  expect(body.error.code).toBe("insufficient-scope");
  expect(body.error.details.required).toBe(required);
}

describe("current:read — the forced filter", () => {
  let owner: string;
  let readSecret: string;
  let ownerSecret: string;
  let underway: string;
  let soon: string;
  let ended: string;
  let planning: string;
  let undated: string;
  let pageId: string;

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AT);
    owner = await entitled();
    readSecret = await tokenFor(owner, ["current:read"]);
    ownerSecret = await tokenFor(owner, ["trips:read", "trips:write"]);
    underway = await trip(ownerSecret, "Underway", { startDate: "2027-03-08", endDate: "2027-03-12" });
    soon = await trip(ownerSecret, "Soon", { startDate: "2027-03-11", endDate: "2027-03-13" });
    ended = await trip(ownerSecret, "Ended", { startDate: "2027-03-01", endDate: "2027-03-05" });
    planning = await trip(ownerSecret, "Planning", { startDate: "2027-04-01", endDate: "2027-04-05" });
    undated = await trip(ownerSecret, "Undated");
    // One Notebook page on the underway trip, so the pages read proves a page
    // is actually returned, not just an empty list.
    const notebookSecret = await tokenFor(owner, ["notebook:read", "notebook:write"]);
    const added = await ADD_PAGE(
      req(notebookSecret, { title: "Ideas", context: { tripId: underway }, content: { type: "doc", content: [] } }, "POST"),
      P({ tripId: underway }),
    );
    expect(added.status).toBe(201);
    pageId = (await added.json()).id as string;
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it("lists only current trips when ?active=true is omitted", async () => {
    const res = await LIST_TRIPS(req(readSecret), P({}));
    expect(res.status).toBe(200);
    const ids = ((await res.json()).items as { tripId: string }[]).map((item) => item.tripId).sort();
    expect(ids).toEqual([soon, underway].sort());
  });

  it("returns underway and soon for ?active=true, while trips:read stays underway-only", async () => {
    const current = await LIST_TRIPS(req(readSecret, undefined, "GET", "http://localhost/x?active=true"), P({}));
    expect(current.status).toBe(200);
    const currentIds = ((await current.json()).items as { tripId: string }[]).map((item) => item.tripId).sort();
    expect(currentIds).toEqual([soon, underway].sort());

    const full = await LIST_TRIPS(req(ownerSecret, undefined, "GET", "http://localhost/x?active=true"), P({}));
    expect(full.status).toBe(200);
    const fullIds = ((await full.json()).items as { tripId: string }[]).map((item) => item.tripId);
    expect(fullIds).toEqual([underway]);
  });

  it("reads the detail, today, history and pages of a current trip", async () => {
    for (const tripId of [underway, soon]) {
      expect((await GET_TRIP(req(readSecret), P({ tripId }))).status).toBe(200);
      expect((await TODAY(req(readSecret), P({ tripId }))).status).toBe(200);
      const history = await HISTORY(req(readSecret), P({ tripId }));
      expect(history.status).toBe(200);
      expect(Array.isArray((await history.json()).entries)).toBe(true);
      expect((await HISTORY_ENTRY(req(readSecret), P({ tripId, seq: "1" }))).status).toBe(200);
      const pages = await LIST_PAGES(req(readSecret), P({ tripId }));
      expect(pages.status).toBe(200);
      // The page added to the underway trip is actually listed there — and not
      // on the soon trip, which has only the pages creation seeds.
      const listed = ((await pages.json()).items as { id: string }[]).map((page) => page.id);
      if (tripId === underway) expect(listed).toContain(pageId);
      else expect(listed).not.toContain(pageId);
    }
  });

  it("refuses a planning, ended and undated trip with the trip's own 404", async () => {
    for (const tripId of [planning, ended, undated]) {
      await expectNotFound(await GET_TRIP(req(readSecret), P({ tripId })));
      await expectNotFound(await TODAY(req(readSecret), P({ tripId })));
      await expectNotFound(await HISTORY(req(readSecret), P({ tripId })));
      await expectNotFound(await LIST_PAGES(req(readSecret), P({ tripId })));
    }
  });

  it("lists share links on a current trip and 404s on a planning one", async () => {
    const shareSecret = await tokenFor(owner, ["sharing:write"]);
    const created = await CREATE_SHARE(req(shareSecret, undefined, "POST"), P({ tripId: underway }));
    expect(created.status).toBe(201);
    const shareId = (await created.json()).shareId as string;

    const links = await LIST_SHARES(req(readSecret), P({ tripId: underway }));
    expect(links.status).toBe(200);
    const items = (await links.json()).items as { shareId: string; tripId: string }[];
    expect(items.map((item) => item.shareId)).toContain(shareId);
    expect(items.every((item) => item.tripId === underway)).toBe(true);

    await expectNotFound(await LIST_SHARES(req(readSecret), P({ tripId: planning })));
  });

  it("reads a playbook's cover with current:read", async () => {
    const librarySecret = await tokenFor(owner, ["library:read", "library:write"]);
    const created = await CREATE_PLAYBOOK(
      req(
        librarySecret,
        {
          name: `Current cover ${RUN}`,
          days: [
            {
              stops: [
                {
                  title: "The harbour",
                  timeWindow: { start: "09:00", end: "12:00" },
                  location: { name: "The Shore", city: "Edinburgh", countryCode: "GB" },
                  notes: "",
                  anchors: [],
                  kind: "planned",
                  tags: [],
                  cost: null,
                },
              ],
            },
          ],
        },
        "POST",
      ),
      P({}),
    );
    expect(created.status).toBe(201);
    const playbookId = ((await created.json()) as { playbook: { playbookId: string } }).playbook.playbookId;

    const got = await COVER_GET(req(readSecret), P({ playbookId }));
    expect(got.status).toBe(200);
    expect((await got.json()).cover).toBeNull();
  });

  it("reads the library, Discover and account wholesale", async () => {
    const library = await LIST_LIBRARY(req(readSecret), P({}));
    expect(library.status).toBe(200);
    expect(Array.isArray((await library.json()).items)).toBe(true);

    const discover = await DISCOVER(req(readSecret), P({}));
    expect(discover.status).toBe(200);

    const account = await ACCOUNT(req(readSecret), P({}));
    expect(account.status).toBe(200);
    expect((await account.json()).userId).toBe(owner);
  });

  it("refuses place search, naming places:read", async () => {
    const res = await GEOCODE(req(readSecret, undefined, "GET", "http://localhost/x?q=Lisbon"), P({}));
    await expectInsufficientScope(res, "places:read");
  });
});

describe("current:read — a deleted trip is not current", () => {
  it("returns 404 for an underway trip its owner deleted", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AT);
    try {
      const owner = await entitled();
      const readSecret = await tokenFor(owner, ["current:read"]);
      const ownerSecret = await tokenFor(owner, ["trips:read", "trips:write"]);
      const tripId = await trip(ownerSecret, "Deleted underway", {
        startDate: "2027-03-08",
        endDate: "2027-03-12",
      });
      expect((await GET_TRIP(req(readSecret), P({ tripId }))).status).toBe(200);
      expect((await DELETE_TRIP(req(ownerSecret, undefined, "DELETE"), P({ tripId }))).status).toBe(200);
      await expectNotFound(await GET_TRIP(req(readSecret), P({ tripId })));
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("current:write", () => {
  let owner: string;
  let readSecret: string;
  let writeSecret: string;
  let underway: string;
  let soon: string;
  let planning: string;

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AT);
    owner = await entitled();
    readSecret = await tokenFor(owner, ["current:read"]);
    writeSecret = await tokenFor(owner, ["current:write"]);
    const ownerSecret = await tokenFor(owner, ["trips:read", "trips:write"]);
    underway = await trip(ownerSecret, "Underway", { startDate: "2027-03-08", endDate: "2027-03-12" });
    soon = await trip(ownerSecret, "Soon", { startDate: "2027-03-11", endDate: "2027-03-13" });
    planning = await trip(ownerSecret, "Planning", { startDate: "2027-04-01", endDate: "2027-04-05" });
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it("adds a day and a stop to a current trip, and undoes the stop", async () => {
    const withDay = await ADD_DAY(req(writeSecret, {}, "POST"), P({ tripId: underway }));
    expect(withDay.status).toBe(201);
    const dayId = (await withDay.json()).days[0].dayId as string;

    const withStop = await ADD_STOP(req(writeSecret, { title: "Morning market", dayId }, "POST"), P({ tripId: underway }));
    expect(withStop.status).toBe(201);
    const activityId = Object.keys((await withStop.json()).activities)[0] as string;

    const undone = await UNDO(req(writeSecret, {}, "POST"), P({ tripId: underway }));
    expect(undone.status).toBe(200);
    expect(Object.keys((await undone.json()).activities)).not.toContain(activityId);
  });

  it("deletes a day and a stop on a current trip", async () => {
    const withDay = await ADD_DAY(req(writeSecret, {}, "POST"), P({ tripId: soon }));
    expect(withDay.status).toBe(201);
    const dayId = (await withDay.json()).days[0].dayId as string;

    const withStop = await ADD_STOP(req(writeSecret, { title: "Old town walk", dayId }, "POST"), P({ tripId: soon }));
    expect(withStop.status).toBe(201);
    const activityId = Object.keys((await withStop.json()).activities)[0] as string;

    expect((await REMOVE_STOP(req(writeSecret, undefined, "DELETE"), P({ tripId: soon, activityId }))).status).toBe(200);
    expect((await REMOVE_DAY(req(writeSecret, undefined, "DELETE"), P({ tripId: soon, dayId }))).status).toBe(200);
  });

  it("redoes an undone change on a current trip", async () => {
    const withDay = await ADD_DAY(req(writeSecret, {}, "POST"), P({ tripId: underway }));
    expect(withDay.status).toBe(201);
    const dayId = (await withDay.json()).days[0].dayId as string;

    const withStop = await ADD_STOP(req(writeSecret, { title: "Morning market", dayId }, "POST"), P({ tripId: underway }));
    expect(withStop.status).toBe(201);
    const activityId = Object.keys((await withStop.json()).activities)[0] as string;

    const undone = await UNDO(req(writeSecret, {}, "POST"), P({ tripId: underway }));
    expect(undone.status).toBe(200);
    expect(Object.keys((await undone.json()).activities)).not.toContain(activityId);

    const redone = await REDO(req(writeSecret, {}, "POST"), P({ tripId: underway }));
    expect(redone.status).toBe(200);
    expect(Object.keys((await redone.json()).activities)).toContain(activityId);
  });

  it("reverts a current trip to its first revision", async () => {
    const ownerSecret = await tokenFor(owner, ["trips:read", "trips:write"]);
    const tripId = await trip(ownerSecret, "Revert me", { startDate: "2027-03-08", endDate: "2027-03-12" });
    const withDay = await ADD_DAY(req(writeSecret, {}, "POST"), P({ tripId }));
    expect(withDay.status).toBe(201);
    const dayId = (await withDay.json()).days[0].dayId as string;

    const withStop = await ADD_STOP(req(writeSecret, { title: "Old town walk", dayId }, "POST"), P({ tripId }));
    expect(withStop.status).toBe(201);
    const activityId = Object.keys((await withStop.json()).activities)[0] as string;

    const history = await HISTORY(req(readSecret), P({ tripId }));
    expect(history.status).toBe(200);
    // Newest first, so the earliest revision — the trip as created — is the
    // last entry, and its `toSeq` is the version to revert to. (Entries
    // carry `fromSeq`/`toSeq`, not `seq`; reverting to the newest entry's
    // `toSeq` would be already-at-that-state.)
    const entries = (await history.json()).entries as { toSeq: number }[];
    const firstSeq = entries[entries.length - 1]!.toSeq;

    const reverted = await REVERT(req(writeSecret, { toSeq: firstSeq }, "POST"), P({ tripId }));
    expect(reverted.status).toBe(200);
    const detail = (await reverted.json()) as { days: unknown[]; activities: Record<string, unknown> };
    expect(detail.days).toEqual([]);
    expect(Object.keys(detail.activities)).not.toContain(activityId);
  });

  it("patches a stop's title on a current trip", async () => {
    const withDay = await ADD_DAY(req(writeSecret, {}, "POST"), P({ tripId: underway }));
    expect(withDay.status).toBe(201);
    const dayId = (await withDay.json()).days[0].dayId as string;

    const withStop = await ADD_STOP(req(writeSecret, { title: "Morning market", dayId }, "POST"), P({ tripId: underway }));
    expect(withStop.status).toBe(201);
    const activityId = Object.keys((await withStop.json()).activities)[0] as string;

    const patched = await PATCH_STOP(req(writeSecret, { title: "Renamed market" }, "PATCH"), P({ tripId: underway, activityId }));
    expect(patched.status).toBe(200);
    const activities = (await patched.json()).activities as Record<string, { title: string }>;
    expect(activities[activityId]?.title).toBe("Renamed market");
  });

  it("refuses Notebook writes, naming notebook:write", async () => {
    const pageBody = { title: "Nope", context: { tripId: underway }, content: { type: "doc", content: [] } };
    await expectInsufficientScope(await ADD_PAGE(req(writeSecret, pageBody, "POST"), P({ tripId: underway })), "notebook:write");

    const notebookSecret = await tokenFor(owner, ["notebook:read", "notebook:write"]);
    const added = await ADD_PAGE(
      req(notebookSecret, { title: "Ideas", context: { tripId: underway }, content: { type: "doc", content: [] } }, "POST"),
      P({ tripId: underway }),
    );
    expect(added.status).toBe(201);
    const pageId = (await added.json()).id as string;

    await expectInsufficientScope(
      await EDIT_PAGE(req(writeSecret, { title: "Edited" }, "PATCH"), P({ tripId: underway, pageId })),
      "notebook:write",
    );
    await expectInsufficientScope(
      await DELETE_PAGE(req(writeSecret, undefined, "DELETE"), P({ tripId: underway, pageId })),
      "notebook:write",
    );
  });

  it("refuses a day, a stop and an undo on a planning trip with the trip's own 404", async () => {
    await expectNotFound(await ADD_DAY(req(writeSecret, {}, "POST"), P({ tripId: planning })));
    // The day need not exist: the current-trip guard runs before the command,
    // so a well-formed body on a non-current trip is refused the same way.
    await expectNotFound(await ADD_STOP(req(writeSecret, { title: "Not here", dayId: randomUUID() }, "POST"), P({ tripId: planning })));
    await expectNotFound(await UNDO(req(writeSecret, {}, "POST"), P({ tripId: planning })));
  });

  it("refuses trip creation, naming trips:write", async () => {
    const res = await CREATE_TRIP(req(writeSecret, { name: "Nope" }, "POST"), P({}));
    await expectInsufficientScope(res, "trips:write");
  });

  it("does not imply current:read, and current:read does not imply current:write", async () => {
    await expectInsufficientScope(await GET_TRIP(req(writeSecret), P({ tripId: underway })), "trips:read");
    await expectInsufficientScope(await ADD_DAY(req(readSecret, {}, "POST"), P({ tripId: underway })), "trips:write");
  });
});

describe("current:read through an OAuth grant", () => {
  it("reads a current trip and refuses a planning one, with no dispatch wrapper", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AT);
    try {
      const owner = await entitled();
      const ownerSecret = await tokenFor(owner, ["trips:read", "trips:write"]);
      const underway = await trip(ownerSecret, "Underway", { startDate: "2027-03-08", endDate: "2027-03-12" });
      const planning = await trip(ownerSecret, "Planning", { startDate: "2027-04-01", endDate: "2027-04-05" });
      const { access } = await connectForTest(owner, ["current:read"], new Date(), oauthIssuer());
      expect((await GET_TRIP(req(access), P({ tripId: underway }))).status).toBe(200);
      await expectNotFound(await GET_TRIP(req(access), P({ tripId: planning })));
    } finally {
      vi.useRealTimers();
    }
  });
});
