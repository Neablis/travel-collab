import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { newPageDoc, type PageNode } from "@tc/contracts";
import { executeTripCommand } from "@/server/commands";
import { executePageCommand } from "@/server/pageCommands";
import { listPages } from "@/server/pages";
import { createPageShare } from "@/server/access/pageShares";
import { acceptInvite, createInvite } from "@/server/access/invites";
import { entitleAccounts } from "@/server/test-support/entitledAccount";

const OWNER = "ppreview-route-owner";
const VIEWER = "ppreview-route-viewer";
const SUGGESTER = "ppreview-route-suggester";

let currentUserId = OWNER;

vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
}));

const { GET } = await import("./route");

const params = (tripId: string, pageId: string) => ({ params: Promise.resolve({ tripId, pageId }) });
const req = () => new Request("http://test/x");

const link = (to: Record<string, unknown>, hideWhenPublic?: true): PageNode =>
  ({ type: "macro", attrs: { name: "link.internal", params: { to }, ...(hideWhenPublic ? { hideWhenPublic } : {}) } }) as PageNode;

async function seedTrip(): Promise<string> {
  const tripId = randomUUID();
  const created = await executeTripCommand({ type: "CreateTrip", tripId, name: "Preview" }, OWNER);
  if (!created.ok) throw new Error("failed to seed trip");
  return tripId;
}

async function seedPage(tripId: string, title: string, content: PageNode[] = []): Promise<string> {
  const pageId = randomUUID();
  const made = await executePageCommand(
    { type: "CreatePage", tripId, pageId, title, context: { tripId }, content: newPageDoc(content) },
    OWNER,
  );
  if (!made.ok) throw new Error("failed to seed page");
  return pageId;
}

type Body = {
  preview: { view: { title: string; content: { type: string; attrs?: { outcome?: { status: string } } }[] }; plainText: string[]; alsoPublic: { pageId: string; title: string }[] };
};

beforeAll(async () => {
  await entitleAccounts([OWNER]);
});
beforeEach(() => {
  currentUserId = OWNER;
});

describe("GET /api/trips/:id/pages/:pageId/public-preview", () => {
  it("lists a private notebook the page links to as plain text, and offers to make it public", async () => {
    const tripId = await seedTrip();
    const target = await seedPage(tripId, "Sam's surprise");
    const pageId = await seedPage(tripId, "Itinerary", [link({ kind: "notebook", pageId: target })]);
    const res = await GET(req(), params(tripId, pageId));
    expect(res.status).toBe(200);
    const { preview } = (await res.json()) as Body;
    expect(preview.plainText).toEqual(["Sam's surprise"]);
    expect(preview.alsoPublic).toEqual([{ pageId: target, title: "Sam's surprise" }]);
  });

  it("lists nothing once the target is public, and lists a seeded private notebook without offering it", async () => {
    const tripId = await seedTrip();
    // Before any page exists: the defaults are seeded only into an empty trip.
    const seeded = await listPages(tripId);
    const target = await seedPage(tripId, "Open notes");
    const money = seeded.find((p) => p.seedKey === "money");
    if (money === undefined) throw new Error("no money seed");
    const pageId = await seedPage(tripId, "Itinerary", [
      link({ kind: "notebook", pageId: target }),
      link({ kind: "notebook", pageId: money.id }),
      link({ kind: "view", view: "Map" }),
    ]);
    await createPageShare(tripId, target, OWNER);
    const { preview } = (await (await GET(req(), params(tripId, pageId))).json()) as Body;
    expect(preview.plainText).toEqual([money.title, "Map"]);
    expect(preview.alsoPublic).toEqual([]);
  });

  it("does not list the target of a link that is hidden when public", async () => {
    const tripId = await seedTrip();
    const target = await seedPage(tripId, "Hidden target");
    const pageId = await seedPage(tripId, "Itinerary", [link({ kind: "notebook", pageId: target }, true)]);
    const { preview } = (await (await GET(req(), params(tripId, pageId))).json()) as Body;
    expect(preview.plainText).toEqual([]);
    expect(preview.alsoPublic).toEqual([]);
  });

  it("serves the public view: a hidden widget is not-shared and carries no params", async () => {
    const tripId = await seedTrip();
    const pageId = await seedPage(tripId, "Itinerary", [
      { type: "macro", attrs: { name: "link.external", params: { href: "https://example.com/secret" }, hideWhenPublic: true } } as PageNode,
    ]);
    const { preview } = (await (await GET(req(), params(tripId, pageId))).json()) as Body;
    expect(preview.view.title).toBe("Itinerary");
    expect(preview.view.content[0]?.attrs?.outcome?.status).toBe("not-shared");
    expect(JSON.stringify(preview)).not.toContain("example.com/secret");
  });

  it("403s a suggester, who cannot publish", async () => {
    const tripId = await seedTrip();
    const pageId = await seedPage(tripId, "Itinerary");
    const invite = await createInvite(tripId, OWNER, { email: null, role: "suggester" });
    const accepted = await acceptInvite(invite.token, SUGGESTER);
    if (!accepted.ok) throw new Error(accepted.error.message);
    currentUserId = SUGGESTER;
    expect((await GET(req(), params(tripId, pageId))).status).toBe(403);
  });

  it("422s a notebook that can never be public, rather than previewing it", async () => {
    const tripId = await seedTrip();
    const seeded = await listPages(tripId);
    const money = seeded.find((p) => p.seedKey === "money");
    if (money === undefined) throw new Error("no money seed");
    expect((await GET(req(), params(tripId, money.id))).status).toBe(422);
  });

  it("403s a viewer and 404s a page of another trip", async () => {
    const tripId = await seedTrip();
    const pageId = await seedPage(tripId, "Itinerary");
    const invite = await createInvite(tripId, OWNER, { email: null, role: "viewer" });
    const accepted = await acceptInvite(invite.token, VIEWER);
    if (!accepted.ok) throw new Error(accepted.error.message);
    currentUserId = VIEWER;
    expect((await GET(req(), params(tripId, pageId))).status).toBe(403);
    currentUserId = OWNER;
    const other = await seedTrip();
    expect((await GET(req(), params(other, pageId))).status).toBe(404);
  });
});
