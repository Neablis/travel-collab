import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeTripCommand } from "@/server/commands";
import { db } from "@/server/db/client";
import { rateLimitCounters, tripMemberships } from "@/server/db/schema";
import { simulatedModel } from "@/server/ai/simulatedModel";
import { DEMO_TRIP_ID } from "@/lib/demoTrip";
import type { AskAnalyticsRecord } from "@/server/ai/askAnalytics";

const ACTOR_ID = "ask-owner";
const VIEWER_ID = "ask-viewer";
const OUTSIDER_ID = "ask-outsider";

let currentUserId = ACTOR_ID;

vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
}));

// The `denied` outcome has no production trigger yet — there is no account tier
// anywhere in the product (ADR-019 amendment §3) — so the only way to exercise
// the branch, which M16's gate requires, is to make `selectAiModel` return it.
// Everything else delegates to the real implementation, so the simulated path
// below is still the real one.
let denyNextSelection = false;
vi.mock("@/server/ai/modelSelection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/ai/modelSelection")>();
  return {
    ...actual,
    selectAiModel: vi.fn(async (actor: Parameters<typeof actual.selectAiModel>[0]) =>
      denyNextSelection
        ? { outcome: "denied" as const, reason: "AI is not available for this account." }
        : actual.selectAiModel(actor),
    ),
  };
});

// Imported after the mocks so the handler picks them up. Only
// `handleAskRequest` is exercised directly, never `POST` — which is the one
// path that could construct a real gateway model.
const { handleAskRequest, ASK_MINIMUM_ROLE, DEMO_TRIP_UNSUPPORTED_CODE, minimumRoleFor } = await import(
  "@/server/ai/handleAskRequest"
);
const { READ_TOOL_NAMES } = await import("@/server/ai/readTools");

/** A three-day trip with real time windows, so a free-time answer has something to find. */
async function seedTrip(): Promise<string> {
  const tripId = randomUUID();
  const create = await executeTripCommand({ type: "CreateTrip", tripId, name: "Kyoto 2027" }, ACTOR_ID);
  if (!create.ok) throw new Error("failed to seed trip");
  // SetTripDates over SetTripStartDate: it sets the range AND matches the day
  // count to it, so three dated days exist in one command. `newDayIds` are the
  // mint ids for the days the range adds — the server never invents a UUID.
  const dated = await executeTripCommand(
    {
      type: "SetTripDates",
      tripId,
      startDate: "2027-04-01",
      endDate: "2027-04-03",
      newDayIds: [randomUUID(), randomUUID(), randomUUID()],
    },
    ACTOR_ID,
  );
  if (!dated.ok) throw new Error("failed to date trip");
  const firstDay = dated.detail.days[0]!.dayId;
  await executeTripCommand(
    {
      type: "AddActivity",
      tripId,
      activityId: randomUUID(),
      dayId: firstDay,
      title: "Fushimi Inari",
      timeWindow: { start: "09:00", end: "11:00" },
      cost: { amountMinor: 1200, currency: "USD" },
    },
    ACTOR_ID,
  );
  await executeTripCommand(
    {
      type: "AddActivity",
      tripId,
      activityId: randomUUID(),
      dayId: firstDay,
      title: "Nishiki Market",
      timeWindow: { start: "13:00", end: "14:30" },
    },
    ACTOR_ID,
  );
  return tripId;
}

async function grantViewer(tripId: string, userId: string) {
  await db.insert(tripMemberships).values({
    tripId,
    userId,
    role: "viewer",
    invitedBy: ACTOR_ID,
    createdAt: new Date().toISOString(),
  });
}

function userMessage(text: string, id = "m1") {
  return { id, role: "user", parts: [{ type: "text", text }] };
}

