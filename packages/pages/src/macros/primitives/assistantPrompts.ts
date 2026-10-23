import { z } from "zod";
import type { AssistantPrompt, AssistantPromptsPayload, MacroDef, WidgetContext } from "../../registry-types";
import { blockOf } from "../../registry-types";
import { ok, needsTrip, type MacroResult } from "../../result";

// `assistant.prompts` — "Ask" (M52 decision 15): day-of chips, each opening
// the assistant with its question filled in. Shown only to a reader who has
// one (`requires`, decision 20; SPEC §27: absent, never disabled). Asking is
// reading, so a viewer has it too. The opening is the renderer's.

const AssistantPromptsParams = z.object({});
type AssistantPromptsParams = z.infer<typeof AssistantPromptsParams>;

/**
 * The chips, in the design's order. Each fills in a whole question, not its
 * label: "Running late" alone does not say what to do about it.
 */
const PROMPTS: readonly AssistantPrompt[] = [
  { label: "Running late", text: "We're running late. Push the rest of today's stops back." },
  { label: "Move dinner later", text: "Move tonight's dinner later." },
  { label: "Something closed", text: "A stop on today's plan is closed. Find something similar nearby." },
];

export const assistantPrompts: MacroDef<AssistantPromptsParams, AssistantPromptsPayload> = {
  name: "assistant.prompts",
  title: "Ask",
  shape: "block",
  params: AssistantPromptsParams,
  inputs: [],
  selection: undefined,
  requires: "canAsk",
  description: "Day-of questions for the trip's assistant — running late, moving dinner, a stop that is closed — one tap each. Shown only to people who have the assistant.",
  emptyText: "nothing to ask",
  preview: "Running late, Move dinner later, Something closed",
  // Unbound without a trip, as every widget is: the questions are about one.
  resolve: ({ trip }: WidgetContext): MacroResult<AssistantPromptsPayload> =>
    trip ? ok({ kind: "assistant-prompts", prompts: [...PROMPTS] }) : needsTrip(),
  render: blockOf,
};
