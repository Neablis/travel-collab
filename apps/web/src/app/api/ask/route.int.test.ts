// The doors about no one trip (M45): POST /api/ask. What only this lane can
// show is the whole path over real trips — the session, the one admission
// pipeline with no trip, the trips port reading what the asker can open and
// who is travelling, the cross-trip tools, and the ledger row under its own
// endpoint. The arithmetic is the domain's and is tested there. The playbook
// pages' turns (D9) ride the same door, over a real published day.
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { executeTripCommand } from "@/server/commands";
import { db } from "@/server/db/client";
import { aiCapabilityGaps, aiUsage, rateLimitCounters, tripMemberships } from "@/server/db/schema";
import { writeTravelling } from "@/server/access/members";
import { simulatedModel } from "@/server/ai/simulatedModel";
import { askIntentVerdictText, isAskIntentCall } from "@/server/ai/askIntent";
import { ASK_RETRACT_CHUNK } from "@tc/contracts";
import { visibleText } from "@/server/ai/eval/grade";
import type { AskAnalyticsRecord } from "@/server/assistant/askAnalytics";
import type { TurnLedger } from "@/server/assistant/ledger";

// Their own account, so no other suite's trips are theirs.
const ASKER = "account-asker";

let currentUserId: string | null = ASKER;

vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
}));

const { handleBeyondTripAskRequest } = await import("@/server/ai/handleAskRequest");
const { POST } = await import("./route");
const { upsertUser } = await import("@/server/users");
const usage = await import("@/server/entitlements/usage");
const { POST: SAVE_DAY } = await import("../saved-days/route");
const { POST: PUBLISH_DAY } = await import("../saved-days/[savedDayId]/publish/route");
const { POST: INSERT_DAY } = await import("../trips/[tripId]/saved-days/[savedDayId]/route");
const { getTripDetail } = await import("@/server/projections");

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

let kyoto = "";

/** The palette commands a turn's final chunk carried, or [] when it named none. */
function paletteCommandsIn(body: string): unknown[] {
  return body
    .split("\n")
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map((line) => JSON.parse(line.slice("data: ".length)) as { messageMetadata?: { paletteCommands?: unknown[] } })
    .flatMap((chunk) => chunk.messageMetadata?.paletteCommands ?? []);
}

/**
 * A model that answers the classifier with `question` and then plays `steps`
 * in order, each the parts one step emits: a string is text, anything else a
 * provider part as given (a tool call, or reasoning).
 */
function scriptedStepsModel(steps: (string | Record<string, unknown>)[][], prompts: unknown[] = []) {
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
      if (!isClassifier(options)) prompts.push(options.prompt);
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
  } as unknown as Parameters<typeof handleBeyondTripAskRequest>[1];
}

/** The SSE body's chunks, in order. */
function chunksIn(body: string): Record<string, unknown>[] {
  return body
    .split("\n")
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map((line) => JSON.parse(line.slice("data: ".length)) as Record<string, unknown>);
}

