// **`GET /v1/discover/playbooks`** (ADR-050, Pass C), as real HTTP.
//
// The suite shares one database, and other files publish Playbooks too, so
// every Playbook here touches a city named for this run and every read filters
// on it — the only way "exactly these" can be asserted against a shared library.
import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { SavedDay } from "@tc/contracts";
import type { DiscoverDay, DiscoverSort } from "@/lib/playbooks";
import { upsertUser } from "@/server/users";
import { issueGrant } from "@/server/entitlements/grants";
import { livePlanVersion } from "@/server/entitlements/planVersions";
import { mintToken } from "@/server/api-tokens";
import { db } from "@/server/db/client";
import { savedDayRanks, savedDays, users } from "@/server/db/schema";
import { discoverDays, discoverPage, publishedDaysPage } from "@/server/playbooks";

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

/** A Playbook of `days` days whose first day holds `stops` stops in `city`, published unless told otherwise. */
async function playbookIn(
  secret: string,
  city: string,
  opts: { days?: number; stops?: number; publish?: boolean; name?: string } = {},
): Promise<SavedDay> {
  const stops = Array.from({ length: opts.stops ?? 1 }, (_, i) => ({
    title: i === 0 ? "A stop" : `Stop ${i + 1}`,
    timeWindow: null,
    location: { name: `${city} centre`, city },
    notes: null,
    anchors: [],
    kind: "planned",
    tags: [],
    cost: null,
  }));
  const days = Array.from({ length: opts.days ?? 1 }, (_, i) => ({ stops: i === 0 ? stops : [] }));
  const res = await CREATE(req(secret, { name: opts.name ?? "Somewhere", days }, "POST"), NO_PARAMS);
  expect(res.status).toBe(201);
  const { playbook } = (await res.json()) as { playbook: SavedDay };
  if (opts.publish !== false) {
    const pub = await PATCH(req(secret, { visibility: "public" }, "PATCH"), P({ playbookId: playbook.savedDayId }));
    expect(pub.status).toBe(200);
  }
  return playbook;
}

type Page = { items: Omit<DiscoverDay, "ownerDisplayName">[]; nextCursor: string | null };

async function discover(secret: string, params: Record<string, string>): Promise<Page> {
  const url = `http://localhost/api/v1/discover/playbooks?${new URLSearchParams(params)}`;
  const res = await DISCOVER(req(secret, undefined, "GET", url), NO_PARAMS);
  expect(res.status).toBe(200);
  return (await res.json()) as Page;
}

