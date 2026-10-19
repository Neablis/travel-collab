// **M50 decision 10, the voice, on every surface the assistant answers from.**
// The line was written into the trip turn's instruction first; the account and
// playbook-page turns build their own instructions, so a line added to one of
// the three reaches neither of the others unless something checks.
import { describe, expect, it } from "vitest";
import { accountInstructionBlocks, instructionsFor, playbookInstructionBlocks } from "@/server/ai/handleAskRequest";
import { renderPrompt } from "@/server/assistant/prompt";

const VOICE = "Talk like a friend who has been there, plain, specific, no filler.";

describe("the assistant's voice", () => {
  it.each([
    ["a trip turn", () => instructionsFor({ kind: "trip" }, 3)],
    ["the account turn", () => renderPrompt(accountInstructionBlocks({ kind: "trip" }))],
    ["a shared playbook day", () => renderPrompt(playbookInstructionBlocks({ kind: "trip" }, "playbook-day"))],
    ["a playbook list page", () => renderPrompt(playbookInstructionBlocks({ kind: "trip" }, "discover"))],
  ])("is in the instruction for %s", (_surface, instruction) => {
    expect(instruction().split("\n")).toContain(VOICE);
  });
});
