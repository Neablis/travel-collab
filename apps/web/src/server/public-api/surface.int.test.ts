// **The rest of the v1 surface** (M22 Phase 4), driven as real HTTP.
//
// Phase 2 proved the seam at the smallest size that can fail. This proves the
// repetition is repetition: the planning writes land, the scopes separate, and
// the one write that is two commands behind one resource stays one endpoint.
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { upsertUser } from "@/server/users";
import { issueGrant } from "@/server/entitlements/grants";
import { livePlanVersion } from "@/server/entitlements/planVersions";
import { mintToken } from "@/server/api-tokens";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { events } from "@/server/db/schema";

vi.mock("@/server/auth", () => ({ auth: vi.fn(async () => null) }));

// **A pass-through, except when a test switches it on.** `POST /v1/trips` with
// dates is two writes (KI-2026-09-19-f); the second can only fail after the
// first on something the caller did not send — a lost race, a dropped
// connection — so the only way to reach the rollback is to make it fail here.
const injectDatesFailure = vi.hoisted(() => ({ on: false }));
vi.mock("@/server/public-api/commands", async (importOriginal) => {
  const real = await importOriginal<typeof import("./commands")>();
  return {
    ...real,
    runCommand: (actor: Parameters<typeof real.runCommand>[0], command: Parameters<typeof real.runCommand>[1]) =>
      injectDatesFailure.on && (command.type === "SetTripDates" || command.type === "SetTripStartDate")
        ? Promise.resolve({ ok: false as const, status: 409, message: "Injected: the dates write lost a race." })
        : real.runCommand(actor, command),
  };
});

const { POST: CREATE_TRIP, GET: LIST_TRIPS } = await import("@/app/api/v1/trips/route");
const { GET: GET_TRIP, PATCH: PATCH_TRIP, DELETE: DELETE_TRIP } = await import(
  "@/app/api/v1/trips/[tripId]/route"
);
const { POST: RESTORE } = await import("@/app/api/v1/trips/[tripId]/restore/route");
const { POST: ADD_DAY } = await import("@/app/api/v1/trips/[tripId]/days/route");
const { DELETE: REMOVE_DAY } = await import("@/app/api/v1/trips/[tripId]/days/[dayId]/route");
const { POST: ADD_STOP } = await import("@/app/api/v1/trips/[tripId]/activities/route");
const { PATCH: PATCH_STOP, DELETE: REMOVE_STOP } = await import(
  "@/app/api/v1/trips/[tripId]/activities/[activityId]/route"
);
const { POST: UNDO } = await import("@/app/api/v1/trips/[tripId]/history/undo/route");
const { GET: HISTORY } = await import("@/app/api/v1/trips/[tripId]/history/route");
const { GET: GLOBALS } = await import("@/app/api/v1/trips/[tripId]/globals/route");
const { GET: ACCOUNT } = await import("@/app/api/v1/account/route");
const { GET: LIST_PAGES, POST: ADD_PAGE } = await import("@/app/api/v1/trips/[tripId]/pages/route");
const { PATCH: PATCH_PAGE } = await import("@/app/api/v1/trips/[tripId]/pages/[pageId]/route");
const { GET: LIST_SHARES, POST: ADD_SHARE } = await import(
  "@/app/api/v1/trips/[tripId]/shares/route"
);

const RUN = randomUUID().slice(0, 8);
const NO_PARAMS = { params: Promise.resolve({} as Record<string, string>) };
const P = (params: Record<string, string>) => ({ params: Promise.resolve(params) });

