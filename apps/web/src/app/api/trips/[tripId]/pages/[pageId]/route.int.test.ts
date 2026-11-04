import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { newPageDoc } from "@tc/contracts";
import { listPages } from "@/server/pages";
import { executeTripCommand } from "@/server/commands";
import { executePageCommand } from "@/server/pageCommands";
import { acceptInvite, createInvite } from "@/server/access/invites";
import { createPageShare, revokePageShare } from "@/server/access/pageShares";
import { entitleAccounts } from "@/server/test-support/entitledAccount";

const OWNER = "pageget-route-owner";
const VIEWER = "pageget-route-viewer";

let currentUserId = OWNER;

vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
}));

const { GET } = await import("./route");

const params = (tripId: string, pageId: string) => ({ params: Promise.resolve({ tripId, pageId }) });
const req = () => new Request("http://test/x");

beforeAll(async () => {
  await entitleAccounts([OWNER]);
});
beforeEach(() => {
  currentUserId = OWNER;
});

// The *Public* chip's source for a viewer, who cannot read the shares list.
describe("GET /api/trips/:id/pages/:pageId, publicToken", () => {
  it("carries the live link's token to a viewer, and null once it is revoked", async () => {
    const tripId = randomUUID();
    await executeTripCommand({ type: "CreateTrip", tripId, name: "Chip" }, OWNER);
    const pageId = randomUUID();
    await executePageCommand({ type: "CreatePage", tripId, pageId, title: "Notes", context: { tripId }, content: newPageDoc() }, OWNER);
    const invite = await createInvite(tripId, OWNER, { email: null, role: "viewer" });
    const accepted = await acceptInvite(invite.token, VIEWER);
    if (!accepted.ok) throw new Error(accepted.error.message);

    currentUserId = VIEWER;
    expect(((await (await GET(req(), params(tripId, pageId))).json()) as { publicToken: unknown }).publicToken).toBeNull();

    currentUserId = OWNER;
    const made = await createPageShare(tripId, pageId, OWNER);
    if (!made.ok) throw new Error(made.error.message);
    currentUserId = VIEWER;
    expect(((await (await GET(req(), params(tripId, pageId))).json()) as { publicToken: unknown }).publicToken).toBe(made.value.token);

    await revokePageShare(tripId, pageId, made.value.shareId);
    expect(((await (await GET(req(), params(tripId, pageId))).json()) as { publicToken: unknown }).publicToken).toBeNull();
  });

  // The control's gate: the server's rule, so the three seeded notebooks that
  // POST refuses never offer *Make public*.
  it("says a seeded Money, Bookings and During the trip notebook is not publishable, and an ordinary one is", async () => {
    const tripId = randomUUID();
    await executeTripCommand({ type: "CreateTrip", tripId, name: "Seeds" }, OWNER);
    const seeded = await listPages(tripId);
    const publishable = async (pageId: string) =>
      ((await (await GET(req(), params(tripId, pageId))).json()) as { publishable: boolean }).publishable;

    for (const key of ["money", "bookings-and-confirmations", "today"]) {
      const page = seeded.find((p) => p.seedKey === key);
      expect(page, key).toBeDefined();
      expect(await publishable(page!.id), key).toBe(false);
    }
    const overview = seeded.find((p) => p.seedKey === "overview");
    expect(await publishable(overview!.id)).toBe(true);
  });
});
