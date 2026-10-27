// **A tool call is its v1 request** (ADR-083 §8, M55 D2 and D11), against a
// real database: a retried create keeps one Playbook, a published Playbook's
// days answer with the way through, and publishing answers the public URL.
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { ApiScope } from "@tc/contracts";
import { deploymentOrigin } from "@/lib/deploymentOrigin";
import { dayPath } from "@/lib/playbookUrls";
import { db } from "@/server/db/client";
import { apiIdempotencyKeys } from "@/server/db/schema";
import { issueGrant } from "@/server/entitlements/grants";
import { livePlanVersion } from "@/server/entitlements/planVersions";
import { mcpResource } from "@/server/oauth/metadata";
import { deleteSavedDay } from "@/server/savedDays";
import { connectForTest } from "@/server/test-support/oauthConnection";
import { upsertUser } from "@/server/users";

vi.mock("@/server/auth", () => ({ auth: vi.fn(async () => null) }));

const { callTool } = await import("./dispatch");
const { TOOLS } = await import("./tools");

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
    const result = await callTool(TOOLS.find((t) => t.name === name)!, input, { request, userId: ownerId, grantId: grant.id });
    const text = (result.content[0] as { text: string }).text;
    return { isError: result.isError === true, text, json: () => JSON.parse(text) };
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
