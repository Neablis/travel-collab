// The account assistant's door (M45): POST /api/ask. What only this lane can
// show is the whole path over real trips — the session, the one admission
// pipeline with no trip, the trips port reading what the asker can open and
// who is travelling, the cross-trip tools, and the ledger row under its own
// endpoint. The arithmetic is the domain's and is tested there.
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { executeTripCommand } from "@/server/commands";
import { db } from "@/server/db/client";
import { aiUsage, rateLimitCounters } from "@/server/db/schema";
import { writeTravelling } from "@/server/access/members";
import { simulatedModel } from "@/server/ai/simulatedModel";
import { askIntentVerdictText, isAskIntentCall } from "@/server/ai/askIntent";
import type { AskAnalyticsRecord } from "@/server/assistant/askAnalytics";
import type { TurnLedger } from "@/server/assistant/ledger";

// Their own account, so no other suite's trips are theirs.
const ASKER = "account-asker";

let currentUserId: string | null = ASKER;

vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
}));

const { handleAccountAskRequest } = await import("@/server/ai/handleAskRequest");
const { POST } = await import("./route");
const { upsertUser } = await import("@/server/users");

/** A dated trip of `ASKER`'s with one located stop per city given, one day each. */
async function seedTrip(name: string, cities: readonly [city: string, countryCode: string][]): Promise<string> {
  const tripId = randomUUID();
  const created = await executeTripCommand({ type: "CreateTrip", tripId, name }, ASKER);
  if (!created.ok) throw new Error(`seed: ${created.error.message}`);
  const dayIds = cities.map(() => randomUUID());
  const dated = await executeTripCommand(
    { type: "SetTripDates", tripId, startDate: "2027-04-01", endDate: `2027-04-0${cities.length}`, newDayIds: dayIds },
    ASKER,
  );
  if (!dated.ok) throw new Error(`seed: ${dated.error.message}`);
  for (const [index, [city, countryCode]] of cities.entries()) {
    const added = await executeTripCommand(
      {
        type: "AddActivity",
        tripId,
        activityId: randomUUID(),
        dayId: dated.detail.days[index]!.dayId,
        title: `${city} walk`,
        location: { name: `${city} centre`, city, countryCode, lat: 35, lng: 135 },
      },
      ASKER,
    );
    if (!added.ok) throw new Error(`seed: ${added.error.message}`);
  }
  return tripId;
}

function ask(text: string, scope: unknown = { kind: "account" }): Request {
  return new Request("http://test/api/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ id: "m1", role: "user", parts: [{ type: "text", text }] }], scope }),
  });
}

function spokenIn(body: string): string {
  return body
    .split("\n")
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map((line) => JSON.parse(line.slice("data: ".length)) as { type?: string; delta?: string })
    .filter((chunk) => chunk.type === "text-delta")
    .map((chunk) => chunk.delta)
    .join("");
}

/**
 * A model that answers the classifier with `question` and then plays `steps`
 * in order, each the parts one step emits: a string is text, anything else a
 * provider part as given (a tool call, or reasoning).
 */
function scriptedStepsModel(steps: (string | Record<string, unknown>)[][]) {
  let next = 0;
  const usage = {
    inputTokens: { total: 0, noCache: 0, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: 0, text: undefined, reasoning: undefined },
  };
  const isClassifier = (options: { prompt?: { role?: string; content?: unknown }[] }) =>
    isAskIntentCall((options.prompt ?? []).map((m) => (m.role === "system" && typeof m.content === "string" ? m.content : "")).join("\n"));
  return {
    specificationVersion: "v4",
    provider: "test",
    modelId: "test/scripted-steps",
    supportedUrls: {},
    doGenerate: async () => ({
      content: [{ type: "text", text: askIntentVerdictText("question", "sure") }],
      finishReason: { unified: "stop", raw: undefined },
      usage,
      warnings: [],
    }),
    doStream: async (options: { prompt?: { role?: string; content?: unknown }[] }) => {
      const parts = isClassifier(options) ? [askIntentVerdictText("question", "sure")] : (steps[next++] ?? []);
      const unified = parts.some((part) => typeof part !== "string" && part.type === "tool-call") ? "tool-calls" : "stop";
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            for (const [i, part] of parts.entries()) {
              if (typeof part !== "string") {
                controller.enqueue(part);
                continue;
              }
              controller.enqueue({ type: "text-start", id: `t${i}` });
              controller.enqueue({ type: "text-delta", id: `t${i}`, delta: part });
              controller.enqueue({ type: "text-end", id: `t${i}` });
            }
            controller.enqueue({ type: "finish", finishReason: { unified, raw: undefined }, usage });
            controller.close();
          },
        }),
      };
    },
  } as unknown as Parameters<typeof handleAccountAskRequest>[1];
}

