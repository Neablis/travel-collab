import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { db } from "@/server/db/client";
import { events, pages, tripDetails, tripSummaries } from "@/server/db/schema";
import { executeTripCommand } from "@/server/commands";
import { validateComposedPage } from "@/server/ai/pageTools";

const ACTOR_ID = "user-1";
const OUTSIDER_ID = "user-2";

// Not exported by `ai`'s top-level barrel (it's an `@ai-sdk/provider` type,
// which isn't a direct dependency of this package) — shaped to match
// LanguageModelV4ToolCall exactly, which is all MockLanguageModelV4 needs
// from us. Note `input` (not `args`) and it's a stringified JSON object, same
// as v4's `args` was.
type FunctionToolCall = { type: "tool-call"; toolCallId: string; toolName: string; input: string };

// AI SDK v7's LanguageModelV4Usage requires nested inputTokens/outputTokens
// objects (each field individually optional-typed as `number | undefined`,
// but the object itself is required) instead of v4's flat
// `{ promptTokens, completionTokens }`.
const USAGE = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 10, text: undefined, reasoning: undefined },
};

let currentUserId = ACTOR_ID;

vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
}));

// Import after the mock so the route picks up the mocked `auth`. Only
// `handleAiRequest` is exercised directly (never `POST`, which is the only
// path that could ever construct a real `aiModel()`) — every test here
// injects a `MockLanguageModelV4` so no network call is ever made.
// `handleAiRequest` lives in @/server/ai/handleAiRequest, not the route file
// itself — Next.js's route-type-checking only allows HTTP-method exports
// from app/api/**/route.ts, so it can't be exported from ./route.
const { handleAiRequest } = await import("@/server/ai/handleAiRequest");

function seedTrip() {
  const tripId = randomUUID();
  return executeTripCommand({ type: "CreateTrip", tripId, name: "Rome 2027" }, ACTOR_ID).then((result) => {
    if (!result.ok) throw new Error("failed to seed trip");
    return tripId;
  });
}

