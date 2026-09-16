// **The two collections that page over a list they sorted themselves.**
//
// `GET /v1/trips` pages in SQL and `route.int.test.ts` covers it. These two do
// not: `searchCities` and `listSavedDays` each materialise a whole list and the
// endpoint filters it, which means the cursor has to describe the SAME order the
// list is in. Both got that wrong in a way no single-page read can show — a
// caller only sees it on page two, as a row that arrives twice or never.
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { upsertUser } from "@/server/users";
import { issueGrant } from "@/server/entitlements/grants";
import { livePlanVersion } from "@/server/entitlements/planVersions";
import { mintToken } from "@/server/api-tokens";
import { listSavedDays } from "@/server/savedDays";
import { db } from "@/server/db/client";
import { savedDays } from "@/server/db/schema";

vi.mock("@/server/auth", () => ({ auth: vi.fn(async () => null) }));

// The city index is the fixture here: what is under test is the cursor over its
// ordering, not the SQL that produces it (`searchCities` has its own tests).
const searchCities = vi.fn();
vi.mock("@/server/cities", () => ({ searchCities: (q: string) => searchCities(q) }));

const { GET: LIST_CITIES } = await import("@/app/api/v1/cities/route");
const { GET: LIST_LIBRARY } = await import("@/app/api/v1/library/route");

const RUN = randomUUID().slice(0, 8);
const NO_PARAMS = { params: Promise.resolve({} as Record<string, string>) };

async function entitledToken(scopes: string[]): Promise<{ owner: string; secret: string }> {
  const owner = `v1c-${RUN}-${randomUUID().slice(0, 8)}`;
  await upsertUser({ id: owner, email: `${owner}@example.test`, name: null, image: null });
  const premium = livePlanVersion("premium");
  await issueGrant({
    userId: owner,
    planId: premium.planId,
    planVersion: premium.version,
    source: "admin",
    grantedBy: "dev-operator",
    reason: "M22 collection-pagination fixture.",
    expiresAt: null,
  });
  const minted = await mintToken(owner, {
    name: "collections",
    scopes: scopes as Parameters<typeof mintToken>[1]["scopes"],
    tripIds: null,
    expiresInDays: 30,
  });
  expect(minted.ok).toBe(true);
  return { owner, secret: minted.ok ? minted.created.secret : "" };
}

/** Follow `nextCursor` to the end and return every item, in the order served. */
async function walk(
  endpoint: (req: Request, ctx: typeof NO_PARAMS) => Promise<Response>,
  url: string,
  secret: string,
  limit: number,
): Promise<Record<string, unknown>[]> {
  const seen: Record<string, unknown>[] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 25; guard += 1) {
    const href: string = `${url}${url.includes("?") ? "&" : "?"}limit=${limit}${
      cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`
    }`;
    const res: Response = await endpoint(
      new Request(href, { headers: { authorization: `Bearer ${secret}` } }),
      NO_PARAMS,
    );
    expect(res.status, href).toBe(200);
    const body = (await res.json()) as {
      items: Record<string, unknown>[];
      nextCursor: string | null;
    };
    seen.push(...body.items);
    cursor = body.nextCursor;
    if (cursor === null) return seen;
  }
  throw new Error("cursor never ended — the pager is looping");
}

describe("the city index pages in the order it is ranked", () => {
  // `order by days desc, city asc`. A cursor of just the city name compares in
  // an order the rows are not in: page two both repeats every alphabetically
  // later city from page one and skips the alphabetically earlier ones further
  // down the ranking.
  const RANKED = [
    { city: "Seville", days: 5 },
    { city: "Kyoto", days: 3 },
    { city: "Salzburg", days: 3 },
    { city: "Split", days: 3 },
    { city: "Aarhus", days: 1 },
    { city: "Seattle", days: 1 },
  ];

  it("serves every city exactly once across pages of two", async () => {
    const { secret } = await entitledToken(["trips:read"]);
    searchCities.mockResolvedValue(RANKED);

    const walked = await walk(LIST_CITIES, "http://localhost/api/v1/cities?q=s", secret, 2);
    expect(walked.map((c) => c["city"])).toEqual(RANKED.map((c) => c.city));
    expect(new Set(walked.map((c) => c["city"])).size).toBe(RANKED.length);
  });

  it("is not thrown by a cursor it did not mint", async () => {
    const { secret } = await entitledToken(["trips:read"]);
    searchCities.mockResolvedValue(RANKED);

    for (const cursor of ["Salzburg", "x|y", "", "|"]) {
      const res = await LIST_CITIES(
        new Request(`http://localhost/api/v1/cities?q=s&cursor=${encodeURIComponent(cursor)}`, {
          headers: { authorization: `Bearer ${secret}` },
        }),
        NO_PARAMS,
      );
      expect(res.status, cursor).toBe(200);
    }
  });
});

describe("the library pages over a total order", () => {
  /** Two days written in the same millisecond — the tie the cursor has to survive. */
  async function tiedDays(ownerId: string, howMany: number): Promise<string[]> {
    const createdAt = new Date("2026-06-01T12:00:00.000Z");
    const ids = Array.from({ length: howMany }, () => randomUUID());
    for (const id of ids) {
      await db.insert(savedDays).values({
        id,
        ownerId,
        name: `Day ${id.slice(0, 4)}`,
        stops: [],
        cities: [],
        visibility: "private",
        sourceTripId: randomUUID(),
        sourceTripName: "Kyoto",
        createdAt,
      });
    }
    return ids;
  }

  it("orders same-millisecond days the same way on every read", async () => {
    const { owner } = await entitledToken(["library:read"]);
    await tiedDays(owner, 4);

    const first = (await listSavedDays(owner)).map((d) => d.savedDayId);
    const second = (await listSavedDays(owner)).map((d) => d.savedDayId);
    // Without the `savedDayId` tie-break this comparator returns 0 for every
    // pair and the SELECT beneath it has no ORDER BY, so the two reads are free
    // to disagree — and a keyset pager over a list that reshuffles loses rows.
    expect(first).toEqual(second);
    expect(first).toEqual([...first].sort().reverse());
  });

  it("serves every saved day exactly once across pages of two", async () => {
    const { owner, secret } = await entitledToken(["library:read"]);
    const ids = await tiedDays(owner, 5);

    const walked = await walk(LIST_LIBRARY, "http://localhost/api/v1/library", secret, 2);
    expect(walked.map((d) => d["savedDayId"]).sort()).toEqual([...ids].sort());
  });
});
