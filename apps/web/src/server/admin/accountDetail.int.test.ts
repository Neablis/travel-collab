// **The operator's account page** (M36 link 3), against a real database.
//
// Each case plants rows on the account under test, on another account, and on
// both sides of the trailing window, because those are the three ways a
// one-account read goes wrong without looking wrong: someone else's turns, a
// window that leaks, and a day counted twice.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { events, savedNotebooks, tripMemberships, users } from "@/server/db/schema";
import { executeTripCommand } from "@/server/commands";
import { upsertUser } from "@/server/users";
import type { TurnLedger } from "@/server/assistant/ledger";
import { recordTurnLedger } from "@/server/entitlements/usage";
import { issueGrant, revokeGrant } from "@/server/entitlements/grants";
import { livePlanVersion } from "@/server/entitlements/planVersions";
import { adminAccountDetail } from "./accountDetail";

const DAY = 24 * 60 * 60 * 1000;
const now = new Date();
const ago = (ms: number) => new Date(now.getTime() - ms);

async function account(planId: "free" | "plus" | "premium" = "free") {
  const id = `dev-${randomUUID()}`;
  await upsertUser({ id, email: `${id}@example.test`, name: null, image: null });
  await db.update(users).set({ planId, planVersion: 1 }).where(eq(users.id, id));
  return id;
}

/** One turn: `tokensIn` per step, and one tool call per name. */
function turn(
  userId: string,
  options: { taskClass?: "question" | "edit"; outcome?: "completed" | "error"; tokensIn?: number[]; tools?: string[] } = {},
): TurnLedger {
  const tokensIn = options.tokensIn ?? [1000];
  return {
    cost: {
      userId,
      endpoint: "ask",
      outcome: options.outcome ?? "completed",
      taskClass: options.taskClass ?? "question",
      classifierCertainty: null,
      turn: { model: "zai/glm-5.3-flash", tokensIn: 3000, tokensOut: 400 },
      classifier: null,
      steps: tokensIn.length,
      planVersionRef: "plus@v1",
      turnId: null,
      latencyMs: 2400,
    },
    capacity: [],
    toolCalls: (options.tools ?? []).map((name, index) => ({
      callId: `call-${index}`,
      name,
      ms: 10,
      ok: true,
      outcome: "ok",
      stepIndex: 0,
      inputBytes: 20,
      outputBytes: 200,
      reachedProposal: null,
    })),
    stepSpend: tokensIn.map((tokens, index) => ({
      index,
      model: "zai/glm-5.3-flash",
      tier: "cheap",
      tokensIn: tokens,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      tokensOut: 100,
      finishReason: "stop",
      escalated: false,
      pivoted: false,
      durationMs: 800,
      provider: null,
      gatewayGenerationId: null,
    })),
  };
}

/** A trip created by `actorId` through the command path, its events dated `at`. */
async function tripBy(actorId: string, name: string, at: Date = now) {
  const tripId = randomUUID();
  expect((await executeTripCommand({ type: "CreateTrip", tripId, name }, actorId)).ok).toBe(true);
  // Back-dated in place: the command stamps its own clock, and these reads are
  // about WHEN, which only the stored row can be made to say.
  await db.update(events).set({ occurredAt: at.toISOString() }).where(eq(events.streamId, tripId));
  return tripId;
}

const detailOf = async (userId: string) => (await adminAccountDetail(userId, now))!;

