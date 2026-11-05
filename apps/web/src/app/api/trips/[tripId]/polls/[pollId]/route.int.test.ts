import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { newPageDoc, type PageNode } from "@tc/contracts";
import type { PollResults } from "@tc/pages";
import { executeTripCommand } from "@/server/commands";
import { acceptInvite, createInvite } from "@/server/access/invites";
import { executePageCommand } from "@/server/pageCommands";
import { entitleAccounts } from "@/server/test-support/entitledAccount";

const OWNER = "poll-route-owner";
const EDITOR = "poll-route-editor";
const SUGGESTER = "poll-route-suggester";
const VIEWER = "poll-route-viewer";
const STRANGER = "poll-route-stranger";

let currentUserId = OWNER;

vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
}));

const { GET, PUT } = await import("./route");
const { POST: CLOSE } = await import("./close/route");
const { POST: REOPEN } = await import("./reopen/route");

async function join(tripId: string, role: "viewer" | "suggester" | "editor", userId: string): Promise<void> {
  const invite = await createInvite(tripId, OWNER, { email: null, role });
  const accepted = await acceptInvite(invite.token, userId);
  if (!accepted.ok) throw new Error(accepted.error.message);
}

// One trip with a poll written on a page, and four seats.
async function seed(pollParams: Record<string, unknown> = {}): Promise<{ tripId: string; pollId: string }> {
  const tripId = randomUUID();
  const created = await executeTripCommand({ type: "CreateTrip", tripId, name: "Polls" }, OWNER);
  if (!created.ok) throw new Error("failed to seed trip");
  await join(tripId, "editor", EDITOR);
  await join(tripId, "suggester", SUGGESTER);
  await join(tripId, "viewer", VIEWER);
  const pollId = randomUUID();
  const poll = { type: "macro", attrs: { name: "poll", params: { pollId, question: "Where to eat?", options: "Ramen, Sushi, Tempura", ...pollParams } } };
  const page = await executePageCommand(
    { type: "CreatePage", tripId, pageId: randomUUID(), title: "Food", context: { tripId }, content: newPageDoc([poll as unknown as PageNode]) },
    OWNER,
  );
  if (!page.ok) throw new Error("failed to seed page");
  return { tripId, pollId };
}

