// **Account → Connected apps, the list** (M55 D10), against a real database.
//
// Session-only, as the token list is: a connected app's own access token must
// not be able to read what else its owner has connected, and the last test
// holds that.
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ConnectedApp } from "@tc/contracts";
import { upsertUser } from "@/server/users";
import { connectForTest } from "@/server/test-support/oauthConnection";

let currentUserId: string | null = null;
vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId === null ? null : { user: { id: currentUserId } })),
}));

const { GET: LIST } = await import("./route");

const RUN = randomUUID().slice(0, 8);

async function account(): Promise<string> {
  const id = `apps-${RUN}-${randomUUID().slice(0, 8)}`;
  await upsertUser({ id, email: `${id}@example.test`, name: null, image: null });
  return id;
}

const list = (headers: HeadersInit = {}) => LIST(new Request("http://localhost/api/account/connected-apps", { headers }));

describe("listing connected apps", () => {
  it("lists the owner's grants as ConnectedApps, and no secret of theirs", async () => {
    const owner = await account();
    const connected = await connectForTest(owner, ["trips:read", "library:read"]);
    currentUserId = owner;

    const res = await list();
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(connected.access);
    expect(text).not.toContain(connected.refresh);
    const { apps } = JSON.parse(text) as { apps: unknown[] };
    expect(apps).toHaveLength(1);
    const [app] = apps.map((a) => ConnectedApp.parse(a));
    expect(app).toMatchObject({
      grantId: connected.grant.id,
      clientName: "Test app",
      redirectHost: "example.com",
      recognised: false,
      scopes: ["trips:read", "library:read"],
      lastUsedAt: null,
      revokedAt: null,
    });
  });

  it("shows nobody else's grants", async () => {
    const owner = await account();
    await connectForTest(await account());
    currentUserId = owner;
    expect((await (await list()).json()).apps).toEqual([]);
  });

  it("refuses an anonymous caller", async () => {
    currentUserId = null;
    expect((await list()).status).toBe(401);
  });

  // A connected app holding a live access token, and no session: the route
  // reads the session and nothing else, so the bearer has no meaning here.
  it("is not reachable with a connected app's own bearer", async () => {
    const owner = await account();
    const { access } = await connectForTest(owner, ["account:read"]);
    currentUserId = null;
    expect((await list({ authorization: `Bearer ${access}` })).status).toBe(401);
  });
});