/** The SSE body's chunk types, in order. */
function typesIn(body: string): string[] {
  return body
    .split("\n")
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map((line) => (JSON.parse(line.slice("data: ".length)) as { type: string }).type);
}

beforeAll(async () => {
  await upsertUser({ id: ASKER, email: null, name: null, image: null });
  await seedTrip("Kyoto in spring", [
    ["Kyoto", "JP"],
    ["Kyoto", "JP"],
  ]);
  await seedTrip("Lisbon", [["Lisbon", "PT"]]);
  // Theirs to open, and planned by them, but they are not going: three Paris
  // days, which would make Paris the city they have been to most if counted.
  const paris = await seedTrip("Paris for Sam", [
    ["Paris", "FR"],
    ["Paris", "FR"],
    ["Paris", "FR"],
  ]);
  await writeTravelling(db, { tripId: paris, userId: ASKER, travelling: false, updatedBy: ASKER, now: new Date().toISOString() });
});

beforeEach(async () => {
  currentUserId = ASKER;
  // The step quota is per actor and every turn here is the same one.
  await db.delete(rateLimitCounters);
});

describe("POST /api/ask", () => {
  it("answers across the trips the asker travelled on, through the aggregate tool and never read_trip", async () => {
    const records: AskAnalyticsRecord[] = [];
    const ledgers: TurnLedger[] = [];
    const pending: (() => Promise<void>)[] = [];
    const res = await handleAccountAskRequest(
      ask("which city have I been to most?"),
      simulatedModel(),
      (record, ledger) => {
        records.push(record);
        if (ledger) ledgers.push(ledger);
      },
      undefined,
      (task) => pending.push(task),
    );
    const spoken = spokenIn(await res.text());
    await Promise.all(pending.map((task) => task()));

    expect(res.status).toBe(200);
    expect(spoken).toContain("Kyoto");
    expect(spoken).not.toContain("Paris");
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ tripId: null, scope: { kind: "account" }, outcome: "completed" });
    expect(records[0]!.toolCalls.map((call) => call.name)).toEqual(["visit_counts"]);
    expect(ledgers[0]!.cost.endpoint).toBe("ask.account");
    const [row] = await db.select({ endpoint: aiUsage.endpoint }).from(aiUsage).where(eq(aiUsage.id, ledgers[0]!.cost.turnId!));
    expect(row?.endpoint).toBe("ask.account");
  });

  // The trip door's filter, on this door too (KI-20261012-e): the note a
  // model writes beside a tool call is not part of its answer.
  it("keeps text written beside a tool call out of the reply", async () => {
    const res = await handleAccountAskRequest(
      ask("which city have I been to most?"),
      scriptedStepsModel([
        ["Count the cities first.", { type: "tool-call", toolCallId: "visits", toolName: "visit_counts", input: JSON.stringify({ by: "city" }) }],
        ["Kyoto, on two days."],
      ]),
      () => {},
    );
    expect(spokenIn(await res.text())).toBe("Kyoto, on two days.");
  });

  // The wrap-up step is offered no tools, so its text streams as it comes
  // rather than at the step's end: reasoning after it shows that from outside.
  it("streams the wrap-up step's text live", async () => {
    const records: AskAnalyticsRecord[] = [];
    const res = await handleAccountAskRequest(
      ask("which city have I been to most?"),
      scriptedStepsModel([["Out of time, so here is what I have.", { type: "reasoning-start", id: "r" }, { type: "reasoning-end", id: "r" }]]),
      (record) => records.push(record),
      { stepMs: 0, hardMs: 60_000 },
    );
    const types = typesIn(await res.text());

    expect(records[0]).toMatchObject({ wrapUp: "deadline" });
    expect(types.indexOf("text-delta")).toBeGreaterThan(-1);
    expect(types.indexOf("text-delta")).toBeLessThan(types.indexOf("reasoning-start"));
  });

  it("is the account handler behind the route, and refuses a signed-out caller", async () => {
    currentUserId = null;
    const res = await POST(ask("how many countries have I been to?"));
    expect(res.status).toBe(401);
  });
});
