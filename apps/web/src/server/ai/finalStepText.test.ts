import type { UIMessageChunk } from "ai";
import { describe, expect, it } from "vitest";
import { finalStepTextOnly } from "./finalStepText";

async function through(chunks: UIMessageChunk[], liveStep: (step: number) => boolean = () => false): Promise<UIMessageChunk[]> {
  const out: UIMessageChunk[] = [];
  const stream = new ReadableStream<UIMessageChunk>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  }).pipeThrough(finalStepTextOnly({ liveStep }));
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

const spoken = (chunks: UIMessageChunk[]) =>
  chunks.flatMap((chunk) => (chunk.type === "text-delta" ? [chunk.delta] : [])).join("");

describe("finalStepTextOnly", () => {
  it("drops the text of a step that called a tool and keeps the final step's", async () => {
    const out = await through([
      { type: "start" },
      ...step(text("a", "Gap 5:30–7 pm. Look up a cafe."), readDay),
      ...step(text("b", "Day 1 is free from 5:30 to 7 pm.")),
      { type: "finish" },
    ]);
    expect(spoken(out)).toBe("Day 1 is free from 5:30 to 7 pm.");
    // The tool's chunks, and the whole of the dropped group, start to end.
    expect(out.filter((chunk) => chunk.type.startsWith("tool-"))).toEqual(readDay);
    expect(out.filter((chunk) => chunk.type === "text-start").map((chunk) => (chunk as { id: string }).id)).toEqual(["b"]);
  });

  // The wrap-up step is offered no tools, so its text is the answer: it
  // streams as it comes rather than waiting for the step to end.
  it("streams the live step's text as it arrives", async () => {
    const out = await through(
      [
        ...step(readDay),
        { type: "start-step" },
        ...text("w", "Out of time."),
        { type: "reasoning-start", id: "r" },
        { type: "finish-step" },
        { type: "finish" },
      ],
      (index) => index === 1,
    );
    const types = out.map((chunk) => chunk.type);
    expect(types.indexOf("text-delta")).toBeLessThan(types.indexOf("reasoning-start"));
  });

  it("answers with the last tool step's text when the final step says nothing", async () => {
    const out = await through([
      ...step(text("a", "Too early to say."), readDay),
      ...step(text("b", "Day 1 is free from 5:30 to 7 pm."), readDay),
      ...step(),
      { type: "finish" },
    ]);
    expect(spoken(out)).toBe("Day 1 is free from 5:30 to 7 pm.");
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
      // The blank group itself still passes, ahead of the fallback.
      expect(spoken(out).trim()).toBe("Day 1 is free.");
    });

    it("beside a later tool call does not replace the last dropped text", async () => {
      const out = await through([...step(text("a", "Day 1 is free."), readDay), ...step(text("b", blank), readDay), { type: "finish" }]);
      expect(spoken(out)).toBe("Day 1 is free.");
    });

    // Only abort or error can end a turn with a group still held.
    it("held when the turn aborts does not win over the last dropped text", async () => {
      const out = await through([...step(text("a", "Earlier note."), readDay), { type: "start-step" }, ...text("b", blank), { type: "abort" }]);
      expect(spoken(out)).toBe("Earlier note.");
    });
  });

  it.each(["abort", "error"] as const)("on %s, shows the step in progress, or else the last dropped text", async (end) => {
    const ending: UIMessageChunk = end === "abort" ? { type: "abort" } : { type: "error", errorText: "failed" };
    const midStep = await through([...step(text("a", "Earlier note."), readDay), { type: "start-step" }, ...text("b", "Half an ans"), ending]);
    expect(spoken(midStep)).toBe("Half an ans");
    expect(midStep.at(-1)).toEqual(ending);

    const betweenSteps = await through([...step(text("a", "Day 1 is free."), readDay), { type: "start-step" }, ending]);
    expect(spoken(betweenSteps)).toBe("Day 1 is free.");
    expect(betweenSteps.at(-1)).toEqual(ending);
  });

  it("passes metadata and the final chunk through untouched", async () => {
    const metadata: UIMessageChunk = { type: "message-metadata", messageMetadata: { pageInserts: 1 } };
    const finish: UIMessageChunk = { type: "finish", messageMetadata: { proposal: { commands: [] } } };
    const out = await through([...step(text("a", "Done."), readDay), metadata, ...step(text("b", "Added it.")), finish]);
    expect(out).toContain(metadata);
    expect(out.at(-1)).toBe(finish);
  });
});
