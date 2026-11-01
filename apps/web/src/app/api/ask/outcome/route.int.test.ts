// POST /api/ask/outcome (M57 part 3): the row a press writes, whose turn it
// may name, and the limit on how often.
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db/client";
import { aiTurnOutcomes, aiUsage, rateLimitCounters } from "@/server/db/schema";
import { CLIENT_OUTCOME_KINDS } from "@/lib/turnOutcomeKinds";

const ASKER = "outcome-asker";
const OTHER = "outcome-other";

let currentUserId: string | null = ASKER;

vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
}));

const { POST } = await import("./route");

async function seedTurn(userId: string): Promise<string> {
  const id = randomUUID();
  await db.insert(aiUsage).values({
    id,
    userId,
    endpoint: "ask",
    outcome: "completed",
    taskClass: "plan",
    turnModel: "test/model",
    steps: 1,
    createdAt: new Date(),
  });
  return id;
}

function post(body: unknown): Request {
  return new Request("http://test/api/ask/outcome", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const rowsOf = (turnId: string) => db.select().from(aiTurnOutcomes).where(eq(aiTurnOutcomes.turnId, turnId));

beforeEach(async () => {
  currentUserId = ASKER;
  await db.delete(rateLimitCounters);
});

afterEach(() => {
  delete process.env.TURN_OUTCOME_RATE_LIMIT_PER_USER_MINUTE;
});

describe("POST /api/ask/outcome", () => {
  it.each(CLIENT_OUTCOME_KINDS)("writes one %s row against the turn, by the person who pressed", async (kind) => {
    const turnId = await seedTurn(ASKER);
    const res = await POST(post({ turnId, kind }));
    expect(res.status).toBe(204);
    expect(await rowsOf(turnId)).toMatchObject([{ turnId, kind, actor: ASKER }]);
  });

  it("is not told apart: another account's turn answers like one that does not exist, and writes nothing", async () => {
    const theirs = await seedTurn(OTHER);
    const refused = await POST(post({ turnId: theirs, kind: "hand_off_pressed" }));
    const missing = await POST(post({ turnId: randomUUID(), kind: "hand_off_pressed" }));
    expect([refused.status, missing.status]).toEqual([404, 404]);
    expect(await rowsOf(theirs)).toEqual([]);
  });

  it("refuses a kind only the server may write, and a signed-out caller", async () => {
    const turnId = await seedTurn(ASKER);
    expect((await POST(post({ turnId, kind: "proposal_applied" }))).status).toBe(400);
    currentUserId = null;
    expect((await POST(post({ turnId, kind: "hand_off_pressed" }))).status).toBe(401);
    expect(await rowsOf(turnId)).toEqual([]);
  });

  it("is rate limited per person: the press past the ceiling is a 429 and writes nothing", async () => {
    process.env.TURN_OUTCOME_RATE_LIMIT_PER_USER_MINUTE = "2";
    const turnId = await seedTurn(ASKER);
    const statuses: number[] = [];
    for (let i = 0; i < 3; i += 1) statuses.push((await POST(post({ turnId, kind: "carried_ask_pressed" }))).status);
    expect(statuses).toEqual([204, 204, 429]);
    expect(await rowsOf(turnId)).toHaveLength(2);
  });
});