/** Follow `nextCursor` to the end, returning every page. */
async function allPages(secret: string, params: Record<string, string>): Promise<Page["items"][]> {
  const pages: Page["items"][] = [];
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

  it("skips a row it cannot read and refills the page past it, so the listing does not end early", async () => {
    const city = `Discoverville-${RUN}-e`;
    const { secret } = await entitledToken();
    const made: string[] = [];
    for (let i = 0; i < 5; i += 1) made.push((await playbookIn(secret, city)).savedDayId);
    // Still matches the city (a column of its own); only `parseSavedDayColumns` refuses it.
    const [broken] = made.splice(2, 1);
    await db.update(savedDays).set({ stops: sql`'[{"nope": true}]'::jsonb` }).where(eq(savedDays.id, broken!));

    const pages = await allPages(secret, { city, limit: "2", sort: "newest" });
    expect(pages.slice(0, -1).every((p) => p.length === 2)).toBe(true);
    const seen = pages.flat().map((d) => d.savedDayId);
    expect(seen).not.toContain(broken);
    expect(new Set(seen)).toEqual(new Set(made));
  });

  // The API default is not `top` (Decision 7): a caller who sends no sort keeps the order they had.
  it("answers sort=top, and with no sort still ranks most-added", async () => {
    const city = `Discoverville-${RUN}-g`;
    const { secret } = await entitledToken();
    const first = await playbookIn(secret, city);
    const second = await playbookIn(secret, city);
    await db.update(savedDays).set({ adds: 5 }).where(eq(savedDays.id, second.savedDayId));
    await db.insert(savedDayRanks).values({ savedDayId: first.savedDayId, score: 9, addsRecent: 0, commentsRecent: 0, quality: 1, newDayLift: 1, computedAt: new Date() });

    const top = await discover(secret, { city, sort: "top" });
    expect(top.items.map((d) => d.savedDayId)).toEqual([first.savedDayId, second.savedDayId]);
    const bare = await discover(secret, { city });
    expect(bare.items.map((d) => d.savedDayId)).toEqual([second.savedDayId, first.savedDayId]);
  });

  it("treats a cursor that names no row as no cursor", async () => {
    const city = `Discoverville-${RUN}-f`;
    const { secret } = await entitledToken();
    for (let i = 0; i < 3; i += 1) await playbookIn(secret, city);

    const first = await discover(secret, { city, limit: "2", sort: "newest" });
    expect(first.items).toHaveLength(2);
    expect(await discover(secret, { city, limit: "2", sort: "newest", cursor: randomUUID() })).toEqual(first);
  });

  // Six days with ties and differences in every counter, and `top`'s scored,
  // tied, zero and unscored days, so each sort's keyset walks its tie-breaks.
  async function rankedCity(suffix: string) {
    const city = `Discoverville-${RUN}-${suffix}`;
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

    // `top` has scored days, tied scores, a zero score and unscored days, so
    // its null-last key and its adds tie-break are both walked by the pager.
    const scores: [number, number][] = [[0, 5], [1, 5], [2, 0], [4, 0.5]];
    // Publishing seeds a rank row of its own (part 2); clear them so some days
    // stay unscored and `top`'s null-last key is walked.
    await db.delete(savedDayRanks).where(inArray(savedDayRanks.savedDayId, ids));
    for (const [i, score] of scores) {
      await db
        .insert(savedDayRanks)
        .values({ savedDayId: ids[i]!, score, addsRecent: 0, commentsRecent: 0, quality: 1, newDayLift: 1, computedAt: new Date() });
    }
    return { city, owner, secret };
  }

  it("ranks exactly as the app's Discover and its place pages do, for every sort the API offers", async () => {
    const { city, owner, secret } = await rankedCity("d");

    for (const sort of ["most-added", "highest-rated", "most-reviewed", "newest", "top"] as DiscoverSort[]) {
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
      // The keyset order (`rankKeys`) against `orderBy`'s, which the place
      // pages and the candidate window read. The app's Discover cards are
      // `discoverPage` too, so they cannot stand in for `orderBy` here.
      const ordered = await publishedDaysPage({ cities: [city], sort }, { limit: 24, offset: 0 });
      expect(api.map((d) => d.savedDayId), sort).toEqual(ordered.days.map((d) => d.savedDayId));
      // The app's card, field for field, less the owner's name and the chip
      // links the API never sends (the last test in this file).
      expect(api, sort).toEqual(app.days.map(({ ownerDisplayName: _name, namedTags: _named, linkedTags: _linked, ...day }) => day));
    }
  });

  // `top` is web-only until the API part, so its keyset (`rankKeys`) is held to
  // `orderBy` here by paging the app's own `discoverPage`.
  it("pages top by keyset in the order the place pages list it", async () => {
    const { city, owner } = await rankedCity("top");
    const query: Parameters<typeof discoverPage>[0] = { cities: [city], scope: "everyone", sort: "top", length: "any", publishedOnly: true, readerId: owner };
    const paged: string[] = [];
    for (let after: string | null = null; ; ) {
      const page = await discoverPage(query, { limit: 4, after });
      if (page.length === 0) break;
      paged.push(...page.map((d) => d.savedDayId));
      after = page.at(-1)!.savedDayId;
    }
    const ordered = await publishedDaysPage({ cities: [city], sort: "top" }, { limit: 24, offset: 0 });
    expect(paged).toHaveLength(6);
    expect(paged).toEqual(ordered.days.map((d) => d.savedDayId));
  });

  // The app's Discover card names its owner ("Dana R.", Mitchell 2026-10-02);
  // this API does not. `route()` sends the handler's objects, not the item
  // schema's parse, so the field has to be dropped by the handler — an
  // `.omit` on the schema alone would still ship it.
  // The card shows as many stop rows as fit (M51 part 9), so the item carries
  // day one's stops past three, as the app's card does.
  it("previews day one's stops past three", async () => {
    const city = `Discoverville-${RUN}-preview`;
    const { secret } = await entitledToken();
    await playbookIn(secret, city, { stops: 5 });

    const { items } = await discover(secret, { city });
    expect(items).toHaveLength(1);
    expect(items[0]!.preview.map((stop) => stop.title)).toEqual(["A stop", "Stop 2", "Stop 3", "Stop 4", "Stop 5"]);
  });

  it("names nobody: the item carries the owner's id and not their name", async () => {
    const city = `Discoverville-${RUN}-names`;
    const { owner, secret } = await entitledToken();
    await db.update(users).set({ displayName: "Dana Reyes", name: "Dana Reyes" }).where(eq(users.id, owner));
    await playbookIn(secret, city);

    const { items } = await discover(secret, { city });
    expect(items).toHaveLength(1);
    expect(items[0]!.ownerId).toBe(owner);
    expect(Object.keys(items[0]!)).not.toContain("ownerDisplayName");
    expect(JSON.stringify(items)).not.toContain("Dana");
  });
});
