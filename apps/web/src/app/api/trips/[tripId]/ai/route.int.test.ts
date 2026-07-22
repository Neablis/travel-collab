import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockLanguageModelV1 } from "ai/test";
import { db } from "@/server/db/client";
import { events, pages, tripDetails, tripSummaries } from "@/server/db/schema";
import { executeTripCommand } from "@/server/commands";
import { validateComposedPage } from "@/server/ai/pageTools";

const ACTOR_ID = "user-1";
const OUTSIDER_ID = "user-2";

// Not exported by `ai`'s top-level barrel (it's an `@ai-sdk/provider` type,
// which isn't a direct dependency of this package) — shaped to match
// LanguageModelV1FunctionToolCall exactly, which is all MockLanguageModelV1
// needs from us.
type FunctionToolCall = { toolCallType: "function"; toolCallId: string; toolName: string; args: string };

let currentUserId = ACTOR_ID;

vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
}));

// Import after the mock so the route picks up the mocked `auth`. Only
// `handleAiRequest` is exercised directly (never `POST`, which is the only
// path that could ever construct a real `aiModel()`) — every test here
// injects a `MockLanguageModelV1` so no network call is ever made.
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

// A MockLanguageModelV1 that emits the given tool calls on its first
// doGenerate invocation, then reports "stop" on any subsequent call. This is
// a fully local fake LanguageModelV1 — generateText calls `doGenerate`
// directly, no network involved. The "stop" tail matters: with `maxSteps` > 1
// the AI SDK loops calling `doGenerate` again after a "tool-calls" finish
// reason (to let a real model react to tool results); a fake that always
// re-emitted the same tool calls would have them executed — and, for
// planning tools, collected/batched — once per remaining step.
function modelWithToolCalls(toolCalls: FunctionToolCall[]) {
  let calls = 0;
  return new MockLanguageModelV1({
    doGenerate: async () => {
      calls += 1;
      if (calls > 1) {
        return {
          rawCall: { rawPrompt: null, rawSettings: {} },
          finishReason: "stop",
          usage: { promptTokens: 10, completionTokens: 10 },
        };
      }
      return {
        rawCall: { rawPrompt: null, rawSettings: {} },
        finishReason: "tool-calls",
        usage: { promptTokens: 10, completionTokens: 10 },
        toolCalls,
      };
    },
  });
}

function toolCall(toolName: string, args: Record<string, unknown>): FunctionToolCall {
  return { toolCallType: "function", toolCallId: randomUUID(), toolName, args: JSON.stringify(args) };
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
  });

  it("board surface: zero tool calls returns the trip unchanged (no empty batch submitted)", async () => {
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
  });
});
