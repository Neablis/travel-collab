import { describe, expect, it } from "vitest";
import { simulatedModel, SIMULATED_MODEL_ID } from "@/server/ai/simulatedModel";
import { askScopeLine, type AskScope } from "@/server/ai/context";

// `simulatedModel` returns `LanguageModel`, which is `string | LanguageModelV4`
// — so `.doGenerate` is not reachable on the union — and LanguageModelV4 itself
// is not importable, because @ai-sdk/provider is not a direct dependency of
// apps/web. Narrow through one local structural type instead of fighting the
// union at every call site. `doGenerate` reads none of its options, so `{}`
// tests exactly as much as reconstructing LanguageModelV4CallOptions would.
type Call = { type: string; toolName: string; input: string; toolCallId: string };
type Generated = { content: Call[]; finishReason: { unified: string; raw: undefined } };
type Probe = {
  specificationVersion: string;
  modelId: string;
  doGenerate: (options: unknown) => Promise<Generated>;
  doStream: (options: unknown) => Promise<unknown>;
};

const probe = (surface: "page" | "board" | "combined" | "ask") => simulatedModel(surface) as unknown as Probe;
const callsOf = (result: Generated) => result.content.filter((c) => c.type === "tool-call");
const textOf = (result: Generated) =>
  result.content
    .filter((c) => c.type === "text")
    .map((c) => (c as unknown as { text: string }).text)
    .join("");

// A prompt as the SDK hands one to the model: the instruction carrying the
// scope line, the question, and (on the second step) the tool results.
function askPrompt(scope: AskScope, results: { toolName: string; value: unknown }[] = []) {
  return {
    prompt: [
      { role: "system", content: ["You are a test.", askScopeLine(scope)].join("\n") },
      { role: "user", content: [{ type: "text", text: "how does this look?" }] },
      ...(results.length === 0
        ? []
        : [
            {
              role: "tool",
              content: results.map((r, i) => ({
                type: "tool-result",
                toolCallId: `c${i}`,
                toolName: r.toolName,
                output: { type: "json", value: r.value },
              })),
            },
          ]),
    ],
  };
}

const TRIP_READOUT = {
  name: "Japan",
  currency: "USD",
  startDate: "2026-09-08",
  dayCount: 3,
  tripCostTotal: 1000,
  days: [
    { day: 1, date: "2026-09-08", stopCount: 2, costSubtotal: 500 },
    { day: 2, date: "2026-09-09", stopCount: 1, costSubtotal: 500 },
    { day: 3, date: "2026-09-10", stopCount: 0, costSubtotal: 0 },
  ],
  conflicts: [{ ref: 1, kind: "time-overlap", description: "\"A\" and \"B\" overlap on day 2." }],
};

const DAY_READOUT = {
  day: 3,
  date: "2026-09-10",
  costSubtotal: 0,
  stops: [{ title: "Museum", timeWindow: { start: "10:00", end: "12:00" }, location: null, notes: null, kind: "planned", tags: [], cost: null }],
};

const FREE_READOUT = {
  searched: "day 3",
  window: { after: "08:00", before: "22:00" },
  gaps: [
    { day: 3, date: "2026-09-10", start: "08:00", end: "10:00", durationMinutes: 120 },
    { day: 3, date: "2026-09-10", start: "12:00", end: "22:00", durationMinutes: 600 },
  ],
};

