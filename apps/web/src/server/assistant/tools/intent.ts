// The page turn's pivot (ADR-058): `switch_intent`.
//
// A page turn starts in the intent its classifier chose — `compose` or
// `question` — holding only that intent's tools and instruction. When the
// model finds partway through that the classifier was wrong ("make me a food
// notebook" read as a question, or "how much are we spending on food?" read as
// a request to write), this is how it says so: the next step holds the other
// intent's tools, model and instruction, in the same conversation, having spent
// one step to ask.
//
// It is the page's version of the board's `request_change_tools` (M9), which
// is the same move — question to edit — and stays the board's pivot.
import { z } from "zod";
import { TASK_CLASSES } from "@/server/assistant/taskClass";
import { defineTool } from "@/server/assistant/defineTool";

export const SWITCH_INTENT_TOOL_NAME = "switch_intent";

const SwitchIntentInput = z.object({
  to: z
    .enum(TASK_CLASSES as unknown as [string, ...string[]])
    .describe("compose: build or add to this notebook page. question: answer about the trip in the chat."),
  reason: z.string().min(1).max(300).describe("Why the turn's current intent was the wrong reading, in one sentence."),
});

const SwitchIntentOutput = z.union([
  z.object({ switched: z.literal(true), note: z.string() }),
  z.object({ switched: z.literal(false), refused: z.string() }),
]);

/**
 * **`domain: "pages"`, and it is the one tool in that domain that writes
 * nothing.** It is offered exactly where a page turn is — the page surface is
 * the only row that grants `pages` — and admission offers it only when the
 * turn has somewhere to pivot to. `effect: "read"`: what it changes is which of
 * the turn's own, already-admitted tools the next step holds, never the trip
 * or the page.
 *
 * `minimumRole: "editor"` for the reason `request_change_tools` gives: a tool
 * that can unlock insert tools should raise `minimumRoleFor` on its own
 * account, not by inheritance.
 */
export const switchIntentTool = defineTool({
  name: SWITCH_INTENT_TOOL_NAME,
  description:
    "Call this when this turn was started with the wrong intent: the user asked a QUESTION and you were given page-writing tools, or asked you to BUILD or ADD TO the page and you were given reading tools. Say why. Your next step holds the tools for the intent you name.",
  domain: "pages",
  effect: "read",
  spend: "none",
  input: SwitchIntentInput,
  output: SwitchIntentOutput,
  needs: ["intent"] as const,
  minimumRole: "editor",
  // The model's own words and our notes coming back to it; nothing to fence.
  run: (input, deps) => {
    const result = deps.intent.request(input.to as (typeof TASK_CLASSES)[number], input.reason);
    return result.ok
      ? { switched: true as const, note: `From your next step this turn is ${input.to}, with that intent's tools and rules.` }
      : { switched: false as const, refused: result.refused };
  },
});

export const INTENT_TOOLS = [switchIntentTool] as const;