beforeAll(async () => {
  await upsertUser({ id: ASKER, email: null, name: null, image: null });
  kyoto = await seedTrip("Kyoto in spring", [
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
    const res = await handleBeyondTripAskRequest(
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
    const [row] = await db
      .select({ endpoint: aiUsage.endpoint, entryPersona: aiUsage.entryPersona })
      .from(aiUsage)
      .where(eq(aiUsage.id, ledgers[0]!.cost.turnId!));
    expect(row?.endpoint).toBe("ask.account");
    // M57: the beyond-trip door's row says who ran it, not only the trip door's.
    expect(row?.entryPersona).toBe("account");
  });

  // M45 D6's walk: "open my Kyoto trip on the map" from Home lands on that
  // trip's Map view, by the palette command Home's ⌘K registers for it. Only a
  // trip the asker is travelling on: "Paris for Sam" is theirs to open but not
  // theirs to go on, and the account surface counts it nowhere (D2).
  it("takes the asker to a trip they are travelling on by its palette command, and to no other", async () => {
    const going = await handleBeyondTripAskRequest(ask("open my Kyoto trip on the map"), simulatedModel());
    expect(paletteCommandsIn(await going.text())).toEqual([{ id: `go:trip:${kyoto}:view:Map`, needsApproval: false }]);

    const refused = await handleBeyondTripAskRequest(ask("open my Paris trip"), simulatedModel());
    const body = await refused.text();
    expect(paletteCommandsIn(body)).toEqual([]);
    expect(spokenIn(body)).toContain("couldn't take you there");
  });

  // The trip door's retraction, on this door too (KI-2026-10-12-e): the note a
  // model writes beside a tool call streams, then is taken back.
  it("takes back exactly the tool step's text, and never the final step's", async () => {
    const res = await handleBeyondTripAskRequest(
      ask("which city have I been to most?"),
      scriptedStepsModel([
        ["Count the cities first.", { type: "tool-call", toolCallId: "visits", toolName: "visit_counts", input: JSON.stringify({ by: "city" }) }],
        ["Kyoto, on two days."],
      ]),
      () => {},
    );
    const chunks = chunksIn(await res.text());
    expect(chunks.filter((c) => c.type === ASK_RETRACT_CHUNK)).toEqual([{ type: ASK_RETRACT_CHUNK, data: { ids: ["t0"] }, transient: true }]);
    expect(visibleText(chunks)).toBe("Kyoto, on two days.");
  });

  // ADR-084 §2: Home cannot plan a trip, so it hands the task to where it is
  // done, with a button, and the gap is logged as the backlog it is.
  it("hands a new trip off to New trip and a change to a trip off to that trip's plan, and logs each gap", async () => {
    const logged = vi.spyOn(console, "info");
    const handOffIn = (body: string) =>
      chunksIn(body)
        .map((chunk) => (chunk.messageMetadata as { handOff?: unknown } | undefined)?.handOff)
        .find((handOff) => handOff !== undefined);
    const handingOff = (input: Record<string, unknown>) =>
      scriptedStepsModel([
        [{ type: "tool-call", toolCallId: "off", toolName: "hand_off", input: JSON.stringify(input) }],
        ["That is done from there."],
      ]);

    const fresh = await handleBeyondTripAskRequest(ask("help me plan a foodie trip somewhere new"), handingOff({ task: "plan a foodie trip", to: "new_trip" }), () => {});
    expect(handOffIn(await fresh.text())).toEqual({ task: "plan a foodie trip", to: "new_trip" });
    const gaps = logged.mock.calls.filter(([line]) => line === "ai.capability_gap").map(([, json]) => JSON.parse(json as string));
    expect(gaps).toEqual([expect.objectContaining({ surface: "account", persona: "account", task: "plan a foodie trip", to: "new_trip" })]);
    // M57: the same gap is a row, keyed by the turn id the log line carries.
    const [{ turnId: gapTurnId }] = gaps as [{ turnId: string }];
    const rows = await vi.waitFor(async () => {
      const found = await db.select().from(aiCapabilityGaps).where(eq(aiCapabilityGaps.turnId, gapTurnId));
      expect(found).toHaveLength(1);
      return found;
    });
    expect(rows[0]).toMatchObject({ persona: "account", target: "new_trip", task: "plan a foodie trip" });

    const existing = await handleBeyondTripAskRequest(ask("add a ramen dinner to my Kyoto trip"), handingOff({ task: "add a dinner", to: "plan_page", trip: "Kyoto" }), () => {});
    expect(handOffIn(await existing.text())).toEqual({ task: "add a dinner", to: "plan_page", command: `go:trip:${kyoto}:view:Plan` });
    logged.mockRestore();
  });

  // The gap row is started from the final chunk's metadata, which is
  // synchronous, so nothing awaits it unless the turn's settlement does. On
  // Vercel a write nobody holds can be lost once the response closes (PR 670
  // review). The settlement is read the way `after()` reads it: through the
  // task handed to `afterResponse`.
  it("holds the capability gap write on the turn's settlement", async () => {
    const original = usage.recordCapabilityGap;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    let written = false;
    const slow = vi.spyOn(usage, "recordCapabilityGap").mockImplementation(async (...args) => {
      await gate;
      const result = await original(...args);
      written = true;
      return result;
    });
    const tasks: (() => Promise<void>)[] = [];
    const res = await handleBeyondTripAskRequest(
      ask("help me plan a foodie trip somewhere new"),
      scriptedStepsModel([
        [{ type: "tool-call", toolCallId: "off", toolName: "hand_off", input: JSON.stringify({ task: "plan a foodie trip", to: "new_trip" }) }],
        ["That is done from there."],
      ]),
      () => {},
      undefined,
      (task) => void tasks.push(task),
    );
    // `onEnd` awaits `settled`, so the stream itself stays open while the
    // gap write is pending; the afterResponse task is the same promise.
    let settledEarly = false;
    const body = res.text();
    const settling = body.then(() => Promise.all(tasks.map((task) => task()))).then(() => (settledEarly = true));
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(slow).toHaveBeenCalledTimes(1);
    expect(settledEarly, "settlement resolved while the gap write was still pending").toBe(false);
    release();
    await settling;
    expect(written).toBe(true);
    slow.mockRestore();
  });

  // ADR-084 §2: what the person picked arrives as data on their message, and
  // the server, not the model, says what it was.
  it("reads an answer to its question as data, and refuses one that is not an answer", async () => {
    const answered = (answer: unknown) =>
      new Request("http://test/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: { kind: "account" },
          messages: [
            { id: "u1", role: "user", parts: [{ type: "text", text: "help me plan a trip" }] },
            { id: "a1", role: "assistant", parts: [{ type: "text", text: "What should it be about?" }] },
            { id: "u2", role: "user", parts: [{ type: "text", text: "Food" }, { type: "data-ask-answer", data: answer }] },
          ],
        }),
      });
    const prompts: unknown[] = [];
    // The question rides with the answer: the turn that asked it often sent
    // no text, so without it the next turn reads slugs and nothing they answer.
    const res = await handleBeyondTripAskRequest(
      answered({ answeredAsk: "ask-1", question: "What should it be about?", optionIds: ["food"], other: { kind: "number", value: 14 } }),
      scriptedStepsModel([["Food it is."]], prompts),
      () => {},
    );
    expect(res.status).toBe(200);
    await res.text();
    expect(JSON.stringify(prompts[0])).toContain(
      JSON.stringify(
        '(They answered your question "What should it be about?" by picking the options ["food"], and as the other answer {"kind":"number","value":14}.)',
      ).slice(1, -1),
    );

    const typed = await handleBeyondTripAskRequest(
      answered({ answeredAsk: "ask-1", optionIds: ["Somewhere I have not been"], other: null }),
      scriptedStepsModel([["Never reached."]]),
      () => {},
    );
    expect(typed.status).toBe(400);
  });

  it("is the account handler behind the route, and refuses a signed-out caller", async () => {
    currentUserId = null;
    const res = await POST(ask("how many countries have I been to?"));
    expect(res.status).toBe(401);
  });
});