describe("simulatedModel", () => {
  it("identifies itself so meta.model.requested is honest", () => {
    expect(probe("board")).toMatchObject({ specificationVersion: "v4", modelId: SIMULATED_MODEL_ID });
    expect(SIMULATED_MODEL_ID).toBe("simulated/no-op");
  });

  it("emits two AddDay and three AddActivity calls for the board surface", async () => {
    const result = await probe("board").doGenerate({});
    expect(callsOf(result).map((c) => c.toolName)).toEqual([
      "AddDay",
      "AddDay",
      "AddActivity",
      "AddActivity",
      "AddActivity",
    ]);
    expect(result.finishReason).toEqual({ unified: "tool-calls", raw: undefined });
  });

  it("emits no location and no cost, so nothing reaches the geocoder or the wallet", async () => {
    const result = await probe("board").doGenerate({});
    for (const call of callsOf(result)) {
      const input = JSON.parse(call.input) as Record<string, unknown>;
      expect(input).not.toHaveProperty("location");
      expect(input).not.toHaveProperty("cost");
    }
  });

  it("emits one compose_page call for the page surface", async () => {
    const calls = callsOf(await probe("page").doGenerate({}));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.toolName).toBe("compose_page");
    const input = JSON.parse(calls[0]!.input) as { title: string; blocks: unknown[] };
    expect(input.title).toBeTruthy();
    expect(input.blocks.length).toBeGreaterThan(0);
  });

  // KI-23: `combined` exposes BOTH tool sets in handleAiRequest (the planning
  // tools merged with buildPageTools()'s), so a simulation that only ever
  // emits the plan under-represents the surface. Both halves in ONE step — the
  // simulated model gets exactly one message, and every call in it is applied
  // together.
  it("emits both the plan and a composed page for the combined surface", async () => {
    const calls = callsOf(await probe("combined").doGenerate({}));
    expect(calls.map((c) => c.toolName)).toEqual([
      "AddDay",
      "AddDay",
      "AddActivity",
      "AddActivity",
      "AddActivity",
      "compose_page",
    ]);
  });

  // Guards against `combined` drifting into a third, separately-maintained
  // script: it is exactly the board plan followed by the page.
  it("reuses the board plan and the page content verbatim for combined", async () => {
    const combined = callsOf(await probe("combined").doGenerate({})).map((c) => c.input);
    const board = callsOf(await probe("board").doGenerate({})).map((c) => c.input);
    const page = callsOf(await probe("page").doGenerate({})).map((c) => c.input);
    expect(combined).toEqual([...board, ...page]);
  });

  // The 32-step budget makes this the difference between one batch and 32.
  it("stops after the first step instead of re-emitting forever", async () => {
    const model = probe("board");
    await model.doGenerate({});
    const second = await model.doGenerate({});
    expect(second.finishReason).toEqual({ unified: "stop", raw: undefined });
    expect(callsOf(second)).toHaveLength(0);
  });

  it("gives each tool call a distinct id", async () => {
    const ids = callsOf(await probe("board").doGenerate({})).map((c) => c.toolCallId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("refuses to stream a command surface rather than pretending to", async () => {
    await expect(probe("board").doStream({})).rejects.toThrow(/does not stream/);
    await expect(probe("page").doStream({})).rejects.toThrow(/does not stream/);
    await expect(probe("combined").doStream({})).rejects.toThrow(/does not stream/);
  });
});

// The ask surface is the one the deployed sidebar runs on: every Vercel
// environment has `ai-live` off, so if this branch cannot answer, the assistant
// is broken in production. It is not a canned sentence — it calls the real read
// tools and writes its prose from what they returned.
describe("simulatedModel — the ask surface", () => {
  it("asks read_trip and find_free_time first for a trip-scoped turn", async () => {
    const calls = callsOf(await probe("ask").doGenerate(askPrompt({ kind: "trip" })));
    expect(calls.map((c) => c.toolName)).toEqual(["read_trip", "find_free_time"]);
    // Waking hours, not 00:00-24:00: the largest gap on any real day is
    // otherwise the one you sleep through.
    expect(JSON.parse(calls[1]!.input)).toEqual({ after: "08:00", before: "22:00" });
  });

  it("adds read_day when, and only when, the turn is scoped to a day", async () => {
    const calls = callsOf(await probe("ask").doGenerate(askPrompt({ kind: "day", dayIndex: 2 })));
    expect(calls.map((c) => c.toolName)).toEqual(["read_trip", "read_day", "find_free_time"]);
    expect(JSON.parse(calls[1]!.input)).toEqual({ day: 3 });
  });

  it("answers in prose from what the tools returned, not from a canned string", async () => {
    const answer = textOf(
      await probe("ask").doGenerate(
        askPrompt({ kind: "trip" }, [
          { toolName: "read_trip", value: TRIP_READOUT },
          { toolName: "find_free_time", value: FREE_READOUT },
        ]),
      ),
    );
    expect(answer).toContain("Japan runs to 3 days, starting 2026-09-08.");
    expect(answer).toContain("There are 3 stops scheduled across it.");
    expect(answer).toContain("The biggest open stretch between 08:00 and 22:00 is on day 3, 12:00 to 22:00 — 600 minutes.");
    expect(answer).toContain("1 conflict is still open:");
    expect(answer).toContain("AI is switched off on this deployment");
  });

  // M16's gate: a day-scoped answer must not wander onto other days. The trip's
  // conflict list spans the whole trip, so it is the one thing that could.
  it("names no day but its own when the turn is day-scoped", async () => {
    const answer = textOf(
      await probe("ask").doGenerate(
        askPrompt({ kind: "day", dayIndex: 2 }, [
          { toolName: "read_trip", value: TRIP_READOUT },
          { toolName: "read_day", value: DAY_READOUT },
          { toolName: "find_free_time", value: FREE_READOUT },
        ]),
      ),
    );
    expect(answer).toContain("Day 3 (2026-09-10) of Japan has 1 stop.");
    expect(answer).toContain("Museum at 10:00");
    expect(answer).not.toMatch(/day 1|day 2|overlap/i);
  });

  it("says so rather than inventing one when the trip has no open time", async () => {
    const answer = textOf(
      await probe("ask").doGenerate(
        askPrompt({ kind: "trip" }, [
          { toolName: "read_trip", value: { ...TRIP_READOUT, conflicts: [] } },
          { toolName: "find_free_time", value: { ...FREE_READOUT, searched: "the whole trip", gaps: [] } },
        ]),
      ),
    );
    expect(answer).toContain("I found no open time on the whole trip between 08:00 and 22:00.");
  });

  it("streams the answer sentence by sentence as one text part", async () => {
    const result = (await probe("ask").doStream(
      askPrompt({ kind: "trip" }, [
        { toolName: "read_trip", value: TRIP_READOUT },
        { toolName: "find_free_time", value: FREE_READOUT },
      ]),
    )) as { stream: ReadableStream<{ type: string; id?: string; delta?: string }> };
    const parts: { type: string; id?: string; delta?: string }[] = [];
    for await (const part of result.stream as unknown as AsyncIterable<{ type: string; id?: string; delta?: string }>) {
      parts.push(part);
    }
    expect(parts[0]!.type).toBe("stream-start");
    expect(parts.at(-1)!.type).toBe("finish");
    expect(parts.filter((p) => p.type === "text-start")).toHaveLength(1);
    expect(parts.filter((p) => p.type === "text-end")).toHaveLength(1);
    const deltas = parts.filter((p) => p.type === "text-delta");
    expect(deltas.length).toBeGreaterThan(1);
    // Every delta belongs to the one text part, and concatenating them
    // reproduces the answer with its spacing intact.
    expect(new Set(deltas.map((d) => d.id)).size).toBe(1);
    expect(deltas.map((d) => d.delta).join("")).toContain("Japan runs to 3 days, starting 2026-09-08. There are");
  });

  it("streams the tool calls whole on the first step", async () => {
    const result = (await probe("ask").doStream(askPrompt({ kind: "trip" }))) as {
      stream: ReadableStream<{ type: string; toolName?: string }>;
    };
    const parts: { type: string; toolName?: string }[] = [];
    for await (const part of result.stream as unknown as AsyncIterable<{ type: string; toolName?: string }>) {
      parts.push(part);
    }
    expect(parts.filter((p) => p.type === "tool-call").map((p) => p.toolName)).toEqual([
      "read_trip",
      "find_free_time",
    ]);
  });

  // The window, not just the reading. Turn 2 of a client-held thread carries
  // turn 1's tool results; counting those as "already asked" made every turn
  // after the first answer from stale readouts without calling a tool.
  it("ignores a previous turn's tool results and asks again", async () => {
    const stale = { toolName: "read_trip", value: { ...TRIP_READOUT, name: "STALE" } };
    const priorTurn = askPrompt({ kind: "trip" }, [stale]).prompt;
    const secondTurn = {
      prompt: [...priorTurn, { role: "user", content: [{ type: "text", text: "and now?" }] }],
    };

    const calls = callsOf(await probe("ask").doGenerate(secondTurn));
    expect(calls.map((c) => c.toolName)).toEqual(["read_trip", "find_free_time"]);
  });

  it("answers turn 2 from turn 2's results, never the ones before its question", async () => {
    const priorTurn = askPrompt({ kind: "trip" }, [
      { toolName: "read_trip", value: { ...TRIP_READOUT, name: "STALE" } },
    ]).prompt;
    const answer = textOf(
      await probe("ask").doGenerate({
        prompt: [
          ...priorTurn,
          { role: "user", content: [{ type: "text", text: "and now?" }] },
          {
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: "fresh",
                toolName: "read_trip",
                output: { type: "json", value: { ...TRIP_READOUT, name: "FRESH" } },
              },
            ],
          },
        ],
      }),
    );
    expect(answer).toContain("FRESH runs to 3 days");
    expect(answer).not.toContain("STALE");
  });

  // Reading the CONVERSATION rather than a counter is what makes this correct
  // across retries: a re-issued first step must ask again, not answer with
  // nothing to answer from.
  it("asks again on a repeated first step instead of latching", async () => {
    const model = probe("ask");
    await model.doGenerate(askPrompt({ kind: "trip" }));
    const second = await model.doGenerate(askPrompt({ kind: "trip" }));
    expect(callsOf(second)).toHaveLength(2);
  });
});
