import { ASK_RETRACT_CHUNK, type AskRetractData } from "@tc/contracts";
import type { UIMessageChunk } from "ai";

/**
 * **Text written beside a tool call streams, then is taken back**
 * (KI-2026-10-12-e, KI-2026-10-12-h).
 *
 * `toUIMessageStream` forwards every step's text, so a note a model writes to
 * itself beside a tool call ("Gap 5:30–7 pm. Look up a cafe.") reached the
 * client as the start of its answer, run into the next step's text with no
 * space. Deterministic rather than a prompt rule: a model can always slip.
 *
 * Every step's text streams as it is written. When a step that wrote text goes
 * on to a tool call, a transient `ASK_RETRACT_CHUNK` naming that text's part
 * ids goes out just ahead of the tool's first chunk, and the client removes
 * those parts. Text written after the call in the same step is taken back at
 * the next call or at `finish-step`. The UI `finish-step` chunk carries no
 * finish reason, so "the step called a tool" is "a `tool-*` chunk arrived in
 * it". The final step calls no tool, so its text is never taken back, unless
 * it is blank: a group of bare newlines would sit above the answer, or be an
 * empty answer of its own, so it goes the same way at its `finish-step` or at
 * the end of the turn.
 *
 * **The cost is a flicker, accepted deliberately** (Mitchell, 2026-10-12): a
 * note appears, then goes. Holding each step's text until the step ends hid it
 * but stopped the answer streaming; KI-2026-10-12-h records the holistic options.
 *
 * Never a blank reply where the model did say something: if the turn ends
 * (`finish`, `abort`, `error`) with no text kept, the last text taken back is
 * sent again under a new id, once: the answer a model gave beside its final
 * tool call, or a deadline-cut turn's last words. Once, because a model
 * `error` does not end streamText's stream: `finish-step` and `finish` follow
 * it, so the end of the turn arrives twice. "Text" is a delta with something
 * besides whitespace in it: streamText forwards a group with nothing in it
 * (always its start and end, and an empty delta carrying provider metadata), a
 * model can open a block with bare newlines, and neither is an answer.
 *
 * Retracted text is never stored: the thread the client keeps, and posts back
 * as history, is what is left on screen.
 */
export function retractTextBesideTools(): TransformStream<UIMessageChunk, UIMessageChunk> {
  // This step's text not yet taken back, by part id, in the order it opened.
  let open = new Map<string, string>();
  let calledTool = false;
  let kept = false;
  let lastRetracted: { id: string; text: string } | null = null;
  const spoke = (texts: Iterable<string>) => [...texts].some((text) => text.trim().length > 0);

  return new TransformStream({
    transform(chunk, controller) {
      const retract = () => {
        if (open.size === 0) return;
        const ids = [...open.keys()];
        controller.enqueue({ type: ASK_RETRACT_CHUNK, data: { ids } satisfies AskRetractData, transient: true });
        if (spoke(open.values())) lastRetracted = { id: ids.at(-1)!, text: [...open.values()].join("") };
        open = new Map();
      };
      switch (chunk.type) {
        case "start-step":
          open = new Map();
          calledTool = false;
          break;
        case "text-start":
          open.set(chunk.id, "");
          break;
        case "text-delta":
          open.set(chunk.id, (open.get(chunk.id) ?? "") + chunk.delta);
          break;
        case "finish-step":
          if (calledTool || !spoke(open.values())) retract();
          else kept = true;
          open = new Map();
          break;
        case "finish":
        case "abort":
        case "error":
          // A step cut off mid-way keeps what it wrote: no tool call took it back.
          if (!spoke(open.values())) retract();
          if (!kept && !spoke(open.values()) && lastRetracted !== null) {
            const id = `${lastRetracted.id}-kept`;
            controller.enqueue({ type: "text-start", id });
            controller.enqueue({ type: "text-delta", id, delta: lastRetracted.text });
            controller.enqueue({ type: "text-end", id });
          }
          // Decided once (see above).
          kept = true;
          open = new Map();
          break;
        default:
          if (chunk.type.startsWith("tool-")) {
            calledTool = true;
            retract();
          }
      }
      controller.enqueue(chunk);
    },
  });
}