const params = (tripId: string, pollId: string) => ({ params: Promise.resolve({ tripId, pollId }) });
const put = (body: unknown) =>
  new Request("http://test/x", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const get = () => new Request("http://test/x");
const post = () => new Request("http://test/x", { method: "POST" });

beforeAll(async () => {
  await entitleAccounts([OWNER]);
});

beforeEach(() => {
  currentUserId = OWNER;
});

describe("/api/trips/:id/polls/:pollId", () => {
  it("401s when unauthenticated and 403s a stranger", async () => {
    const { tripId, pollId } = await seed();
    currentUserId = "";
    expect((await GET(get(), params(tripId, pollId))).status).toBe(401);
    expect((await PUT(put({ optionIds: ["Ramen"] }), params(tripId, pollId))).status).toBe(401);
    currentUserId = STRANGER;
    expect((await GET(get(), params(tripId, pollId))).status).toBe(403);
    expect((await PUT(put({ optionIds: ["Ramen"] }), params(tripId, pollId))).status).toBe(403);
  });

  it("lets every seat vote, including a viewer, and names the voters to the group", async () => {
    const { tripId, pollId } = await seed();
    for (const [user, pick] of [[OWNER, "Ramen"], [EDITOR, "Sushi"], [SUGGESTER, "Sushi"], [VIEWER, "Tempura"]] as const) {
      currentUserId = user;
      const res = await PUT(put({ optionIds: [pick] }), params(tripId, pollId));
      expect(res.status, user).toBe(200);
    }
    currentUserId = VIEWER;
    const results = (await (await GET(get(), params(tripId, pollId))).json()) as PollResults;
    expect(results.counts).toEqual({ Ramen: 1, Sushi: 2, Tempura: 1 });
    expect(results.mine).toEqual(["Tempura"]);
    expect(results.votes.map((v) => v.userId).sort()).toEqual([EDITOR, OWNER, SUGGESTER, VIEWER]);
    expect(results.closed).toBe(false);
    // Closing is the notebook editors': the server says who may.
    expect(results.canClose).toBe(false);
    currentUserId = EDITOR;
    expect(((await (await GET(get(), params(tripId, pollId))).json()) as PollResults).canClose).toBe(true);
  });

  it("lets a member change their vote", async () => {
    const { tripId, pollId } = await seed();
    currentUserId = VIEWER;
    await PUT(put({ optionIds: ["Ramen"] }), params(tripId, pollId));
    const res = await PUT(put({ optionIds: ["Sushi"] }), params(tripId, pollId));
    expect(((await res.json()) as PollResults).counts).toEqual({ Ramen: 0, Sushi: 1, Tempura: 0 });
  });

  it("404s a poll id that is not a poll on this trip, even one that is on another", async () => {
    const mine = await seed();
    const other = await seed();
    expect((await PUT(put({ optionIds: ["Ramen"] }), params(mine.tripId, other.pollId))).status).toBe(404);
    expect((await GET(get(), params(mine.tripId, other.pollId))).status).toBe(404);
    expect((await GET(get(), params(mine.tripId, "nope"))).status).toBe(404);
    expect((await CLOSE(post(), params(mine.tripId, other.pollId))).status).toBe(404);
    expect((await REOPEN(post(), params(mine.tripId, other.pollId))).status).toBe(404);
  });

  it("400s a pick that is not an option, or a body that is not a pick", async () => {
    const { tripId, pollId } = await seed();
    expect((await PUT(put({ optionIds: ["Pizza"] }), params(tripId, pollId))).status).toBe(400);
    expect((await PUT(put({ optionIds: ["Ramen", "Sushi"] }), params(tripId, pollId))).status).toBe(400);
    expect((await PUT(put({ optionIds: [] }), params(tripId, pollId))).status).toBe(400);
    expect((await PUT(put({ pick: "Ramen" }), params(tripId, pollId))).status).toBe(400);
  });
});

describe("POST /api/trips/:id/polls/:pollId/close", () => {
  it("is for editors: a viewer and a suggester are refused, an editor closes it", async () => {
    const { tripId, pollId } = await seed();
    for (const user of [VIEWER, SUGGESTER]) {
      currentUserId = user;
      expect((await CLOSE(post(), params(tripId, pollId))).status, user).toBe(403);
    }
    currentUserId = EDITOR;
    const res = await CLOSE(post(), params(tripId, pollId));
    expect(res.status).toBe(200);
    expect(((await res.json()) as PollResults).closed).toBe(true);
  });

  it("stops the next vote with a 409, and keeps the votes in place", async () => {
    const { tripId, pollId } = await seed();
    currentUserId = VIEWER;
    await PUT(put({ optionIds: ["Ramen"] }), params(tripId, pollId));
    currentUserId = OWNER;
    await CLOSE(post(), params(tripId, pollId));
    currentUserId = VIEWER;
    const refused = await PUT(put({ optionIds: ["Sushi"] }), params(tripId, pollId));
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { code: string }).code).toBe("poll-closed");
    const results = (await (await GET(get(), params(tripId, pollId))).json()) as PollResults;
    expect(results).toMatchObject({ closed: true, counts: { Ramen: 1, Sushi: 0, Tempura: 0 }, mine: ["Ramen"] });
  });
});

describe("POST /api/trips/:id/polls/:pollId/reopen", () => {
  it("401s nobody-signed-in, 403s a stranger, a viewer and a suggester, and lets an editor reopen with the votes kept", async () => {
    const { tripId, pollId } = await seed();
    currentUserId = VIEWER;
    await PUT(put({ optionIds: ["Ramen"] }), params(tripId, pollId));
    currentUserId = OWNER;
    await CLOSE(post(), params(tripId, pollId));
    currentUserId = "";
    expect((await REOPEN(post(), params(tripId, pollId))).status).toBe(401);
    for (const user of [STRANGER, VIEWER, SUGGESTER]) {
      currentUserId = user;
      expect((await REOPEN(post(), params(tripId, pollId))).status, user).toBe(403);
    }
    currentUserId = EDITOR;
    const res = await REOPEN(post(), params(tripId, pollId));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ closed: false, counts: { Ramen: 1, Sushi: 0, Tempura: 0 } });
    // And the next vote is taken.
    currentUserId = VIEWER;
    expect((await PUT(put({ optionIds: ["Sushi"] }), params(tripId, pollId))).status).toBe(200);
  });

  it("answers an open poll with a 200 and no change", async () => {
    const { tripId, pollId } = await seed();
    const res = await REOPEN(post(), params(tripId, pollId));
    expect(res.status).toBe(200);
    expect(((await res.json()) as PollResults).closed).toBe(false);
  });

  it("409s a poll whose closing date has passed, and it stays closed", async () => {
    const { tripId, pollId } = await seed({ closesAt: "2000-01-01" });
    await CLOSE(post(), params(tripId, pollId));
    const refused = await REOPEN(post(), params(tripId, pollId));
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { code: string }).code).toBe("poll-date-passed");
    const results = (await (await GET(get(), params(tripId, pollId))).json()) as PollResults;
    expect(results).toMatchObject({ closed: true, datePassed: true });
  });
});
