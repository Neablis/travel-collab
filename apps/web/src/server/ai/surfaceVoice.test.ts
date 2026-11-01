// **M50 decision 10, the voice, on every surface the assistant answers from.**
// The line was written into the trip turn's instruction first; the account and
// playbook-page turns build their own instructions, so a line added to one of
// the three reaches neither of the others unless something checks.
import { describe, expect, it } from "vitest";
import { accountInstructionBlocks, instructionsFor, playbookInstructionBlocks } from "@/server/ai/handleAskRequest";
import { renderPrompt } from "@/server/assistant/prompt";

const VOICE = "Talk like a friend who has been there, plain, specific, no filler.";
// Personas are the assistant's own business (Mitchell, 2026-11-01): the person never chooses one or is asked to.
const NO_ASKING = "Never ask the person whether to switch, never offer them a choice of persona or mode, and never ask which one to use: switch yourself when the task needs it.";

describe("the assistant's voice", () => {
  it.each([
    ["a trip turn", () => instructionsFor({ kind: "trip" }, 3)],
    ["the account turn", () => renderPrompt(accountInstructionBlocks({ kind: "trip" }))],
    ["a shared playbook day", () => renderPrompt(playbookInstructionBlocks({ kind: "trip" }, "playbook-day"))],
    ["a playbook list page", () => renderPrompt(playbookInstructionBlocks({ kind: "trip" }, "discover"))],
  ])("is in the instruction for %s", (_surface, instruction) => {
    expect(instruction().split("\n")).toContain(VOICE);
  });

  it.each([
    ["a trip turn", () => instructionsFor({ kind: "trip" }, 3)],
    ["the account turn", () => renderPrompt(accountInstructionBlocks({ kind: "trip" }))],
    ["a playbook list page", () => renderPrompt(playbookInstructionBlocks({ kind: "trip" }, "discover"))],
  ])("tells the model never to ask the person to switch, in %s", (_surface, instruction) => {
    expect(instruction().split("\n")).toContain(NO_ASKING);
  });
});
