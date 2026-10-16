import { afterEach, describe, expect, it, vi } from "vitest";
// Static, like contextBudget.test.ts: this module's graph is too heavy to
// import inside a test's timeout. The flag is read by `getPlanExamples` at
// call time through `serverConfig`, so the per-case env stubs below still
// govern it for the dynamically re-imported planExamples module.
import { instructionBlocks } from "@/server/ai/handleAskRequest";
import { renderPrompt } from "@/server/assistant/prompt";
import type { DayChunk } from "./planExamples";

// The two I/O seams `getPlanExamples` chains: the embedding provider and the
// database. Both are stubbed — no test here touches a network or Postgres,
// and the flag-off case asserts the provider is not even CALLED.
// `serverConfig` reads process.env once at module load, so the flag is
// stubbed per case and the module re-imported, the same pattern as
// embeddings.test.ts.
const mocks = vi.hoisted(() => ({
  embedText: vi.fn(),
  retrieveDayChunks: vi.fn(),
}));

vi.mock("@/server/ai/embeddings", () => ({ embedText: mocks.embedText }));
vi.mock("@/server/ai/retrieval", () => ({ retrieveDayChunks: mocks.retrieveDayChunks }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  mocks.embedText.mockReset();
  mocks.retrieveDayChunks.mockReset();
});

/** Import planExamples under stubbed env values. */
async function planExamplesWithEnv(env: Record<string, string | undefined>) {
  // Fresh module per case: `serverConfig` reads the env once at load, and the
  // static import of handleAskRequest above already pulled planExamples into
  // the registry at collection time (with the ambient env). Without the reset
  // the first test to run would see a stale flag.
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else vi.stubEnv(key, value);
  }
  return import("./planExamples");
}

/** Import planExamples under a stubbed RAG_PLAN_RETRIEVAL value. */
async function planExamplesWithFlag(flag: string | undefined, extraEnv: Record<string, string | undefined> = {}) {
  return planExamplesWithEnv({ RAG_PLAN_RETRIEVAL: flag, ...extraEnv });
}

function dayChunk(overrides: Partial<DayChunk> = {}): DayChunk {
  return {
    id: "chunk-1",
    sourceType: "playbook",
    sourceId: "pb-1",
    dayIndex: 0,
    chunkText:
      "Morning at the Tsukiji outer market tasting tamagoyaki and fresh uni, ramen for lunch near the station, then a long walk along the river at sunset.",
    city: "Tokyo",
    countryCode: "JP",
    tags: ["food"],
    score: 1.0,
    ...overrides,
  };
}

describe("getPlanExamples", () => {
  it("returns [] without calling the embedding provider when the flag is off", async () => {
    mocks.embedText.mockResolvedValue([0.1, 0.2]);
    const { getPlanExamples } = await planExamplesWithFlag(undefined);

    await expect(getPlanExamples({ question: "plan a food trip to Tokyo", userId: "u1" })).resolves.toEqual([]);

    expect(mocks.embedText).not.toHaveBeenCalled();
    expect(mocks.retrieveDayChunks).not.toHaveBeenCalled();
  });

  it("returns [] when the embedding provider fails", async () => {
    mocks.embedText.mockResolvedValue(null);
    mocks.retrieveDayChunks.mockResolvedValue([dayChunk()]);
    const { getPlanExamples } = await planExamplesWithFlag("1");

    await expect(getPlanExamples({ question: "plan a food trip to Tokyo", userId: "u1" })).resolves.toEqual([]);

    expect(mocks.retrieveDayChunks).not.toHaveBeenCalled();
  });

  it("returns [] when retrieval finds nothing, and formats no blocks", async () => {
    mocks.embedText.mockResolvedValue([0.1, 0.2]);
    mocks.retrieveDayChunks.mockResolvedValue([]);
    const { getPlanExamples, formatExampleBlocks } = await planExamplesWithFlag("1");

    const examples = await getPlanExamples({ question: "plan a food trip to Tokyo", userId: "u1" });

    expect(examples).toEqual([]);
    expect(formatExampleBlocks(examples)).toEqual([]);
  });

  it(
    "returns [] when retrieval exceeds the turn budget",
    { timeout: 5_000 },
    async () => {
      mocks.embedText.mockImplementation(() => new Promise(() => {}));
      const { getPlanExamples } = await planExamplesWithFlag("1");

      await expect(getPlanExamples({ question: "plan a food trip to Tokyo", userId: "u1", timeoutMs: 50 })).resolves.toEqual(
        [],
      );
    },
  );

  it("passes the question to hybrid retrieval with k=5 when the flag is on", async () => {
    const chunk = dayChunk();
    mocks.embedText.mockResolvedValue([0.5]);
    mocks.retrieveDayChunks.mockResolvedValue([chunk]);
    const { getPlanExamples } = await planExamplesWithFlag("1");

    const examples = await getPlanExamples({ question: "plan a food trip to Tokyo", userId: "u1" });

    expect(examples).toEqual([chunk]);
    expect(mocks.retrieveDayChunks).toHaveBeenCalledWith({
      queryEmbedding: [0.5],
      queryText: "plan a food trip to Tokyo",
      userId: "u1",
      k: 5,
    });
  });

  it("never throws when the chain throws past its own catches", async () => {
    mocks.embedText.mockRejectedValue(new Error("provider exploded"));
    const { getPlanExamples } = await planExamplesWithFlag("1");

    await expect(getPlanExamples({ question: "plan a food trip to Tokyo", userId: "u1" })).resolves.toEqual([]);
  });
});