// M45 D9: a playbook page's assistant, over a day somebody else published.
describe("POST /api/ask on a playbook page", () => {
  const AUTHOR = "playbook-author";
  let savedDayId = "";
  let rome = "";

  /** The proposal a turn's final chunk carried, or null when it drafted none. */
  function proposalOf(chunks: Record<string, unknown>[]): Record<string, unknown> | null {
    const found = chunks
      .map((chunk) => (chunk.messageMetadata as { proposal?: Record<string, unknown> } | undefined)?.proposal)
      .find((proposal) => proposal !== undefined);
    return found ?? null;
  }
  const proposalIn = (body: string) => proposalOf(chunksIn(body));

  const onDay = () => ({ kind: "playbook", page: { kind: "day", savedDayId } });

  beforeAll(async () => {
    await upsertUser({ id: AUTHOR, email: null, name: null, image: null });
    currentUserId = AUTHOR;
    const tripId = randomUUID();
    const dayId = randomUUID();
    await executeTripCommand({ type: "CreateTrip", tripId, name: "Source" }, AUTHOR);
    await executeTripCommand({ type: "AddDay", tripId, dayId }, AUTHOR);
    await executeTripCommand(
      {
        type: "AddActivity",
        tripId,
        activityId: randomUUID(),
        dayId,
        title: "Nishiki Market",
        timeWindow: { start: "10:00", end: "11:00" },
        location: { name: "Nishiki Market", city: "Kyoto" },
      },
      AUTHOR,
    );
    const saved = await SAVE_DAY(
      new Request("http://test/x", { method: "POST", body: JSON.stringify({ name: "Kyoto, on foot", tripId, dayIds: [dayId] }) }),
    );
    savedDayId = ((await saved.json()) as { savedDay: { savedDayId: string } }).savedDay.savedDayId;
    const published = await PUBLISH_DAY(new Request("http://test/x", { method: "POST" }), { params: Promise.resolve({ savedDayId }) });
    expect(published.status).toBe(200);
    // The author's trip, which the asker may open and not edit.
    rome = randomUUID();
    await executeTripCommand({ type: "CreateTrip", tripId: rome, name: "Rome with Ana" }, AUTHOR);
    await db.insert(tripMemberships).values({ tripId: rome, userId: ASKER, role: "viewer", invitedBy: AUTHOR, createdAt: new Date().toISOString() });
    currentUserId = ASKER;
  });

  // D9: "Only signed-in users on a plan with assistant access see it" — the
  // route refuses the rest through the trip assistant's own admission.
  it("refuses a signed-out caller, and an account whose plan has no assistant", async () => {
    currentUserId = null;
    expect((await POST(ask("what does this day cover?", onDay()))).status).toBe(401);
    // `ASKER` holds no grant, so its plan is free. No model is injected, so
    // selection — the entitlement check — runs as in production.
    currentUserId = ASKER;
    const refused = await POST(ask("what does this day cover?", onDay()));
    expect(refused.status).toBe(402);
    expect(((await refused.json()) as { code?: string }).code).toBe("ai-not-entitled");
  });

  it("answers from the day on screen, under its own ledger endpoint", async () => {
    const records: AskAnalyticsRecord[] = [];
    const ledgers: TurnLedger[] = [];
    const res = await handleBeyondTripAskRequest(ask("what does this day cover?", onDay()), simulatedModel(), (record, ledger) => {
      records.push(record);
      if (ledger) ledgers.push(ledger);
    });
    const spoken = spokenIn(await res.text());
    expect(res.status).toBe(200);
    expect(spoken).toContain("Nishiki Market");
    expect(records[0]!.toolCalls.map((call) => call.name)).toEqual(["read_playbook"]);
    expect(ledgers[0]!.cost.endpoint).toBe("ask.playbook");
  });

  // The write: a card naming the trip and day the person named, approved
  // through the page's own Add to trip route — and the stop lands on that day.
  it("drafts adding the day to the named trip on the named day, which the button's route then applies", async () => {
    const res = await handleBeyondTripAskRequest(ask("add this to my Kyoto trip on day 2", onDay()), simulatedModel());
    const proposal = proposalIn(await res.text());
    const before = (await getTripDetail(kyoto))!;
    const day2 = before.days[1]!.dayId;
    expect(proposal).toMatchObject({
      inserts: [{ savedDayId }],
      commands: [],
      target: { kind: "trip", tripId: kyoto, startingAt: day2 },
    });

    const applied = await INSERT_DAY(
      new Request("http://test/x", { method: "POST", body: JSON.stringify({ startingAt: day2 }) }),
      { params: Promise.resolve({ tripId: kyoto, savedDayId }) },
    );
    expect(applied.status).toBe(200);
    const after = (await getTripDetail(kyoto))!;
    expect(after.days).toHaveLength(before.days.length);
    const titles = after.days[1]!.activityIds.map((id) => after.activities[id]!.title);
    expect(titles).toContain("Nishiki Market");
  });

  // Invariant 7: a trip they can open and not edit is refused, by name, with
  // no card — the button would refuse it too.
  it("refuses a trip the asker cannot edit, and drafts nothing", async () => {
    const res = await handleBeyondTripAskRequest(ask("add this to my Rome trip on day 1", onDay()), simulatedModel());
    const body = await res.text();
    expect(proposalIn(body)).toBeNull();
    expect(spokenIn(body)).toContain("not edit it");
  });

  // M56 part 5 review: from Home, a viewer's change was handed to a plan page
  // whose assistant then refused it a second time. No button; the model is told why.
  it("does not hand a change off to the plan of a trip the asker cannot edit", async () => {
    const prompts: unknown[] = [];
    const res = await handleBeyondTripAskRequest(
      ask("add a dinner to my Rome trip"),
      scriptedStepsModel(
        [[{ type: "tool-call", toolCallId: "off", toolName: "hand_off", input: JSON.stringify({ task: "add a dinner", to: "plan_page", trip: "Rome" }) }], ["You can only read Rome."]],
        prompts,
      ),
      () => {},
    );
    const handOff = chunksIn(await res.text()).find((chunk) => (chunk.messageMetadata as { handOff?: unknown } | undefined)?.handOff !== undefined);
    expect(handOff).toBeUndefined();
    expect(JSON.stringify(prompts[1])).toContain("lets them read it, not change it");
  });

  // D9: "The person names the trip and day." A call naming none is answered
  // with the question to ask, never a card.
  it("answers a write naming no trip with the question to ask, and no card", async () => {
    const res = await handleBeyondTripAskRequest(
      ask("add this to a trip", onDay()),
      scriptedStepsModel([
        [{ type: "tool-call", toolCallId: "add", toolName: "add_playbook_to_trip", input: JSON.stringify({ trip: "", day: 1 }) }],
        ["Which trip?"],
      ]),
    );
    const chunks = chunksIn(await res.text());
    expect(proposalOf(chunks)).toBeNull();
    const output = chunks.find((chunk) => chunk.type === "tool-output-available")?.output as { queued?: boolean; refused?: string };
    expect(output).toMatchObject({ queued: false });
    expect(output.refused).toContain("They named no trip");
  });

  it("starts a new trip named after the playbook", async () => {
    const res = await handleBeyondTripAskRequest(ask("start a trip with this day", onDay()), simulatedModel());
    expect(proposalIn(await res.text())).toMatchObject({ inserts: [{ savedDayId }], target: { kind: "new-trip", name: "Kyoto, on foot" } });
  });

  it("refuses a day the asker cannot open, before anything is spent", async () => {
    const res = await handleBeyondTripAskRequest(ask("what does this cover?", { kind: "playbook", page: { kind: "day", savedDayId: randomUUID() } }), simulatedModel());
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code?: string }).code).toBe("playbook-not-found");
  });
});
