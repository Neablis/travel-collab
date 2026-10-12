import type { UIMessageChunk } from "ai";

/**
 * **The reply is the final step's text, not every step's** (KI-20261012-e).
 *
 * `toUIMessageStream` forwards every step's text, so a note a model writes to
 * itself beside a tool call ("Gap 5:30–7 pm. Look up a cafe.") reached the
 * client as the start of its answer, run into the next step's text with no
 * space. Deterministic rather than a prompt rule: a model can always slip.
 *
 * A step's text is held until the step ends, and released only if the step
 * called no tool. The UI `finish-step` chunk carries no finish reason, so "the
 * step called a tool" is "a `tool-*` chunk arrived in it". Whole
 * `text-start`…`text-end` groups are held or dropped, so ids stay paired.
 * Everything that is not text passes through at once and unchanged.
 *
 * `liveStep(index)` — index counted from 0 by `start-step`, as `prepareStep`
 * counts — names a step that cannot call a tool (the wrap-up step, offered
 * none); its text streams as it arrives. An index, not a flag read now: the
 * chunks of an earlier step can still be in flight when the loop has already
 * prepared the wrap-up step.
 *
 * Never a blank reply where the model did say something: if the turn ends
 * (`finish`, `abort`, `error`) with no text released, the step in progress's
 * text is shown, or else the last dropped step's — the answer a model gave
 * beside its final tool call, or a deadline-cut turn's last words. "Text" is
 * a delta with something besides whitespace in it: streamText forwards a
 * group with nothing in it (always its start and end, and an empty delta
 * carrying provider metadata), a model can open a block with bare newlines,
 * and neither is an answer.
 *
 * **The cost: the answer no longer streams token by token.** A step cannot be
 * known to be tool-free until it ends, so the final step's text arrives whole
 * at its `finish-step` — time to first text grows by that step's generation
 * time, several seconds for a long itinerary answer. Only the wrap-up step
 * still streams live. Inherent to a deterministic filter, and the price of it.
 */
export function finalStepTextOnly(opts: { liveStep: (step: number) => boolean }): TransformStream<UIMessageChunk, UIMessageChunk> {
  let step = -1;
  let live = false;
  let held: UIMessageChunk[] = [];
  let calledTool = false;
  let lastDropped: UIMessageChunk[] = [];
  let released = false;
  const spoke = (chunks: UIMessageChunk[]) => chunks.some((chunk) => chunk.type === "text-delta" && chunk.delta.trim().length > 0);

  return new TransformStream({
    transform(chunk, controller) {
      const release = (chunks: UIMessageChunk[]) => {
        for (const text of chunks) controller.enqueue(text);
        if (spoke(chunks)) released = true;
      };
      switch (chunk.type) {
        case "start-step":
          step += 1;
          live = opts.liveStep(step);
          held = [];
          calledTool = false;
          break;
        case "text-start":
        case "text-delta":
        case "text-end":
          if (live) release([chunk]);
          else held.push(chunk);
          return;
        case "finish-step":
          if (!calledTool) release(held);
          else if (spoke(held)) lastDropped = held;
          held = [];
          break;
        case "finish":
        case "abort":
        case "error":
          if (!released) release(spoke(held) ? held : lastDropped);
          held = [];
          break;
        default:
          if (chunk.type.startsWith("tool-")) calledTool = true;
      }
      controller.enqueue(chunk);
    },
  });
}