function req(tripId: string, body: unknown) {
  return new Request(`http://test/api/trips/${tripId}/ai`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// A MockLanguageModelV4 that emits the given tool calls on its first
// doGenerate invocation, then reports "stop" on any subsequent call. This is
// a fully local fake LanguageModelV4 — generateText calls `doGenerate`
// directly, no network involved. The "stop" tail matters: with `stopWhen:
// isStepCount(N)` for N > 1, the AI SDK loops calling `doGenerate` again
// after a "tool-calls" finish reason (to let a real model react to tool
// results); a fake that always re-emitted the same tool calls would have
// them executed — and, for planning tools, collected/batched — once per
// remaining step.
function modelWithToolCalls(toolCalls: FunctionToolCall[]) {
  let calls = 0;
  return new MockLanguageModelV4({
    doGenerate: async () => {
      calls += 1;
      if (calls > 1) {
        return {
          finishReason: { unified: "stop" as const, raw: undefined },
          usage: USAGE,
          warnings: [],
          content: [],
        };
      }
      return {
        finishReason: { unified: "tool-calls" as const, raw: undefined },
        usage: USAGE,
        warnings: [],
        content: toolCalls,
      };
    },
  });
}

function toolCall(toolName: string, args: Record<string, unknown>): FunctionToolCall {
  return { type: "tool-call", toolCallId: randomUUID(), toolName, input: JSON.stringify(args) };
}

describe("POST /api/trips/:id/ai", () => {
  beforeEach(async () => {
    currentUserId = ACTOR_ID;
    await db.delete(pages);
    await db.delete(tripDetails);
    await db.delete(tripSummaries);
    await db.delete(events);
  });

  it("401s when unauthenticated", async () => {
    const tripId = await seedTrip();
    currentUserId = "";
    const res = await handleAiRequest(
      req(tripId, { prompt: "hi", surface: "page" }),
      tripId,
      modelWithToolCalls([]),
    );
    expect(res.status).toBe(401);
  });

  it("403s for a non-member", async () => {
    const tripId = await seedTrip();
    currentUserId = OUTSIDER_ID;
    const res = await handleAiRequest(
      req(tripId, { prompt: "hi", surface: "page" }),
      tripId,
      modelWithToolCalls([]),
    );
    expect(res.status).toBe(403);
  });

  it("page surface: returns a doc that passes validateComposedPage", async () => {
    const tripId = await seedTrip();
    const model = modelWithToolCalls([
      toolCall("compose_page", {
        title: "Trip Notes",
        blocks: [
          { type: "heading", level: 1, text: "Overview" },
          { type: "paragraph", text: "Some notes." },
          { type: "macro", name: "trip.name" },
        ],
      }),
    ]);
    const res = await handleAiRequest(
      req(tripId, { prompt: "compose a notes page", surface: "page", pageContext: { tripId } }),
      tripId,
      model,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.content.type).toBe("doc");
    const validated = validateComposedPage(body.content);
    expect("error" in validated).toBe(false);
  });

  it("page surface: an unknown macro is rejected, never persisted as a broken node", async () => {
    const tripId = await seedTrip();
    const model = modelWithToolCalls([
      toolCall("compose_page", {
        title: "Trip Notes",
        blocks: [{ type: "macro", name: "not.a.real.macro" }],
      }),
    ]);
    const res = await handleAiRequest(
      req(tripId, { prompt: "compose a notes page", surface: "page", pageContext: { tripId } }),
      tripId,
      model,
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.content).toBeUndefined();
    expect(body.error).toBeDefined();
  });

  it("board surface: a tool call is submitted as exactly one atomic batch", async () => {
    const tripId = await seedTrip();
    const model = modelWithToolCalls([
      toolCall("AddDay", { dayId: randomUUID() }),
      toolCall("AddDay", { dayId: randomUUID() }),
    ]);
    const res = await handleAiRequest(
      req(tripId, { prompt: "add two days", surface: "board" }),
      tripId,
      model,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.detail.days).toHaveLength(2);
    // ADR-013: one batchId → one history entry describing both commands
    // (plus the seed trip's own "Created trip" entry) — proof the two
    // AddDay calls landed as ONE atomic executeTripCommandBatch call, not
    // two separate ones.
    expect(body.history.entries).toHaveLength(2);
    expect(body.history.entries[0].description).toBe("Added Day 1; Added Day 2");
    // A plain-language summary of what was applied, derived from the batch.
    expect(body.message).toBe("Done — added a day and added a day.");
    // Auditing meta: the caller can see the model call actually happened and
    // which tools fired, and resolvedCommands mirrors the applied batch.
    expect(body.meta.model.requested).toBeDefined();
    expect(body.meta.finishReason).toBeDefined();
    expect(body.meta.steps).toBeGreaterThanOrEqual(1);
    expect(body.meta.toolCalls.map((c: { name: string }) => c.name)).toEqual(["AddDay", "AddDay"]);
    expect(body.resolvedCommands).toHaveLength(2);
  });

  it("board surface: the applied summary names the moved activity and its target", async () => {
    const tripId = await seedTrip();
    const dayId = randomUUID();
    const activityId = randomUUID();
    // Seed an on-day activity so the AI's MoveActivity references it BY TITLE —
    // the exact shape of the user's "move Treasure Island …" prompt. The server
    // resolves activityRef/dayRef to real ids (the model never sees a UUID).
    await executeTripCommand({ type: "AddDay", tripId, dayId }, ACTOR_ID);
    await executeTripCommand(
      { type: "AddActivity", tripId, activityId, dayId, title: "Treasure Island" },
      ACTOR_ID,
    );
    const model = modelWithToolCalls([
      toolCall("MoveActivity", { activityRef: "Treasure Island", dayRef: "backlog", position: 0 }),
    ]);
    const res = await handleAiRequest(
      req(tripId, { prompt: "move treasure island to the backlog", surface: "board" }),
      tripId,
      model,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    // Name resolved from the (pre-change) trip detail, not the raw id/args.
    expect(body.message).toBe("Done — moved “Treasure Island” to the backlog.");
    // The audit trail shows the ref→id resolution end to end: the model sent a
    // human title + "backlog" (meta.toolCalls), and the applied command carries
    // the real activityId and a null day (resolvedCommands).
    expect(body.meta.toolCalls[0].input).toMatchObject({ activityRef: "Treasure Island", dayRef: "backlog" });
    expect(body.resolvedCommands[0]).toMatchObject({ type: "MoveActivity", activityId, toDayId: null });
  });

  it("board surface: zero tool calls returns the trip unchanged, with a message explaining nothing applied", async () => {
    const tripId = await seedTrip();
    const model = modelWithToolCalls([]);
    const res = await handleAiRequest(
      req(tripId, { prompt: "what's the weather like", surface: "board" }),
      tripId,
      model,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.detail.days).toHaveLength(0);
    // Not a silent no-op: the user is told why the board didn't change.
    expect(body.message).toMatch(/nothing was applied/i);
    // meta.toolCalls empty confirms the model called nothing (vs. calling
    // tools whose refs all failed to resolve, which would populate it).
    expect(body.meta.toolCalls).toHaveLength(0);
    expect(body.resolvedCommands).toHaveLength(0);
  });

  it("board surface: adds a day and places an activity on it in one batch", async () => {
    const tripId = await seedTrip(); // 0 days
    const model = modelWithToolCalls([
      toolCall("AddDay", {}),
      toolCall("AddActivity", { title: "Lunch at the market", dayRef: "day 1" }),
    ]);
    const res = await handleAiRequest(
      req(tripId, { prompt: "add a day and put lunch on it", surface: "board" }),
      tripId,
      model,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    // The new day exists and carries the activity — proof the AddActivity's
    // "day 1" resolved to the day minted by the AddDay earlier in the SAME batch.
    expect(body.detail.days).toHaveLength(1);
    expect(body.detail.days[0].activityIds).toHaveLength(1);
    const addedId = body.detail.days[0].activityIds[0];
    expect(body.detail.activities[addedId].title).toBe("Lunch at the market");
    // resolvedCommands shows the linkage: AddActivity.dayId === AddDay.dayId.
    const [addDay, addActivity] = body.resolvedCommands;
    expect(addActivity.dayId).toBe(addDay.dayId);
    expect(body.resolutionErrors).toEqual([]);
  });

  it("board surface: a removal and a dependent add apply as one partial batch", async () => {
    const tripId = await seedTrip();
    await executeTripCommand({ type: "AddDay", tripId, dayId: randomUUID() }, ACTOR_ID);
    const keptDayId = randomUUID();
    await executeTripCommand({ type: "AddDay", tripId, dayId: keptDayId }, ACTOR_ID);

    // After RemoveDay(day 1), "day 1" is what was day 2 — the resolver must see
    // the removal. Before the dry-run this either targeted the removed day (and
    // aborted the WHOLE batch on day-not-found) or silently hit the wrong day.
    // The third call is unresolvable on purpose — "day 99" is out of range once
    // RemoveDay has run and left only one day — so this batch is genuinely
    // PARTIAL: two commands apply, one is dropped, and nothing aborts.
    const model = modelWithToolCalls([
      toolCall("RemoveDay", { dayRef: "day 1" }),
      toolCall("AddActivity", { title: "Dinner", dayRef: "day 1" }),
      toolCall("AddActivity", { title: "Ghost", dayRef: "day 99" }),
    ]);
    const res = await handleAiRequest(
      req(tripId, { prompt: "drop the first day and add dinner to the remaining one", surface: "board" }),
      tripId,
      model,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.detail.days).toHaveLength(1);
    expect(body.detail.days[0].dayId).toBe(keptDayId);
    expect(body.detail.days[0].activityIds).toHaveLength(1);
    // The two resolvable commands still apply exactly as before...
    expect(Object.values(body.detail.activities as Record<string, { title: string }>).map((a) => a.title)).toEqual([
      "Dinner",
    ]);
    // ...while the unresolvable third one is reported as a drop, not a silent
    // loss and not an abort of the whole batch (proof of the "partial batch"
    // behavior this test is named for).
    expect(body.resolutionErrors).toHaveLength(1);
    expect(body.resolutionErrors[0]).toMatchObject({ type: "AddActivity", code: "unresolved-ref", index: 2 });
    expect(body.resolutionErrors[0].message).toMatch(/out of range/i);
  });
});