describe("the account page reads one account", () => {
  it("answers null for an id that is no account", async () => {
    expect(await adminAccountDetail(`dev-${randomUUID()}`, now)).toBeNull();
  });

  it("never counts another account's turns, edits, trips, notebooks or grants", async () => {
    const quiet = await account("plus");
    const busy = await account("plus");
    await recordTurnLedger(turn(busy, { tools: ["read_trip"] }), ago(DAY));
    await tripBy(busy, "Busy's trip", ago(DAY));
    await issueGrant({ userId: busy, planId: "premium", planVersion: 1, source: "admin", expiresAt: null });
    await db.insert(savedNotebooks).values({
      id: randomUUID(),
      ownerId: busy,
      title: "Busy's notebook",
      content: { v: 1, blocks: [] } as never,
      docVersion: 1,
      sourceTripId: randomUUID(),
      sourceTripName: "Busy's trip",
      sourcePageId: randomUUID(),
      createdAt: now,
    });

    const mine = await detailOf(quiet);
    expect(mine.assistant.questions).toBe(0);
    expect(mine.assistant.topTools).toEqual([]);
    expect(mine.assistant.recent).toEqual([]);
    // The percentiles are their own query; it must be scoped as the turns are.
    expect(mine.assistant.contextMedian).toBeNull();
    expect(mine.assistant.contextP95).toBeNull();
    expect(mine.activity.editsPerDay.every((count) => count === 0)).toBe(true);
    expect(mine.activity.recent).toEqual([]);
    expect(mine.activeDays).toBe(0);
    expect(mine.trips).toEqual({ owned: 0, invitedTo: 0 });
    expect(mine.notebooks).toBe(0);
    expect(mine.plan.grants).toEqual([]);

    // And the busy one sees its own — or the zeros above prove nothing.
    const theirs = await detailOf(busy);
    expect(theirs.assistant.questions).toBe(1);
    expect(theirs.assistant.contextMedian).toBe(1000);
    expect(theirs.trips.owned).toBe(1);
    expect(theirs.notebooks).toBe(1);
    expect(theirs.plan.grants).toHaveLength(1);
  });

  it("leaves turns and edits older than the window out of every 30-day number", async () => {
    const id = await account("plus");
    await recordTurnLedger(turn(id, { tokensIn: [500], tools: ["read_trip"] }), ago(2 * DAY));
    await recordTurnLedger(
      turn(id, { outcome: "error", tokensIn: [90_000, 90_000], tools: ["search_places"] }),
      ago(40 * DAY),
    );
    await tripBy(id, "Recent", ago(2 * DAY));
    await tripBy(id, "Old", ago(45 * DAY));

    const detail = await detailOf(id);
    expect(detail.assistant.questions).toBe(1);
    expect(detail.assistant.steps).toBe(1);
    expect(detail.assistant.failed).toBe(0);
    expect(detail.assistant.contextP95).toBe(500);
    expect(detail.assistant.topTools).toEqual([{ tool: "read_trip", calls: 1 }]);
    expect(detail.assistant.perDay.reduce((a, b) => a + b, 0)).toBe(1);
    expect(detail.activity.editsPerDay.reduce((a, b) => a + b, 0)).toBe(1);
    // The six newest events are not window-bound: they are the last things it did.
    expect(detail.activity.recent.map((event) => event.what)).toEqual(["Created Recent", "Created Old"]);
  });

  it("counts active days as distinct days, across edits and turns", async () => {
    const id = await account("plus");
    // Day A: two edits and a turn. Day B: one turn. Two days, not four.
    await tripBy(id, "One", ago(3 * DAY + 60_000));
    await tripBy(id, "Two", ago(3 * DAY + 120_000));
    await recordTurnLedger(turn(id), ago(3 * DAY + 180_000));
    await recordTurnLedger(turn(id), ago(DAY + 60_000));

    const detail = await detailOf(id);
    expect(detail.activeDays).toBe(2);
    expect(detail.activity.editsPerDay[detail.windowDays - 4]).toBe(2);
    expect(detail.assistant.perDay[detail.windowDays - 2]).toBe(1);
  });

  it("counts owned trips and invited trips apart", async () => {
    const id = await account("plus");
    const host = await account("premium");
    await tripBy(id, "Mine");
    const theirs = await tripBy(host, "Theirs");
    await db.insert(tripMemberships).values({
      tripId: theirs,
      userId: id,
      role: "editor",
      invitedBy: host,
      createdAt: now.toISOString(),
    });
    // Someone else invited to a different trip of the host's: not this account's.
    const stranger = await account("plus");
    await db.insert(tripMemberships).values({
      tripId: await tripBy(host, "Elsewhere"),
      userId: stranger,
      role: "editor",
      invitedBy: host,
      createdAt: now.toISOString(),
    });
    expect((await detailOf(id)).trips).toEqual({ owned: 1, invitedTo: 1 });
    expect((await detailOf(host)).trips).toEqual({ owned: 2, invitedTo: 0 });
  });

  it("keeps a revoked grant in the history and off the active cards", async () => {
    const id = await account();
    const operator = await account();
    const plus = livePlanVersion("plus");
    await issueGrant({
      userId: id,
      planId: plus.planId,
      planVersion: plus.version,
      source: "admin",
      grantedBy: operator,
      expiresAt: null,
    });
    const [grant] = (await detailOf(id)).plan.grants;
    expect(grant!.active).toBe(true);
    expect(await revokeGrant(grant!.id, operator)).toBe(true);

    const detail = await detailOf(id);
    expect(detail.plan.grants).toHaveLength(1);
    expect(detail.plan.grants[0]!.active).toBe(false);
    expect(detail.plan.grants[0]!.revokedBy).toBe(`${operator}@example.test`);
    expect(detail.plan.grants.filter((record) => record.active)).toEqual([]);
    expect(detail.plan.history.map((moment) => moment.what)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^Revoked the admin grant of plus v\d+ by /),
        expect.stringMatching(/^Granted plus v\d+ — admin by /),
        "Signed up",
      ]),
    );
    expect(detail.plan.history.at(-1)!.what).toBe("Signed up");
  });

  // ADR-045 rule 4: decided from the resolver's set, so a grant offers it.
  it("offers the assistant from live entitlements, not the plan id", async () => {
    const id = await account();
    expect((await detailOf(id)).assistant.offered).toBe(false);
    const plus = livePlanVersion("plus");
    await issueGrant({ userId: id, planId: plus.planId, planVersion: plus.version, source: "trial", expiresAt: null });
    const detail = await detailOf(id);
    expect(detail.assistant.offered).toBe(true);
    expect(detail.assistant.requestsPerDay).toBe(plus.ceilings.perUserRequestsPerDay);
    expect(detail.plan.fallsBackTo).toBe("free@v1");
  });
});

