// **`GET /v1/discover/playbooks`** (ADR-050, Pass C), as real HTTP.
//
// The suite shares one database, and other files publish Playbooks too, so
// every Playbook here touches a city named for this run and every read filters
// on it — the only way "exactly these" can be asserted against a shared library.
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { SavedDay } from "@tc/contracts";
import type { DiscoverDay, DiscoverSort } from "@/lib/playbooks";
import { upsertUser } from "@/server/users";
import { issueGrant } from "@/server/entitlements/grants";
import { livePlanVersion } from "@/server/entitlements/planVersions";
import { mintToken } from "@/server/api-tokens";
import { db } from "@/server/db/client";
import { savedDays } from "@/server/db/schema";
import { discoverDays } from "@/server/playbooks";

vi.mock("@/server/auth", () => ({ auth: vi.fn(async () => null) }));

const { POST: CREATE } = await import("@/app/api/v1/playbooks/route");
const { PATCH } = await import("@/app/api/v1/playbooks/[playbookId]/route");
const { GET: DISCOVER } = await import("@/app/api/v1/discover/playbooks/route");

const RUN = randomUUID().slice(0, 8);
const NO_PARAMS = { params: Promise.resolve({} as Record<string, string>) };
const P = (params: Record<string, string>) => ({ params: Promise.resolve(params) });

async function entitledToken(): Promise<{ owner: string; secret: string }> {
  const owner = `v1d-${RUN}-${randomUUID().slice(0, 8)}`;
  await upsertUser({ id: owner, email: `${owner}@example.test`, name: null, image: null });
  const premium = livePlanVersion("premium");
  await issueGrant({
    userId: owner,
    planId: premium.planId,
    planVersion: premium.version,
    source: "admin",
    grantedBy: "dev-operator",
    reason: "ADR-050 pass C fixture.",
    expiresAt: null,
  });
  const minted = await mintToken(owner, {
    name: "discover",
    scopes: ["library:read", "library:write"],
    tripIds: null,
    expiresInDays: 30,
  });
  if (!minted.ok) throw new Error("mint failed");
  return { owner, secret: minted.created.secret };
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

/** A Playbook of `days` days whose first stop is in `city`, published unless told otherwise. */
async function playbookIn(
  secret: string,
  city: string,
  opts: { days?: number; publish?: boolean; name?: string } = {},
): Promise<SavedDay> {
  const stop = {
    title: "A stop",
    timeWindow: null,
    location: { name: `${city} centre`, city },
    notes: null,
    anchors: [],
    kind: "planned",
    tags: [],
    cost: null,
  };
  const days = Array.from({ length: opts.days ?? 1 }, (_, i) => ({ stops: i === 0 ? [stop] : [] }));
  const res = await CREATE(req(secret, { name: opts.name ?? "Somewhere", days }, "POST"), NO_PARAMS);
  expect(res.status).toBe(201);
  const { playbook } = (await res.json()) as { playbook: SavedDay };
  if (opts.publish !== false) {
    const pub = await PATCH(req(secret, { visibility: "public" }, "PATCH"), P({ playbookId: playbook.savedDayId }));
    expect(pub.status).toBe(200);
  }
  return playbook;
}

type Page = { items: DiscoverDay[]; nextCursor: string | null };

async function discover(secret: string, params: Record<string, string>): Promise<Page> {
  const url = `http://localhost/api/v1/discover/playbooks?${new URLSearchParams(params)}`;
  const res = await DISCOVER(req(secret, undefined, "GET", url), NO_PARAMS);
  expect(res.status).toBe(200);
  return (await res.json()) as Page;
}

/** Follow `nextCursor` to the end, returning every page. */
async function allPages(secret: string, params: Record<string, string>): Promise<DiscoverDay[][]> {
  const pages: DiscoverDay[][] = [];
  let cursor: string | null = null;
  do {
    const page = await discover(secret, { ...params, ...(cursor === null ? {} : { cursor }) });
    pages.push(page.items);
    cursor = page.nextCursor;
    if (pages.length > 20) throw new Error("the cursor never ended");
  } while (cursor !== null);
  return pages;
}

describe("GET /v1/discover/playbooks", () => {
  it("lists everyone's published Playbooks and not a private one — not even to its owner", async () => {
    const city = `Discoverville-${RUN}-a`;
    const a = await entitledToken();
    const b = await entitledToken();
    const mine = await playbookIn(a.secret, city);
    const theirs = await playbookIn(b.secret, city);
    const privateOne = await playbookIn(a.secret, city, { publish: false });

    const { items } = await discover(a.secret, { city });
    const ids = items.map((d) => d.savedDayId);
    expect(new Set(ids)).toEqual(new Set([mine.savedDayId, theirs.savedDayId]));
    expect(ids).not.toContain(privateOne.savedDayId);
    expect(items.every((d) => d.visibility === "public")).toBe(true);
    expect(items.find((d) => d.savedDayId === mine.savedDayId)!.isMine).toBe(true);
  });

  it("applies the length filter", async () => {
    const city = `Discoverville-${RUN}-b`;
    const { secret } = await entitledToken();
    await playbookIn(secret, city, { days: 1 });
    const three = await playbookIn(secret, city, { days: 3 });

    const { items } = await discover(secret, { city, length: "two-three" });
    expect(items.map((d) => d.savedDayId)).toEqual([three.savedDayId]);
  });

  it("pages with a cursor, every Playbook exactly once", async () => {
    const city = `Discoverville-${RUN}-c`;
    const { secret } = await entitledToken();
    const made = new Set<string>();
    for (let i = 0; i < 5; i += 1) made.add((await playbookIn(secret, city)).savedDayId);

    const pages = await allPages(secret, { city, limit: "2", sort: "newest" });
    expect(pages.map((p) => p.length)).toEqual([2, 2, 1]);
    const seen = pages.flat().map((d) => d.savedDayId);
    expect(seen).toHaveLength(5);
    expect(new Set(seen)).toEqual(made);
  });

  it("ranks exactly as the app's Discover does, for every sort", async () => {
    const city = `Discoverville-${RUN}-d`;
    const { owner, secret } = await entitledToken();
    const ids: string[] = [];
    for (let i = 0; i < 6; i += 1) ids.push((await playbookIn(secret, city)).savedDayId);
    // Counters are derived columns written by their own paths; set directly so
    // every sort has ties AND differences to order. Two share adds and rating.
    const counters: [number, number | null, number][] = [
      [3, 4.5, 2],
      [3, 4.5, 2],
      [0, null, 0],
      [9, 2, 7],
      [1, 5, 1],
      [0, 3, 4],
    ];
    for (const [i, [adds, rating, reviewCount]] of counters.entries()) {
      await db.update(savedDays).set({ adds, rating, reviewCount }).where(eq(savedDays.id, ids[i]!));
    }

    for (const sort of ["most-added", "highest-rated", "most-reviewed", "newest"] as DiscoverSort[]) {
      const app = await discoverDays({
        cities: [city],
        scope: "everyone",
        sort,
        budget: "any",
        length: "any",
        publishedOnly: true,
        readerId: owner,
      });
      const api = (await allPages(secret, { city, sort, limit: "4" })).flat();
      expect(api.map((d) => d.savedDayId), sort).toEqual(app.days.map((d) => d.savedDayId));
      expect(api, sort).toEqual(app.days);
    }
  });
});
