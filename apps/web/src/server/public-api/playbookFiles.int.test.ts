// **A Playbook as a file, and a keyed create** (ADR-050, Pass C), as real HTTP.
//
// Field survival through the conversion is proven once, without a database,
// in `packages/fixtures/src/bundle/fromPlaybook.test.ts`. What only this layer
// can prove: who may export what, that an import takes nothing on the file's
// authority (owner, visibility, version), and that export → import through the
// two endpoints reproduces the content.
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { SavedDay } from "@tc/contracts";
import { upsertUser } from "@/server/users";
import { issueGrant } from "@/server/entitlements/grants";
import { livePlanVersion } from "@/server/entitlements/planVersions";
import { mintToken } from "@/server/api-tokens";
import { db } from "@/server/db/client";
import { savedDays } from "@/server/db/schema";

vi.mock("@/server/auth", () => ({ auth: vi.fn(async () => null) }));

const { POST: CREATE } = await import("@/app/api/v1/playbooks/route");
const { PATCH } = await import("@/app/api/v1/playbooks/[playbookId]/route");
const { GET: EXPORT } = await import("@/app/api/v1/playbooks/[playbookId]/export/route");
const { POST: IMPORT } = await import("@/app/api/v1/playbooks/import/route");

const RUN = randomUUID().slice(0, 8);
const NO_PARAMS = { params: Promise.resolve({} as Record<string, string>) };
const P = (params: Record<string, string>) => ({ params: Promise.resolve(params) });

async function entitledToken(): Promise<{ owner: string; secret: string }> {
  const owner = `v1pf-${RUN}-${randomUUID().slice(0, 8)}`;
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
    name: "playbook-files",
    scopes: ["library:read", "library:write"],
    tripIds: null,
    expiresInDays: 30,
  });
  if (!minted.ok) throw new Error("mint failed");
  return { owner, secret: minted.created.secret };
}