// **D7: counts and sizes, never the question or the trip.** The ledger has no
// column a sentence could be in; this pins that the page's read did not grow a
// field for one either. Exact key lists, so a new field fails here and has to
// be argued for.
describe("the assistant section carries no question or answer", () => {
  it("returns exactly the counting fields, at every level", async () => {
    const id = await account("plus");
    await recordTurnLedger(turn(id, { taskClass: "edit", tokensIn: [4000, 26_000], tools: ["AddActivity", "read_trip"] }), ago(DAY));

    const { assistant } = await detailOf(id);
    expect(Object.keys(assistant).sort()).toEqual(
      [
        "offered",
        "requestsPerDay",
        "questions",
        "steps",
        "medianToolCalls",
        "contextMedian",
        "contextP95",
        "failed",
        "perDay",
        "topTools",
        "recent",
      ].sort(),
    );
    expect(assistant.recent).toHaveLength(1);
    expect(Object.keys(assistant.recent[0]!).sort()).toEqual(
      ["at", "kind", "model", "steps", "toolCalls", "peakContext", "latencyMs", "outcome"].sort(),
    );
    expect(Object.keys(assistant.topTools[0]!).sort()).toEqual(["calls", "tool"]);
    expect(assistant.recent[0]).toMatchObject({
      kind: "change",
      outcome: "proposed",
      steps: 2,
      toolCalls: 2,
      peakContext: 26_000,
      latencyMs: 2400,
    });
    expect(assistant.medianToolCalls).toBe(2);
  });
});