describe("formatExampleBlocks", () => {
  it("returns [] for no examples", async () => {
    const { formatExampleBlocks } = await planExamplesWithFlag("1");

    expect(formatExampleBlocks([])).toEqual([]);
  });

  it("emits a server-authored rule and a data block carrying the outside text", async () => {
    const longText = `${"sushi ".repeat(200)}end`;
    const { formatExampleBlocks } = await planExamplesWithFlag("1");

    const blocks = formatExampleBlocks([dayChunk({ chunkText: longText, city: "Osaka", countryCode: "JP" })]);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({
      kind: "rule",
      text: expect.stringMatching(/never copy them verbatim/) as unknown,
    });
    expect((blocks[0] as { text: string }).text).toMatch(/user's request wins/);
    // Gate 2 follow-up: the rule also asks for tight plans — the examples are
    // structure, not material to restate.
    expect((blocks[0] as { text: string }).text).toMatch(/keep the plan tight/i);
    // The example text is outside text (ADR-043): a `data` block, never a `rule`.
    expect(blocks[1]?.kind).toBe("data");
    const dataBlock = blocks[1] as { kind: "data"; label: string; value: unknown };
    expect(dataBlock.label).toMatch(/Example days/);
    const compact = dataBlock.value as { city: string; country: string; tags: string[]; text: string }[];
    expect(compact).toHaveLength(1);
    expect(compact[0]?.city).toBe("Osaka");
    expect(compact[0]?.country).toBe("JP");
    expect(compact[0]?.tags).toEqual(["food"]);
    // Truncated to the token-efficient share, not the whole chunk.
    expect(compact[0]?.text.length).toBeLessThanOrEqual(250);
    expect(longText.startsWith(compact[0]?.text ?? "")).toBe(true);
  });

  it("truncates on code-point boundaries, never splitting a surrogate pair", async () => {
    const { formatExampleBlocks } = await planExamplesWithFlag("1");
    // An emoji straddling the truncation boundary: a UTF-16 slice(0, 250)
    // would keep its high surrogate and leave a lone surrogate in the prompt.
    const text = `${"x".repeat(249)}😀${"y".repeat(100)}`;

    const blocks = formatExampleBlocks([dayChunk({ chunkText: text })]);

    const dataBlock = blocks[1] as { kind: "data"; label: string; value: { text: string }[] };
    expect(dataBlock.value[0]?.text).toBe(`${"x".repeat(249)}😀`);
  });

  it("honors RAG_PLAN_EXAMPLE_CHARS when set", async () => {
    const { formatExampleBlocks } = await planExamplesWithFlag("1", { RAG_PLAN_EXAMPLE_CHARS: "100" });
    const longText = "sushi ".repeat(200);

    const blocks = formatExampleBlocks([dayChunk({ chunkText: longText })]);

    const dataBlock = blocks[1] as { kind: "data"; label: string; value: { text: string }[] };
    expect(dataBlock.value[0]?.text.length).toBeLessThanOrEqual(100);
    expect(longText.startsWith(dataBlock.value[0]?.text ?? "")).toBe(true);
  });
});

describe("selectPromptExamples", () => {
  it("returns the top N by retrieval order, keeping order", async () => {
    const { selectPromptExamples } = await planExamplesWithFlag("1");
    const chunks = ["a", "b", "c", "d", "e"].map((id) => dayChunk({ id }));

    const selected = selectPromptExamples(chunks);

    expect(selected.map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("returns all when fewer than the prompt count", async () => {
    const { selectPromptExamples } = await planExamplesWithFlag("1");

    const selected = selectPromptExamples([dayChunk({ id: "a" }), dayChunk({ id: "b" })]);

    expect(selected.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("returns [] for []", async () => {
    const { selectPromptExamples } = await planExamplesWithFlag("1");

    expect(selectPromptExamples([])).toEqual([]);
  });

  it("honors RAG_PLAN_EXAMPLE_PROMPT_COUNT when set", async () => {
    const { selectPromptExamples } = await planExamplesWithFlag("1", { RAG_PLAN_EXAMPLE_PROMPT_COUNT: "1" });
    const chunks = ["a", "b", "c"].map((id) => dayChunk({ id }));

    expect(selectPromptExamples(chunks).map((c) => c.id)).toEqual(["a"]);
  });

  it("falls back to the default on a nonsense RAG_PLAN_EXAMPLE_PROMPT_COUNT", async () => {
    const { selectPromptExamples } = await planExamplesWithFlag("1", { RAG_PLAN_EXAMPLE_PROMPT_COUNT: "banana" });
    const chunks = ["a", "b", "c", "d", "e"].map((id) => dayChunk({ id }));

    expect(selectPromptExamples(chunks)).toHaveLength(3);
  });
});

describe("instructionBlocks with examples", () => {
  it("is byte-identical with examples=[] as without, and carries no example content", async () => {
    const standing = { planned: true, dated: true };

    const without = instructionBlocks({ kind: "trip" }, 3, "read-only", null, false, standing, "12h");
    const withEmpty = instructionBlocks({ kind: "trip" }, 3, "read-only", null, false, standing, "12h", []);

    expect(withEmpty).toEqual(without);
    // The flag-off guarantee in one line: no example content reaches the prompt.
    // (The toEqual above alone cannot see a bug in formatExampleBlocks's own
    // empty case — both sides share it — so this pins the observable promise.)
    expect(renderPrompt(withEmpty)).not.toMatch(/Example days/);
  });

  it("appends the example blocks after the existing rules when examples exist", async () => {
    const { formatExampleBlocks } = await planExamplesWithFlag("1");
    const standing = { planned: true, dated: true };
    const examples = [dayChunk()];

    const blocks = instructionBlocks({ kind: "trip" }, 3, "read-only", null, false, standing, "12h", examples);
    const baseline = instructionBlocks({ kind: "trip" }, 3, "read-only", null, false, standing, "12h");

    expect(blocks.slice(0, baseline.length)).toEqual(baseline);
    expect(blocks.slice(baseline.length)).toEqual(formatExampleBlocks(examples));
    expect(blocks.slice(baseline.length).map((b) => b.kind)).toEqual(["rule", "data"]);
  });
});

describe("detectUsedExamples", () => {
  const chunk = () =>
    dayChunk({
      id: "chunk-9",
      chunkText:
        "We started the morning at the Tsukiji outer market tasting tamagoyaki and fresh uni before the crowds arrived.",
    });

  it("finds an 8+ word verbatim run from the chunk in the output", async () => {
    const { detectUsedExamples } = await planExamplesWithFlag("1");

    // Nine words verbatim, punctuation and case differing.
    const output = "Day 1: Started the morning at the Tsukiji outer market tasting tamagoyaki, then ramen.";
    expect(detectUsedExamples([chunk()], output)).toEqual(["chunk-9"]);
  });

  it("ignores short overlaps and unrelated output", async () => {
    const { detectUsedExamples } = await planExamplesWithFlag("1");

    expect(detectUsedExamples([chunk()], "We started the morning with coffee.")).toEqual([]);
    expect(detectUsedExamples([chunk()], "A lovely day in Kyoto with temples and gardens.")).toEqual([]);
  });

  it("returns [] for no examples or empty output", async () => {
    const { detectUsedExamples } = await planExamplesWithFlag("1");

    expect(detectUsedExamples([], "some output")).toEqual([]);
    expect(detectUsedExamples([chunk()], "")).toEqual([]);
    expect(detectUsedExamples([chunk()], "   ")).toEqual([]);
  });
});