async function entitled(): Promise<string> {
  const id = `v1s-${RUN}-${randomUUID().slice(0, 8)}`;
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
    name: "surface",
    scopes: scopes as Parameters<typeof mintToken>[1]["scopes"],
    tripIds: null,
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

/** A trip with one day and one stop, built entirely through v1. */
async function seed(secret: string) {
  const created = await CREATE_TRIP(req(secret, { name: "Kyoto" }, "POST"), NO_PARAMS);
  expect(created.status).toBe(201);
  const trip = await created.json();
  const tripId = trip.tripId as string;

  const withDay = await ADD_DAY(req(secret, {}, "POST"), P({ tripId }));
  expect(withDay.status).toBe(201);
  const dayId = (await withDay.json()).days[0].dayId as string;

  const withStop = await ADD_STOP(req(secret, { title: "Fushimi Inari", dayId }, "POST"), P({ tripId }));
  expect(withStop.status).toBe(201);
  const detail = await withStop.json();
  const activityId = Object.keys(detail.activities)[0] as string;
  return { tripId, dayId, activityId };
}

/** How many entries this trip's history holds right now. */
async function historyLength(secret: string, tripId: string): Promise<number> {
  const history = await HISTORY(req(secret), P({ tripId }));
  expect(history.status).toBe(200);
  return ((await history.json()).entries as unknown[]).length;
}

describe("the planning writes, through v1 only", () => {
  it("builds a trip, a day and a stop, and reads them back", async () => {
    const owner = await entitled();
    const secret = await tokenFor(owner, ["trips:read", "trips:write"]);
    const { tripId, dayId, activityId } = await seed(secret);

    const read = await GET_TRIP(req(secret), P({ tripId }));
    expect(read.status).toBe(200);
    const detail = await read.json();
    expect(detail.days).toHaveLength(1);
    expect(detail.activities[activityId].title).toBe("Fushimi Inari");
    expect(dayId).toBeTruthy();

    // The collection sees it too.
    const list = await LIST_TRIPS(req(secret), NO_PARAMS);
    expect((await list.json()).items.map((t: { tripId: string }) => t.tripId)).toContain(tripId);
  });

  // **Five commands behind one resource, and the caller never learns there were
  // five.** Name, dates, currency and budget in any combination.
  it("patches a trip's name, dates, currency and budget in one call", async () => {
    const owner = await entitled();
    const secret = await tokenFor(owner, ["trips:read", "trips:write"]);
    const { tripId } = await seed(secret);

    const before = await GET_TRIP(req(secret), P({ tripId }));
    const original = await before.json();
    const entriesBefore = await historyLength(secret, tripId);

    const patched = await PATCH_TRIP(
      req(secret, {
        name: "Kyoto in spring",
        startDate: "2027-04-01",
        currency: "JPY",
        budget: { amountMinor: 250000, currency: "JPY" },
      }, "PATCH"),
      P({ tripId }),
    );
    expect(patched.status).toBe(200);
    const detail = await patched.json();
    expect(detail.name).toBe("Kyoto in spring");
    expect(detail.startDate).toBe("2027-04-01");
    expect(detail.currency).toBe("JPY");
    expect(detail.budget).toEqual({ amountMinor: 250000, currency: "JPY" });

    // **One history entry, not four**, and this is now counted rather than
    // asserted in a comment: the previous version of this test read the history
    // and then only checked it was non-empty, which a trip with a day and a stop
    // in it satisfies without any patch at all.
    expect(await historyLength(secret, tripId)).toBe(entriesBefore + 1);

    // The batch is what makes the atomicity a public PATCH promises free rather
    // than engineered — and it is also what makes undo unwind the WHOLE patch,
    // so every one of the four fields is checked back to where it started.
    const undone = await UNDO(req(secret, {}, "POST"), P({ tripId }));
    expect(undone.status).toBe(200);
    const after = await undone.json();
    expect(after.name).toBe(original.name);
    expect(after.startDate).toBe(original.startDate);
    expect(after.currency).toBe(original.currency);
    expect(after.budget).toEqual(original.budget);
  });

  // **Decision 14, as a test.** A patch that touches a stop's fields AND its day
  // is two commands internally and one endpoint publicly.
  it("patches a stop's fields and its day in one call, atomically", async () => {
    const owner = await entitled();
    const secret = await tokenFor(owner, ["trips:read", "trips:write"]);
    const { tripId, activityId } = await seed(secret);

    // A second day to move it to.
    const second = await ADD_DAY(req(secret, {}, "POST"), P({ tripId }));
    const days = (await second.json()).days as { dayId: string }[];
    const target = days[1]!.dayId;

    const before = await GET_TRIP(req(secret), P({ tripId }));
    const original = await before.json();
    const originalTitle = original.activities[activityId].title as string;
    const originalDay = (original.days as { dayId: string; activityIds: string[] }[]).find((d) =>
      d.activityIds.includes(activityId),
    )!;
    const entriesBefore = await historyLength(secret, tripId);

    const patched = await PATCH_STOP(
      req(secret, { title: "Kinkaku-ji", dayId: target, position: 0 }, "PATCH"),
      P({ tripId, activityId }),
    );
    expect(patched.status).toBe(200);
    const detail = await patched.json();
    expect(detail.activities[activityId].title).toBe("Kinkaku-ji");
    expect(detail.days.find((d: { dayId: string }) => d.dayId === target).activityIds).toContain(
      activityId,
    );

    // Two commands, one entry — the claim in this test's own name.
    expect(await historyLength(secret, tripId)).toBe(entriesBefore + 1);

    // And they come back together: a title that reverted while the move stayed
    // would be the batch not being a batch.
    const undone = await UNDO(req(secret, {}, "POST"), P({ tripId }));
    expect(undone.status).toBe(200);
    const after = await undone.json();
    expect(after.activities[activityId].title).toBe(originalTitle);
    const restored = (after.days as { dayId: string; activityIds: string[] }[]).find((d) =>
      d.activityIds.includes(activityId),
    )!;
    expect(restored.dayId).toBe(originalDay.dayId);
    expect(restored.activityIds.indexOf(activityId)).toBe(
      originalDay.activityIds.indexOf(activityId),
    );
  });

  it("removes a stop, a day, and the trip — and restores the trip", async () => {
    const owner = await entitled();
    const secret = await tokenFor(owner, ["trips:read", "trips:write"]);
    const { tripId, dayId, activityId } = await seed(secret);

    expect((await REMOVE_STOP(req(secret, undefined, "DELETE"), P({ tripId, activityId }))).status).toBe(200);
    expect((await REMOVE_DAY(req(secret, undefined, "DELETE"), P({ tripId, dayId }))).status).toBe(200);

    // **A deleted trip is not gone**, which is why DELETE answers with the trip
    // rather than a 204 — its status says `deleted` and a caller can see it.
    const deleted = await DELETE_TRIP(req(secret, undefined, "DELETE"), P({ tripId }));
    expect(deleted.status).toBe(200);
    expect((await deleted.json()).status).toBe("deleted");

    const restored = await RESTORE(req(secret, {}, "POST"), P({ tripId }));
    // Creates nothing, so 200 — the one place a declaration says so.
    expect(restored.status).toBe(200);
    expect((await restored.json()).status).toBe("active");
  });
});

describe("the scopes actually separate", () => {
  // The eighth scope, and the gap writing the list in plain language found: a
  // token minted to sync an itinerary must not be able to hand a stranger
  // editor rights.
  it("will not let trips:write create a share link", async () => {
    const owner = await entitled();
    const planning = await tokenFor(owner, ["trips:read", "trips:write"]);
    const { tripId } = await seed(planning);

    const refused = await ADD_SHARE(req(planning, {}, "POST"), P({ tripId }));
    expect(refused.status).toBe(403);
    expect((await refused.json()).error.code).toBe("insufficient-scope");

    // …while the scope that names it does.
    const sharing = await tokenFor(owner, ["trips:read", "sharing:write"]);
    const created = await ADD_SHARE(req(sharing, {}, "POST"), P({ tripId }));
    expect(created.status).toBe(201);
    // And READING share links is `trips:read` — listing your own trip's links
    // is not more sensitive than reading the trip.
    const listed = await LIST_SHARES(req(planning), P({ tripId }));
    expect(listed.status).toBe(200);
    expect((await listed.json()).items).toHaveLength(1);
  });

  it("keeps the Notebook behind its own scopes", async () => {
    const owner = await entitled();
    const planning = await tokenFor(owner, ["trips:read", "trips:write"]);
    const { tripId } = await seed(planning);

    expect((await LIST_PAGES(req(planning), P({ tripId }))).status).toBe(403);

    const notebook = await tokenFor(owner, ["notebook:read", "notebook:write"]);
    const pages = await LIST_PAGES(req(notebook), P({ tripId }));
    expect(pages.status).toBe(200);

    const added = await ADD_PAGE(
      req(
        notebook,
        // Two things this fixture got wrong first, both of which the contract
        // correctly 400s: `content` is required (a page with no document is not
        // a page), and `PageContext.kind` is the literal `"overview"` or absent
        // — it is not a discriminator anyone gets to invent a value for.
        { title: "Ideas", context: { tripId }, content: { type: "doc", content: [] } },
        "POST",
      ),
      P({ tripId }),
    );
    expect(added.status).toBe(201);
    expect((await added.json()).title).toBe("Ideas");
  });

  it("answers who you are under account:read and refuses it otherwise", async () => {
    const owner = await entitled();
    const planning = await tokenFor(owner, ["trips:write"]);
    expect((await ACCOUNT(req(planning), NO_PARAMS)).status).toBe(403);

    const identity = await tokenFor(owner, ["account:read"]);
    const me = await ACCOUNT(req(identity), NO_PARAMS);
    expect(me.status).toBe(200);
    const body = await me.json();
    expect(body.userId).toBe(owner);
    expect(body.entitlements).toContain("api.tokens");
  });
});

describe("reads that were nearly free", () => {
  it("serves the trip's globals and its history", async () => {
    const owner = await entitled();
    const secret = await tokenFor(owner, ["trips:read", "trips:write"]);
    const { tripId } = await seed(secret);

    const globals = await GLOBALS(req(secret), P({ tripId }));
    expect(globals.status).toBe(200);
    expect(await globals.json()).toHaveProperty("cities");

    const history = await HISTORY(req(secret), P({ tripId }));
    expect(history.status).toBe(200);
    expect((await history.json()).entries.length).toBeGreaterThan(0);
  });
});

// **A PATCH changes what it names and nothing else**, which is the one promise
// REST makes that an event-sourced back end can quietly break: every write here
// becomes a command, and a command names every field it sets. Filling the ones
// the caller left out with a default is how a request to move an end date wipes
// a start date.
describe("a patch changes what it names, and nothing else", () => {
  it("keeps the start date when only the end date is patched", async () => {
    const owner = await entitled();
    const secret = await tokenFor(owner, ["trips:read", "trips:write"]);
    const { tripId } = await seed(secret);

    const dated = await PATCH_TRIP(req(secret, { startDate: "2027-04-01" }, "PATCH"), P({ tripId }));
    expect(dated.status).toBe(200);
    expect((await dated.json()).startDate).toBe("2027-04-01");

    const ended = await PATCH_TRIP(req(secret, { endDate: "2027-04-05" }, "PATCH"), P({ tripId }));
    // Clearing the start date does not merely lose it: the domain then refuses
    // an end date with no start, so the whole patch 400s. Both readings of this
    // failure are the same defect.
    expect(ended.status, "a patch naming only endDate must leave startDate alone").toBe(200);
    expect((await ended.json()).startDate).toBe("2027-04-01");
  });

  it("clears the start date when the caller asks for null", async () => {
    const owner = await entitled();
    const secret = await tokenFor(owner, ["trips:read", "trips:write"]);
    const { tripId } = await seed(secret);

    await PATCH_TRIP(
      req(secret, { startDate: "2027-04-01", endDate: "2027-04-03" }, "PATCH"),
      P({ tripId }),
    );
    // Both halves, because the domain will not hold an end date without a start
    // one — which is the right refusal and not what this test is about.
    const cleared = await PATCH_TRIP(
      req(secret, { startDate: null, endDate: null }, "PATCH"),
      P({ tripId }),
    );
    expect(cleared.status).toBe(200);
    // `undefined` means "leave it"; `null` still means "clear it", and the fix
    // for the first case must not take the second one away.
    expect((await cleared.json()).startDate).toBe(null);
  });

  it("refuses a date it cannot parse with 400, not 500", async () => {
    const owner = await entitled();
    const secret = await tokenFor(owner, ["trips:read", "trips:write"]);
    const { tripId } = await seed(secret);

    // `"invalid"` fails the shape; `2027-13-45` passes the shape and is still
    // not a date. Both reach `daySpan`, which throws — and a throw here is a
    // 500 telling the caller the server broke when they sent a bad date.
    for (const endDate of ["invalid", "2027-13-45", "2027-02-30"]) {
      const res = await PATCH_TRIP(
        req(secret, { startDate: "2027-04-01", endDate }, "PATCH"),
        P({ tripId }),
      );
      expect(res.status, endDate).toBe(400);
      expect((await res.json()).error.code, endDate).toBe("invalid-request");
    }

    // And the same for a start date the caller names outright.
    const badStart = await PATCH_TRIP(
      req(secret, { startDate: "2027-02-30", endDate: "2027-03-02" }, "PATCH"),
      P({ tripId }),
    );
    expect(badStart.status).toBe(400);
  });

  it("keeps a stop on its day when only its position is patched", async () => {
    const owner = await entitled();
    const secret = await tokenFor(owner, ["trips:read", "trips:write"]);
    const { tripId, dayId, activityId } = await seed(secret);

    const second = await ADD_STOP(
      req(secret, { title: "Nishiki Market", dayId }, "POST"),
      P({ tripId }),
    );
    expect(second.status).toBe(201);

    const moved = await PATCH_STOP(req(secret, { position: 1 }, "PATCH"), P({ tripId, activityId }));
    expect(moved.status).toBe(200);
    const detail = await moved.json();
    const day = (detail.days as { dayId: string; activityIds: string[] }[]).find(
      (d) => d.dayId === dayId,
    )!;
    // A reorder is not a removal. `toDayId: dayId ?? null` read an omitted day
    // as the backlog, so asking for position 1 took the stop off the itinerary.
    expect(day.activityIds).toContain(activityId);
    expect(day.activityIds.indexOf(activityId)).toBe(1);
    expect(detail.backlog).not.toContain(activityId);
  });

  it("sends a stop to the backlog when the caller asks for null", async () => {
    const owner = await entitled();
    const secret = await tokenFor(owner, ["trips:read", "trips:write"]);
    const { tripId, dayId, activityId } = await seed(secret);

    const moved = await PATCH_STOP(
      req(secret, { dayId: null }, "PATCH"),
      P({ tripId, activityId }),
    );
    expect(moved.status).toBe(200);
    const detail = await moved.json();
    expect(detail.backlog).toContain(activityId);
    expect(
      (detail.days as { dayId: string; activityIds: string[] }[]).find((d) => d.dayId === dayId)!
        .activityIds,
    ).not.toContain(activityId);
  });

  it("refuses a page patch whose context names a different trip", async () => {
    const owner = await entitled();
    const secret = await tokenFor(owner, ["notebook:read", "notebook:write"]);
    const { tripId } = await seed(await tokenFor(owner, ["trips:read", "trips:write"]));

    const added = await ADD_PAGE(
      req(secret, { title: "Ideas", context: { tripId }, content: { type: "doc", content: [] } }, "POST"),
      P({ tripId }),
    );
    expect(added.status).toBe(201);
    const pageId = (await added.json()).id as string;

    const confused = await PATCH_PAGE(
      req(secret, { context: { tripId: randomUUID() } }, "PATCH"),
      P({ tripId, pageId }),
    );
    // The BFF has refused this since the Notebook shipped; v1 was the copy that
    // dropped the check, so a page could be filed under one trip while claiming
    // another.
    expect(confused.status).toBe(400);
    expect((await confused.json()).error.code).toBe("invalid-request");
  });

  // KI-2026-09-05-g: v1 writes pages through the same command as the BFF, so
  // it gets the same two guarantees — a newer build's node survives verbatim,
  // and a widget the registry would not insert is refused, not stored.
  it("stores a page's document canonically and refuses a widget the registry would not insert", async () => {
    const owner = await entitled();
    const secret = await tokenFor(owner, ["notebook:read", "notebook:write"]);
    const { tripId } = await seed(await tokenFor(owner, ["trips:read", "trips:write"]));
    const future = { type: "futureNode", foo: 1 };

    const added = await ADD_PAGE(
      req(secret, { title: "Ideas", context: { tripId }, content: { type: "doc", content: [future] } }, "POST"),
      P({ tripId }),
    );
    expect(added.status).toBe(201);
    const page = await added.json();
    expect(page.content.content).toEqual([future]);

    const edited = await PATCH_PAGE(
      req(secret, { content: { ...page.content, content: [future, future] } }, "PATCH"),
      P({ tripId, pageId: page.id }),
    );
    expect(edited.status).toBe(200);
    expect((await edited.json()).content.content).toEqual([future, future]);

    const refused = await PATCH_PAGE(
      req(
        secret,
        { content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "macro", attrs: { name: "attribute", params: { field: "account.email" } } }] }] } },
        "PATCH",
      ),
      P({ tripId, pageId: page.id }),
    );
    expect(refused.status).toBe(400);
    expect((await refused.json()).error.code).toBe("invalid-request");
  });

  // The editor's stale-save guard is not v1 surface (CodeRabbit, PR #222): a
  // v1 PATCH naming an old revision is stripped of it and lands, last write
  // wins, exactly as before the field existed.
  it("keeps last-write-wins on a page PATCH, even one naming an old revision", async () => {
    const owner = await entitled();
    const secret = await tokenFor(owner, ["notebook:read", "notebook:write"]);
    const { tripId } = await seed(await tokenFor(owner, ["trips:read", "trips:write"]));
    const added = await ADD_PAGE(
      req(secret, { title: "Ideas", context: { tripId }, content: { type: "doc", content: [] } }, "POST"),
      P({ tripId }),
    );
    const page = await added.json();
    expect((await PATCH_PAGE(req(secret, { title: "Second" }, "PATCH"), P({ tripId, pageId: page.id }))).status).toBe(200);

    const late = await PATCH_PAGE(
      req(secret, { title: "Third", expectedUpdatedAt: page.updatedAt }, "PATCH"),
      P({ tripId, pageId: page.id }),
    );
    expect(late.status).toBe(200);
    expect((await late.json()).title).toBe("Third");
  });
});