function req(tripId: string, body: unknown, signal?: AbortSignal) {
  return new Request(`http://test/api/trips/${tripId}/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}

// A model that fails the way a provider outage does: the stream opens and then
// errors. Typed structurally for the same reason simulatedModel is — the
// LanguageModelV4 interface lives in a package apps/web does not depend on.
function failingModel(message: string) {
  return {
    specificationVersion: "v4",
    provider: "test",
    modelId: "test/failing",
    supportedUrls: {},
    doGenerate: async () => {
      throw new Error(message);
    },
    doStream: async () => {
      throw new Error(message);
    },
  } as unknown as Parameters<typeof handleAskRequest>[2];
}

/** The SSE body as the chunks a browser client parses out of it. */
async function chunksOf(res: Response): Promise<Record<string, unknown>[]> {
  const body = await res.text();
  return body
    .split("\n")
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map((line) => JSON.parse(line.slice("data: ".length)) as Record<string, unknown>);
}

function textOf(chunks: Record<string, unknown>[]): string {
  return chunks
    .filter((chunk) => chunk.type === "text-delta")
    .map((chunk) => chunk.delta as string)
    .join("");
}

// The analytics sink defaults to a silent one here so `pnpm test:int` is not
// buried in per-turn log lines. One test below omits it deliberately, which is
// what covers the real console default.
async function ask(tripId: string, body: unknown, sink: (r: AskAnalyticsRecord) => void = () => {}) {
  return handleAskRequest(req(tripId, body), tripId, simulatedModel("ask"), sink);
}

// Same rule as the /ai suite: every test seeds its own randomUUID() trip, so no
// truncation is needed — except `rate_limit_counters`, which is keyed by ACTOR
// and is therefore genuinely shared state between these tests.
describe("POST /api/trips/:id/ask", () => {
  beforeEach(async () => {
    currentUserId = ACTOR_ID;
    denyNextSelection = false;
    await db.delete(rateLimitCounters);
  });

  describe("access", () => {
    it("401s when unauthenticated", async () => {
      const tripId = await seedTrip();
      currentUserId = "";
      const res = await ask(tripId, { messages: [userMessage("how long is this trip?")], scope: { kind: "trip" } });
      expect(res.status).toBe(401);
    });

    it("403s for a non-member", async () => {
      const tripId = await seedTrip();
      currentUserId = OUTSIDER_ID;
      const res = await ask(tripId, { messages: [userMessage("how long is this trip?")], scope: { kind: "trip" } });
      expect(res.status).toBe(403);
    });

    // The deliberate difference from /ai, which is editor-gated: a viewer may
    // ASK about a trip they can already see. This is only safe while the tool
    // set is read-only, which is why the guard is computed from it.
    it("lets a viewer ask, where /ai would refuse them", async () => {
      const tripId = await seedTrip();
      await grantViewer(tripId, VIEWER_ID);
      currentUserId = VIEWER_ID;
      const res = await ask(tripId, { messages: [userMessage("how long is this trip?")], scope: { kind: "trip" } });
      expect(res.status).toBe(200);
      expect(textOf(await chunksOf(res))).toContain("Kyoto 2027 runs to 3 days");
    });

    it("offers a viewer the read tool set and nothing else", async () => {
      const tripId = await seedTrip();
      await grantViewer(tripId, VIEWER_ID);
      currentUserId = VIEWER_ID;
      const records: AskAnalyticsRecord[] = [];
      const res = await ask(tripId, { messages: [userMessage("what's on day 1?")], scope: { kind: "trip" } }, (r) =>
        records.push(r),
      );
      // The record is written when the run ends, which for a streamed response
      // means once the stream has been drained.
      await res.text();
      expect(records[0]!.offeredTools.sort()).toEqual([...READ_TOOL_NAMES].sort());
    });

    // `requireTripAccess` answers the demo trip as a viewer with NO session, so
    // this endpoint's (correct) viewer minimum would otherwise have made /ask
    // an unauthenticated LLM proxy the moment `ai-live` is switched on. See
    // KI-79 for what would have to be decided to open it up.
    it("403s the demo trip, signed in or not", async () => {
      currentUserId = "";
      const anonymous = await ask(DEMO_TRIP_ID, {
        messages: [userMessage("what is this trip?")],
        scope: { kind: "trip" },
      });
      expect(anonymous.status).toBe(403);
      expect(await anonymous.json()).toEqual({
        error: "The assistant isn't available on the demo trip.",
        code: DEMO_TRIP_UNSUPPORTED_CODE,
      });

      currentUserId = ACTOR_ID;
      const signedIn = await ask(DEMO_TRIP_ID, {
        messages: [userMessage("what is this trip?")],
        scope: { kind: "trip" },
      });
      expect(signedIn.status).toBe(403);
    });

    // Refused BEFORE the quota, so anonymous traffic cannot burn the shared
    // `demo-visitor` bucket — and before anything that would put a write on a
    // path `demoTrip.ts` keeps free of the database.
    it("charges nothing and writes nothing for a demo-trip ask", async () => {
      currentUserId = "";
      await ask(DEMO_TRIP_ID, { messages: [userMessage("hi")], scope: { kind: "trip" } });
      expect(await db.select().from(rateLimitCounters)).toHaveLength(0);
    });

    // The rule, not the current answer: a write tool joining the set moves the
    // guard to editor without anyone editing the guard.
    it("computes the guard from the tool set", () => {
      expect(ASK_MINIMUM_ROLE).toBe("viewer");
      expect(minimumRoleFor(READ_TOOL_NAMES)).toBe("viewer");
      expect(minimumRoleFor([...READ_TOOL_NAMES, "AddActivity"])).toBe("editor");
    });
  });

  describe("the caps", () => {
    it("400s a message over 4,000 characters, naming the rule", async () => {
      const tripId = await seedTrip();
      const res = await ask(tripId, {
        messages: [userMessage("x".repeat(4001))],
        scope: { kind: "trip" },
      });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toContain("4000 characters or fewer");
    });

    it("accepts a message of exactly 4,000 characters", async () => {
      const tripId = await seedTrip();
      const res = await ask(tripId, { messages: [userMessage("x".repeat(4000))], scope: { kind: "trip" } });
      expect(res.status).toBe(200);
    });

    it("400s a thread over 40 messages", async () => {
      const tripId = await seedTrip();
      const messages = Array.from({ length: 41 }, (_, i) => userMessage(`turn ${i}`, `m${i}`));
      const res = await ask(tripId, { messages, scope: { kind: "trip" } });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toContain("at most 40 messages");
    });

    it("400s a body over 128 KB", async () => {
      const tripId = await seedTrip();
      // Under the per-message and per-thread caps, over the byte ceiling: 40
      // messages of 3,500 characters is ~137 KB. Without this cap the other two
      // would have let it through.
      const messages = Array.from({ length: 40 }, (_, i) => userMessage("y".repeat(3500), `m${i}`));
      const res = await ask(tripId, { messages, scope: { kind: "trip" } });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toContain("131072 bytes or fewer");
    });

    it("400s an empty thread and a thread with no question in it", async () => {
      const tripId = await seedTrip();
      expect((await ask(tripId, { messages: [], scope: { kind: "trip" } })).status).toBe(400);
      const noQuestion = await ask(tripId, {
        messages: [{ id: "a1", role: "assistant", parts: [{ type: "text", text: "hello" }] }],
        scope: { kind: "trip" },
      });
      expect(noQuestion.status).toBe(400);
    });

    // The caps schema deliberately models only what it enforces; the full
    // UIMessage part union is `validateUIMessages`' job. A part shape that
    // gets past the first and fails the second must still be a 400 — the body
    // is what is wrong, not the server.
    it("400s a part shape the SDK's own validation rejects", async () => {
      const tripId = await seedTrip();
      const res = await ask(tripId, {
        messages: [{ id: "m1", role: "user", parts: [{ type: "text" }] }],
        scope: { kind: "trip" },
      });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toContain("malformed thread");
    });

    it("400s a missing or unknown scope", async () => {
      const tripId = await seedTrip();
      expect((await ask(tripId, { messages: [userMessage("hi")] })).status).toBe(400);
      expect((await ask(tripId, { messages: [userMessage("hi")], scope: { kind: "week" } })).status).toBe(400);
    });

    // Answering an out-of-range day scope "about the whole trip" would silently
    // widen a narrowing the caller asked for.
    it("400s a day scope past the end of the trip", async () => {
      const tripId = await seedTrip();
      const res = await ask(tripId, { messages: [userMessage("what's on?")], scope: { kind: "day", dayIndex: 9 } });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toContain("day 10 is out of range");
    });

    it("charges nothing for a request rejected before validation passes", async () => {
      const tripId = await seedTrip();
      await ask(tripId, { messages: [userMessage("x".repeat(4001))], scope: { kind: "trip" } });
      expect(await db.select().from(rateLimitCounters)).toHaveLength(0);
    });
  });

  describe("spend gates", () => {
    it("429s once the actor is over their hourly ceiling", async () => {
      vi.stubEnv("AI_RATE_LIMIT_PER_USER_HOURLY", "1");
      try {
        const tripId = await seedTrip();
        const first = await ask(tripId, { messages: [userMessage("one")], scope: { kind: "trip" } });
        expect(first.status).toBe(200);
        await first.text();
        const second = await ask(tripId, { messages: [userMessage("two")], scope: { kind: "trip" } });
        expect(second.status).toBe(429);
        expect(second.headers.get("Retry-After")).toBeTruthy();
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it("403s with ai-not-entitled when selection denies the actor", async () => {
      const tripId = await seedTrip();
      denyNextSelection = true;
      // No injected model: `denied` is a decision selectAiModel makes, so the
      // handler has to be on the path that asks it.
      const res = await handleAskRequest(
        req(tripId, { messages: [userMessage("how long is this trip?")], scope: { kind: "trip" } }),
        tripId,
      );
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "AI is not available for this account.", code: "ai-not-entitled" });
      // A refused actor is never charged: selection comes first.
      expect(await db.select().from(rateLimitCounters)).toHaveLength(0);
    });

    // The kill switch's promise, as a test: with AI off the endpoint answers on
    // a deployment carrying no AI_GATEWAY_API_KEY at all. The only test here
    // that omits the model, so the only one on the real selectAiModel path.
    it("answers with no model injected and no gateway key set", async () => {
      const tripId = await seedTrip();
      const priorLive = process.env.AI_LIVE;
      const priorKey = process.env.AI_GATEWAY_API_KEY;
      process.env.AI_LIVE = "false";
      delete process.env.AI_GATEWAY_API_KEY;
      try {
        const res = await handleAskRequest(
          req(tripId, { messages: [userMessage("how long is this trip?")], scope: { kind: "trip" } }),
          tripId,
        );
        expect(res.status).toBe(200);
        expect(textOf(await chunksOf(res))).toContain("AI is switched off on this deployment");
      } finally {
        if (priorLive === undefined) delete process.env.AI_LIVE;
        else process.env.AI_LIVE = priorLive;
        if (priorKey !== undefined) process.env.AI_GATEWAY_API_KEY = priorKey;
      }
    });
  });

  describe("a full simulated turn", () => {
    it("streams a UI message stream a browser client can consume", async () => {
      const tripId = await seedTrip();
      const res = await ask(tripId, {
        messages: [userMessage("how does this trip look?")],
        scope: { kind: "trip" },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/event-stream");
      expect(res.headers.get("x-vercel-ai-ui-message-stream")).toBe("v1");

      const chunks = await chunksOf(res);
      expect(chunks[0]).toEqual({ type: "start" });
      expect(chunks.at(-1)).toMatchObject({ type: "finish" });
      expect(chunks.map((c) => c.type)).toContain("start-step");
      expect(chunks.map((c) => c.type)).toContain("text-delta");
    });

    it("calls the read tools and answers in prose from what they returned", async () => {
      const tripId = await seedTrip();
      const chunks = await chunksOf(
        await ask(tripId, { messages: [userMessage("how does this trip look?")], scope: { kind: "trip" } }),
      );

      const called = chunks.filter((c) => c.type === "tool-input-available").map((c) => c.toolName);
      expect(called).toEqual(["read_trip", "find_free_time"]);
      // The tool outputs reach the client too, which is what lets the rail show
      // its work rather than only its conclusion.
      expect(chunks.filter((c) => c.type === "tool-output-available")).toHaveLength(2);

      const answer = textOf(chunks);
      expect(answer).toContain("Kyoto 2027 runs to 3 days, starting 2027-04-01.");
      expect(answer).toContain("There are 2 stops scheduled across it.");
      expect(answer).toContain("The biggest open stretch between 08:00 and 22:00 is on day");
      expect(answer).toContain("AI is switched off on this deployment");
    });

    it("reads the scoped day, and names no other day, when the turn is day-scoped", async () => {
      const tripId = await seedTrip();
      const chunks = await chunksOf(
        await ask(tripId, { messages: [userMessage("what's on this day?")], scope: { kind: "day", dayIndex: 0 } }),
      );

      expect(chunks.filter((c) => c.type === "tool-input-available").map((c) => c.toolName)).toEqual([
        "read_trip",
        "read_day",
        "find_free_time",
      ]);
      const answer = textOf(chunks);
      expect(answer).toContain("Day 1 (2027-04-01) of Kyoto 2027 has 2 stops.");
      expect(answer).toContain("Fushimi Inari at 09:00");
      expect(answer).toContain("Nishiki Market at 13:00");
      expect(answer).not.toMatch(/day 2|day 3/i);
    });

    // The thread is client-held (Ruling R1), so turn 2 arrives carrying turn 1's
    // ASSISTANT message — tool parts and all. `convertToModelMessages` turns
    // those back into tool-result messages, so a server that decided "have I
    // called my tools yet?" by scanning the whole prompt would see turn 1's
    // readouts on turn 2's FIRST step and answer from them: no tool call at
    // all, the wrong day after a scope change, stale data after an edit.
    //
    // The server must not be hostage to the client choosing not to resend
    // them — Task 5 writes that client.
    it("calls its tools again on turn 2, even when turn 1's tool parts are resent", async () => {
      const tripId = await seedTrip();
      const chunks = await chunksOf(
        await ask(tripId, {
          messages: [
            userMessage("how does this trip look?", "m1"),
            {
              id: "m2",
              role: "assistant",
              parts: [
                {
                  type: "tool-read_trip",
                  toolCallId: "call-1",
                  state: "output-available",
                  input: {},
                  output: { name: "STALE", currency: "USD", startDate: null, dayCount: 99, tripCostTotal: 0, days: [], conflicts: [] },
                },
                { type: "text", text: "Kyoto 2027 runs to 3 days." },
              ],
            },
            userMessage("and what's on day 2?", "m3"),
          ],
          scope: { kind: "day", dayIndex: 1 },
        }),
      );

      // Fresh reads, not an answer assembled from the resent readout.
      expect(chunks.filter((c) => c.type === "tool-input-available").map((c) => c.toolName)).toEqual([
        "read_trip",
        "read_day",
        "find_free_time",
      ]);
      const answer = textOf(chunks);
      expect(answer).toContain("Day 2 (2027-04-02) of Kyoto 2027");
      expect(answer).not.toContain("STALE");
    });

    // Multi-turn: the thread is client-held (Ruling R1, no migration in this
    // plan), so a second turn arrives as a longer `messages` array and must be
    // answered the same way.
    it("answers a multi-turn thread", async () => {
      const tripId = await seedTrip();
      const res = await ask(tripId, {
        messages: [
          userMessage("how long is this trip?", "m1"),
          { id: "m2", role: "assistant", parts: [{ type: "text", text: "Three days." }] },
          userMessage("and where is the free time?", "m3"),
        ],
        scope: { kind: "trip" },
      });
      expect(res.status).toBe(200);
      expect(textOf(await chunksOf(res))).toContain("The biggest open stretch");
    });
  });

  // The two turns most worth measuring are the failed one and the abandoned
  // one, and neither reaches `onEnd`. Before this they wrote nothing at all.
  describe("turns that do not finish", () => {
    it("records a failed turn, and tells the client what actually broke", async () => {
      const tripId = await seedTrip();
      const records: AskAnalyticsRecord[] = [];
      const res = await handleAskRequest(
        req(tripId, { messages: [userMessage("how does this look?")], scope: { kind: "trip" } }),
        tripId,
        failingModel("provider exploded"),
        (r) => records.push(r),
      );

      // The stream opens before the model is reached, so a mid-turn failure is
      // an error CHUNK, not a non-200 — see the report's stream section.
      expect(res.status).toBe(200);
      const chunks = await chunksOf(res);
      const error = chunks.find((c) => c.type === "error");
      expect(error).toBeDefined();
      // Not the SDK's default "An error occurred.", which is indistinguishable
      // from a network failure in the rail.
      expect(JSON.stringify(error)).toContain("provider exploded");

      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ finishReason: "error", answered: false, toolCallCount: 0 });
    });

    it("records an abandoned turn", async () => {
      const tripId = await seedTrip();
      const records: AskAnalyticsRecord[] = [];
      const controller = new AbortController();
      controller.abort();

      const res = await handleAskRequest(
        req(tripId, { messages: [userMessage("how does this look?")], scope: { kind: "trip" } }, controller.signal),
        tripId,
        simulatedModel("ask"),
        (r) => records.push(r),
      );
      await res.text().catch(() => "");

      expect(records).toHaveLength(1);
      expect(records[0]!.finishReason).toBe("abort");
    });
  });

  describe("the per-ask analytics record", () => {
    it("records the tools called, the count, and which were never called", async () => {
      const tripId = await seedTrip();
      const records: AskAnalyticsRecord[] = [];
      const res = await ask(
        tripId,
        { messages: [userMessage("how does this trip look?")], scope: { kind: "trip" } },
        (r) => records.push(r),
      );
      // The record is written when the run ends, which for a streamed response
      // is when the stream is drained.
      await res.text();

      expect(records).toHaveLength(1);
      const record = records[0]!;
      expect(record).toMatchObject({
        event: "ai.ask",
        tripId,
        userId: ACTOR_ID,
        scope: { kind: "trip" },
        simulated: true,
        model: "simulated/no-op",
        steps: 2,
        toolCallCount: 2,
        answered: true,
        finishReason: "stop",
      });
      expect(record.toolCalls.map((c) => c.name)).toEqual(["read_trip", "find_free_time"]);
      expect(record.toolCalls[1]!.input).toEqual({ after: "08:00", before: "22:00" });
      // Measured, not inferred — the whole point of the number.
      expect(record.uncalledTools).toEqual(["read_day"]);
      expect(record.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it("records an empty uncalled list on a day-scoped turn, which uses all three", async () => {
      const tripId = await seedTrip();
      const records: AskAnalyticsRecord[] = [];
      const res = await ask(
        tripId,
        { messages: [userMessage("what's on this day?")], scope: { kind: "day", dayIndex: 1 } },
        (r) => records.push(r),
      );
      await res.text();
      expect(records[0]!.scope).toEqual({ kind: "day", dayIndex: 1 });
      expect(records[0]!.uncalledTools).toEqual([]);
    });
  });
});
