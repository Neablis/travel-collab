import type { UIMessageChunk } from "ai";
import { ASK_RETRACT_CHUNK as RETRACT_CHUNK } from "@tc/contracts";
import { describe, expect, it } from "vitest";
import { retractTextBesideTools } from "./finalStepText";

async function through(chunks: UIMessageChunk[]): Promise<UIMessageChunk[]> {
  const out: UIMessageChunk[] = [];
  const stream = new ReadableStream<UIMessageChunk>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  }).pipeThrough(retractTextBesideTools());
  const reader = stream.getReader();
  for (let next = await reader.read(); !next.done; next = await reader.read()) out.push(next.value);
  return out;
}

const text = (id: string, delta: string): UIMessageChunk[] => [
  { type: "text-start", id },
  { type: "text-delta", id, delta },
  { type: "text-end", id },
];

const readDay: UIMessageChunk[] = [
  { type: "tool-input-start", toolCallId: "c1", toolName: "read_day" },
  { type: "tool-input-available", toolCallId: "c1", toolName: "read_day", input: { days: 1 } },
  { type: "tool-output-available", toolCallId: "c1", output: {} },
];

const step = (...chunks: UIMessageChunk[][]): UIMessageChunk[] => [{ type: "start-step" }, ...chunks.flat(), { type: "finish-step" }];

/** The ids each retraction named, in order. */
const retractions = (chunks: UIMessageChunk[]) =>
  chunks.flatMap((chunk) => (chunk.type === RETRACT_CHUNK ? [(chunk as { data: { ids: string[] } }).data.ids] : []));

/**
 * What is left on screen once every retraction has been applied, in order. AI
 * SDK 7 makes text ids unique per run, so the latest part by an id is the only
 * one; resolving to the latest is the client's defensive rule, mirrored here.
 */
const visible = (chunks: UIMessageChunk[]) => {
  let parts: { id: string; text: string }[] = [];
  for (const chunk of chunks) {
    if (chunk.type === "text-start") parts.push({ id: chunk.id, text: "" });
    if (chunk.type === "text-delta") [...parts].reverse().find((part) => part.id === chunk.id)!.text += chunk.delta;
    if (chunk.type === RETRACT_CHUNK) {
      const ids = (chunk as { data: { ids: string[] } }).data.ids;
      parts = parts.filter((part) => !ids.includes(part.id));
    }
  }
  return parts.map((part) => part.text).join("");
};