// **A pager that skips a row is worse than one that repeats it**, because the
// caller cannot tell. Every collection on this surface materialises its list and
// then filters it, so the cursor has to describe the SAME order the list is in.
describe("the collections page without skipping or repeating", () => {
  it("walks the whole notebook in pages of two", async () => {
    const owner = await entitled();
    const planning = await tokenFor(owner, ["trips:read", "trips:write"]);
    const notebook = await tokenFor(owner, ["notebook:read", "notebook:write"]);
    const { tripId } = await seed(planning);

    for (const title of ["Ideas", "Budget", "Packing"]) {
      const added = await ADD_PAGE(
        req(notebook, { title, context: { tripId }, content: { type: "doc", content: [] } }, "POST"),
        P({ tripId }),
      );
      expect(added.status).toBe(201);
    }

    const whole = await LIST_PAGES(req(notebook), P({ tripId }));
    const all = ((await whole.json()).items as { id: string }[]).map((p) => p.id);
    expect(all.length).toBeGreaterThan(2);

    const walked: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 20; guard += 1) {
      const url: string = `http://localhost/x?limit=2${cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`}`;
      const res: Response = await LIST_PAGES(
        new Request(url, { headers: { authorization: `Bearer ${notebook}` } }),
        P({ tripId }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: { id: string }[]; nextCursor: string | null };
      walked.push(...body.items.map((p) => p.id));
      cursor = body.nextCursor;
      if (cursor === null) break;
    }

    // Every page exactly once, in the order the unpaged read gives them.
    expect(walked).toEqual(all);
    expect(new Set(walked).size).toBe(walked.length);
  });
});

// **Dates on create mean what they mean on PATCH** — the same mapping
// (`tripDatesCommand`), the same refusals, decided before anything is written.
describe("POST /v1/trips with dates", () => {
  /** Every event this account has ever appended — a refused create must add none. */
  const eventsBy = (userId: string) => db.select().from(events).where(eq(events.actorId, userId));

  it("creates a trip with its start and end dates, and one day per date", async () => {
    const owner = await entitled();
    const secret = await tokenFor(owner, ["trips:read", "trips:write"]);
    const created = await CREATE_TRIP(
      req(secret, { name: "Lisbon", startDate: "2027-05-01", endDate: "2027-05-03" }, "POST"),
      NO_PARAMS,
    );
    expect(created.status).toBe(201);
    const trip = await created.json();
    expect(trip.startDate).toBe("2027-05-01");
    // A trip has no end-date field; the end date IS the last day's date.
    expect(trip.days.map((d: { date: string }) => d.date)).toEqual([
      "2027-05-01",
      "2027-05-02",
      "2027-05-03",
    ]);

    const read = await GET_TRIP(req(secret), P({ tripId: trip.tripId }));
    expect((await read.json()).days).toHaveLength(3);
  });

  it("creates a trip with a start date only, and no days", async () => {
    const owner = await entitled();
    const secret = await tokenFor(owner, ["trips:read", "trips:write"]);
    const created = await CREATE_TRIP(
      req(secret, { name: "Porto", startDate: "2027-06-10" }, "POST"),
      NO_PARAMS,
    );
    expect(created.status).toBe(201);
    const trip = await created.json();
    expect(trip.startDate).toBe("2027-06-10");
    expect(trip.days).toHaveLength(0);
  });

  it("refuses an end date with no start date, and writes nothing at all", async () => {
    const owner = await entitled();
    const secret = await tokenFor(owner, ["trips:read", "trips:write"]);
    const refused = await CREATE_TRIP(
      req(secret, { name: "Faro", endDate: "2027-07-01" }, "POST"),
      NO_PARAMS,
    );
    expect(refused.status).toBe(400);
    const { error } = await refused.json();
    expect(error.code).toBe("invalid-request");
    expect(error.message).toBe("An end date needs a start date.");
    // Not "no live trip" — no trip, deleted or otherwise. A create followed by a
    // compensating delete would still leave a stream.
    expect(await eventsBy(owner)).toEqual([]);
  });

  it("leaves no live trip behind when the dates write fails after the create", async () => {
    const owner = await entitled();
    const secret = await tokenFor(owner, ["trips:read", "trips:write"]);
    injectDatesFailure.on = true;
    let failed: Response;
    try {
      failed = await CREATE_TRIP(
        req(secret, { name: "Braga", startDate: "2027-08-01", endDate: "2027-08-02" }, "POST"),
        NO_PARAMS,
      );
    } finally {
      injectDatesFailure.on = false;
    }
    expect(failed.status).toBe(409);
    expect((await failed.json()).error.message).toBe("Injected: the dates write lost a race.");
    // The create DID commit; the compensation is what keeps it off the list.
    expect((await eventsBy(owner)).map((e) => e.type)).toContain("TripCreated");
    const list = await LIST_TRIPS(req(secret), NO_PARAMS);
    expect((await list.json()).items).toEqual([]);
  });
});
