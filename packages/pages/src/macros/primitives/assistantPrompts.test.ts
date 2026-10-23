import { describe, expect, it } from "vitest";
import { tripDetailFactory } from "@tc/factories";
import { renderMacro } from "../../registry";
import type { AssistantPromptsPayload, WidgetContext } from "../../registry-types";

// "Ask" (M52 decision 15). The chips themselves are fixed copy; what is worth
// pinning is who sees them (decision 20, SPEC §27: absent, never disabled)
// and that each carries a whole question for the assistant, not only its label.

const trip = tripDetailFactory.build({}, { transient: { dayCount: 1, activitiesPerDay: 0, unscheduledCount: 0 } });
const ctx = (extra: Partial<WidgetContext>): WidgetContext => ({
  trip, page: { tripId: trip.tripId }, user: null, globals: null, today: null, ...extra,
});

function promptsOf(context: WidgetContext): AssistantPromptsPayload {
  const outcome = renderMacro(context, "assistant.prompts", {});
  if (outcome.status !== "ok" || outcome.rendered.kind !== "block" || outcome.rendered.block.kind !== "assistant-prompts") {
    throw new Error(`expected an assistant-prompts block, got ${JSON.stringify(outcome)}`);
  }
  return outcome.rendered.block;
}

describe("assistant.prompts", () => {
  it("offers the three day-of prompts, each a question longer than its label", () => {
    const { prompts } = promptsOf(ctx({ canAsk: true }));
    expect(prompts.map((p) => p.label)).toEqual(["Running late", "Move dinner later", "Something closed"]);
    for (const p of prompts) expect(p.text.length).toBeGreaterThan(p.label.length);
  });

  it("is absent for a reader with no assistant, and for one whose context never said", () => {
    expect(renderMacro(ctx({ canAsk: false }), "assistant.prompts", {})).toEqual({ status: "absent" });
    expect(renderMacro(ctx({}), "assistant.prompts", {})).toEqual({ status: "absent" });
  });

  // Asking is reading (SPEC §27: "Ask stays available in read-only"), so the
  // chat's capability is no part of it.
  it("does not depend on the chat", () => {
    expect(promptsOf(ctx({ canAsk: true, canChat: false })).prompts).toHaveLength(3);
  });
});