const req = (secret: string, body?: unknown, method = "GET", key?: string) =>
  new Request("http://localhost/x", {
    method,
    headers: {
      authorization: `Bearer ${secret}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(key === undefined ? {} : { "Idempotency-Key": key }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

/** Every stop field set, on day 0; an interior rest day; a bare stop on day 2; a trailing rest day. */
const RICH_DAYS = [
  {
    stops: [
      {
        title: "Fushimi Inari",
        timeWindow: { start: "07:00", end: "09:00" },
        location: { name: "Fushimi Inari Taisha", lat: 34.9671, lng: 135.7727, countryCode: "JP", city: "Kyoto" },
        notes: "Before the crowds.",
        anchors: [{ kind: "dayOfWeek", days: ["tue", "wed"] }],
        kind: "pending",
        tags: ["outdoors", "ticketed"],
        cost: { amountMinor: 500, currency: "JPY" },
      },
    ],
  },
  { stops: [] },
  {
    stops: [
      { title: "Nishiki", timeWindow: null, location: null, notes: null, anchors: [], kind: "transit", tags: [], cost: null },
    ],
  },
  { stops: [] },
];

async function created(secret: string, extra: Record<string, unknown> = {}): Promise<SavedDay> {
  const res = await CREATE(
    req(secret, { name: "Kyoto, slowly", summary: "Four days, two of rest.", days: RICH_DAYS, ...extra }, "POST"),
    NO_PARAMS,
  );
  expect(res.status).toBe(201);
  return ((await res.json()) as { playbook: SavedDay }).playbook;
}

async function publish(secret: string, playbookId: string): Promise<void> {
  const res = await PATCH(req(secret, { visibility: "public" }, "PATCH"), P({ playbookId }));
  expect(res.status).toBe(200);
}

const exportOf = (secret: string, playbookId: string) => EXPORT(req(secret), P({ playbookId }));

type Imported = {
  playbook: SavedDay;
  warnings: { code: string; message: string }[];
  sourceVersion: number | null;
};

/** The content an export → import must reproduce: everything but ids, owner, version, visibility and time. */
const content = (p: SavedDay) => ({
  name: p.name,
  summary: p.summary,
  dayCount: p.dayCount,
  stops: p.stops,
  cities: p.cities,
  authorKind: p.authorKind,
  sourceTripName: p.sourceTripName,
});

describe("GET /v1/playbooks/{playbookId}/export", () => {
  it("exports your own private Playbook as a one-playbook file", async () => {
    const { owner, secret } = await entitledToken();
    const playbook = await created(secret);

    const res = await exportOf(secret, playbook.savedDayId);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="kyoto-slowly.json"');
    const file = await res.json();
    expect(file.trips).toEqual([]);
    expect(file.playbooks).toHaveLength(1);
    expect(file.playbooks[0]).toMatchObject({
      ownerId: owner,
      visibility: "private",
      version: 1,
      sourceTrip: { name: "Kyoto, slowly" },
      addedBy: [],
    });
    expect(file.playbooks[0].sourceTrip.id).toBeUndefined();
    expect(file.playbooks[0].days.map((d: { stops: unknown[] }) => d.stops.length)).toEqual([1, 0, 1, 0]);
  });

  it("is a 404 on somebody else's private Playbook, and a 200 once it is published", async () => {
    const author = await entitledToken();
    const reader = await entitledToken();
    const playbook = await created(author.secret);

    const hidden = await exportOf(reader.secret, playbook.savedDayId);
    expect(hidden.status).toBe(404);

    await publish(author.secret, playbook.savedDayId);
    const shown = await exportOf(reader.secret, playbook.savedDayId);
    expect(shown.status).toBe(200);
    expect((await shown.json()).playbooks[0].visibility).toBe("public");
  });
});

describe("POST /v1/playbooks/import", () => {
  const fileWith = (playbooks: unknown[], trips: unknown[] = []) => ({
    $schema: "travel-collab/content-bundle/v1",
    bundle: { id: "upload", name: "Upload", origin: "human" },
    trips,
    playbooks,
  });
  const onePlaybook = (over: Record<string, unknown> = {}) => ({
    key: "p",
    name: "From a file",
    ownerId: "somebody-else",
    sourceTrip: { id: randomUUID(), name: "Their trip" },
    days: [{ stops: [{ title: "A stop" }] }],
    ...over,
  });

  it("refuses a file with two playbooks, naming the count, and writes nothing", async () => {
    const { owner, secret } = await entitledToken();
    const res = await IMPORT(
      req(secret, fileWith([onePlaybook(), onePlaybook({ key: "q" })]), "POST"),
      NO_PARAMS,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toBe("This file contains 2 playbooks. Import takes one at a time.");
    expect(await db.select().from(savedDays).where(eq(savedDays.ownerId, owner))).toHaveLength(0);
  });

  it("refuses a file that also carries a trip", async () => {
    const { secret } = await entitledToken();
    const res = await IMPORT(req(secret, fileWith([onePlaybook()], [{ key: "t" }]), "POST"), NO_PARAMS);
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/^This file contains 1 trip\./);
  });

  it("makes the caller the owner, private, at version 1 — and says what it reset", async () => {
    const { owner, secret } = await entitledToken();
    const res = await IMPORT(
      req(secret, fileWith([onePlaybook({ visibility: "public", version: 7 })]), "POST"),
      NO_PARAMS,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as Imported;
    expect(body.playbook).toMatchObject({ ownerId: owner, visibility: "private", version: 1 });
    expect(body.playbook.sourceTripName).toBe("Their trip");
    expect(body.warnings.map((w) => w.code)).toEqual(["visibility-reset"]);
    expect(body.sourceVersion).toBe(7);
  });

  it("strips a calendar-date anchor exactly as POST /v1/playbooks does", async () => {
    const { secret } = await entitledToken();
    const dated = onePlaybook({
      days: [{ stops: [{ title: "Gion Matsuri", anchors: [{ kind: "dateRange", from: "2026-07-17", to: "2026-07-17" }] }] }],
    });
    const body = (await (await IMPORT(req(secret, fileWith([dated]), "POST"), NO_PARAMS)).json()) as Imported;
    expect(body.warnings.map((w) => w.code)).toEqual(["date-anchor-removed"]);
    expect(body.playbook.stops[0]!.anchors).toEqual([]);
  });
});

describe("export → import round trip", () => {
  it("reproduces name, summary, every day (rest days included) and every stop field", async () => {
    const author = await entitledToken();
    const importer = await entitledToken();
    const original = await created(author.secret);
    await publish(author.secret, original.savedDayId);

    const file = await (await exportOf(importer.secret, original.savedDayId)).json();
    const res = await IMPORT(req(importer.secret, file, "POST"), NO_PARAMS);
    expect(res.status).toBe(201);
    const { playbook: copy, sourceVersion } = (await res.json()) as Imported;

    expect(content(copy)).toEqual(content(original));
    expect(copy.dayCount).toBe(4);
    expect(copy.savedDayId).not.toBe(original.savedDayId);
    expect(copy.sourceTripId).not.toBe(original.sourceTripId);
    expect(copy.ownerId).toBe(importer.owner);
    expect(sourceVersion).toBe(1);
  });
});

describe("POST /v1/playbooks with an Idempotency-Key", () => {
  it("keeps the Playbook once when the same create is replayed", async () => {
    const { owner, secret } = await entitledToken();
    const key = randomUUID();
    const body = { name: "Once", days: RICH_DAYS };

    const first = await CREATE(req(secret, body, "POST", key), NO_PARAMS);
    expect(first.status).toBe(201);
    const second = await CREATE(req(secret, body, "POST", key), NO_PARAMS);
    expect(second.status).toBe(201);
    expect(second.headers.get("Idempotent-Replayed")).toBe("true");
    expect(await second.json()).toEqual(await first.json());
    expect(await db.select().from(savedDays).where(eq(savedDays.ownerId, owner))).toHaveLength(1);
  });
});