describe("retractTextBesideTools", () => {
  it("streams a tool step's text, then takes back exactly its ids ahead of the call, and keeps the final step's", async () => {
    const out = await through([
      { type: "start" },
      ...step(text("a", "Gap 5:30–7 pm. "), text("a2", "Look up a cafe."), readDay),
      ...step(text("b", "Day 1 is free from 5:30 to 7 pm.")),
      { type: "finish" },
    ]);
    const types = out.map((chunk) => chunk.type);
    // Streamed as written: the note's text is out before the step's tool call.
    expect(types.indexOf("text-delta")).toBeLessThan(types.indexOf(RETRACT_CHUNK));
    expect(types.indexOf(RETRACT_CHUNK)).toBe(types.indexOf("tool-input-start") - 1);
    expect(retractions(out)).toEqual([["a", "a2"]]);
    expect(out.find((chunk) => chunk.type === RETRACT_CHUNK)).toMatchObject({ transient: true });
    expect(visible(out)).toBe("Day 1 is free from 5:30 to 7 pm.");
    expect(out.filter((chunk) => chunk.type.startsWith("tool-"))).toEqual(readDay);
  });

  it("takes back only the ids of the step that called the tool", async () => {
    const out = await through([...step(text("0", "Checking."), readDay), ...step(text("aitxt-1", "Day 1 is free.")), { type: "finish" }]);
    expect(retractions(out)).toEqual([["0"]]);
    expect(visible(out)).toBe("Day 1 is free.");
  });

  it("takes back text written after the call in the same step when the step ends", async () => {
    const out = await through([...step(readDay, text("a", "Now the cafe.")), ...step(text("b", "Done.")), { type: "finish" }]);
    expect(retractions(out)).toEqual([["a"]]);
    expect(visible(out)).toBe("Done.");
  });

  it("re-sends the last taken-back text when the final step says nothing", async () => {
    const out = await through([
      ...step(text("a", "Too early to say."), readDay),
      ...step(text("b", "Day 1 is free from 5:30 to 7 pm."), readDay),
      ...step(),
      { type: "finish" },
    ]);
    expect(visible(out)).toBe("Day 1 is free from 5:30 to 7 pm.");
    expect(out.at(-1)).toEqual({ type: "finish" });
  });

  // streamText forwards a text group with no visible text: always its start
  // and end, and an empty delta when the provider attaches metadata to it. A
  // model can also open a block with bare newlines; that reads as blank too.
  describe.each([
    ["an empty", ""],
    ["a whitespace-only", "\n\n"],
  ])("%s text group", (_, blank) => {
    it("is not the answer when the final step says it", async () => {
      const out = await through([...step(text("a", "Day 1 is free."), readDay), ...step(text("b", blank)), { type: "finish" }]);
      // Taken back too, so no blank lines sit above the re-sent text.
      expect(visible(out)).toBe("Day 1 is free.");
    });

    it("is taken back when the final step after a silent tool step says only it", async () => {
      // Left on screen, it would be an empty answer bubble in place of "Thinking…".
      const out = await through([...step(readDay), ...step(text("b", blank)), { type: "finish" }]);
      expect(visible(out)).toBe("");
    });

    it("is taken back when the turn aborts in the first step", async () => {
      // Left on screen, `useAskThread` would see text and not say the turn stopped.
      const out = await through([{ type: "start-step" }, ...text("a", blank), { type: "abort" }]);
      expect(visible(out)).toBe("");
    });

    it("beside a later tool call does not replace the last taken-back text", async () => {
      const out = await through([...step(text("a", "Day 1 is free."), readDay), ...step(text("b", blank), readDay), { type: "finish" }]);
      expect(visible(out)).toBe("Day 1 is free.");
    });

    it("in progress when the turn aborts does not win over the last taken-back text", async () => {
      const out = await through([...step(text("a", "Earlier note."), readDay), { type: "start-step" }, ...text("b", blank), { type: "abort" }]);
      expect(visible(out)).toBe("Earlier note.");
    });
  });

  it.each(["abort", "error"] as const)("on %s, keeps the step in progress, or else re-sends the last taken-back text", async (end) => {
    const ending: UIMessageChunk = end === "abort" ? { type: "abort" } : { type: "error", errorText: "failed" };
    const midStep = await through([...step(text("a", "Earlier note."), readDay), { type: "start-step" }, ...text("b", "Half an ans"), ending]);
    expect(visible(midStep)).toBe("Half an ans");
    expect(midStep.at(-1)).toEqual(ending);

    const betweenSteps = await through([...step(text("a", "Day 1 is free."), readDay), { type: "start-step" }, ending]);
    expect(visible(betweenSteps)).toBe("Day 1 is free.");
    expect(betweenSteps.at(-1)).toEqual(ending);
  });

  // A model `error` chunk does not end streamText's stream: `finish-step` and
  // `finish` follow it, so the end of the turn is reached twice.
  it("re-sends the last taken-back text once when a provider error is followed by finish", async () => {
    const out = await through([
      ...step(text("a", "Day 1 is free."), readDay),
      { type: "start-step" },
      { type: "error", errorText: "overloaded" },
      { type: "finish-step" },
      { type: "finish" },
    ]);
    expect(visible(out)).toBe("Day 1 is free.");
  });

  it("keeps a partial answer cut by a provider error, without the earlier note after it", async () => {
    const out = await through([
      ...step(text("a", "Day 1 is free."), readDay),
      { type: "start-step" },
      ...text("b", "Half an ans"),
      { type: "error", errorText: "overloaded" },
      { type: "finish-step" },
      { type: "finish" },
    ]);
    expect(visible(out)).toBe("Half an ans");
  });

  it("passes metadata and the final chunk through untouched", async () => {
    const metadata: UIMessageChunk = { type: "message-metadata", messageMetadata: { pageInserts: 1 } };
    const finish: UIMessageChunk = { type: "finish", messageMetadata: { proposal: { commands: [] } } };
    const out = await through([...step(text("a", "Done."), readDay), metadata, ...step(text("b", "Added it.")), finish]);
    expect(out).toContain(metadata);
    expect(out.at(-1)).toBe(finish);
  });
});
