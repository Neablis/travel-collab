// **The trip's in-turn move between personas** (M57, ADR-085 decision 4):
// `switch_persona({ to, why })`.
//
// Schedule holds the trip's plan and nothing that looks the world up; when the
// model finds partway through that the message needs a real place or a
// published playbook day, it says so and the next step holds Discover's tools,
// in the same thread, having spent one step to ask. It is the persona graph's
// `switch` edge made callable, the way `request_change_tools` is the
// escalation's and `switch_intent` the page's.
//
// **The edge is checked twice, and the second is the one that counts.** `to` is
// an enum of every persona any `switch_persona` edge leads to, because the AI
// SDK keys a turn's tools by name and a turn builds one set up front; the
// intent latch then refuses an edge that does not leave the persona the turn
// is in, a guard the turn's caps fail, and a second switch. A refusal names
// what is open, so the model can act on it rather than retry blind.
import { z } from "zod";
import { defineTool } from "@/server/assistant/defineTool";
import { EDGES, type PersonaId } from "@/server/assistant/personas";

export const SWITCH_PERSONA_TOOL_NAME = "switch_persona";

// Derived from the table, so a persona given its first `switch_persona` edge
// is in the schema with no edit here.
const TARGETS = [...new Set(EDGES.filter((e) => e.kind === "switch" && e.via === SWITCH_PERSONA_TOOL_NAME).map((e) => e.to))] as [PersonaId, ...PersonaId[]];

const SwitchPersonaInput = z.object({
  to: z.enum(TARGETS).describe("The persona whose tools the next step should hold."),
  why: z.string().min(1).max(300).describe("What the message needs that the tools you hold cannot do, in one sentence."),
});

const SwitchPersonaOutput = z.union([
  z.object({ switched: z.literal(true), note: z.string() }),
  z.object({ switched: z.literal(false), refused: z.string() }),
]);

/**
 * **`domain: "system"` and `effect: "steer"`**, the pair `request_change_tools`
 * is: it changes which of the turn's own, already-admitted tools the next step
 * holds, never the trip. `steer` is what keeps it off a read-only turn
 * (`toolsFor`), so a viewer has no way across an edge that a person without
 * edit rights has no button for (AGENTS.md invariant 7).
 *
 * `minimumRole: "editor"` for the reason `request_change_tools` gives: a tool
 * that can unlock write tools raises `minimumRoleFor` on its own account.
 */
export const switchPersonaTool = defineTool({
  name: SWITCH_PERSONA_TOOL_NAME,
  description:
    "Call this when the message needs something the tools you hold do not do: look up a real place, or find a published playbook day. Say why. Your next step holds the tools of the persona you name. You can switch once a turn.",
  domain: "system",
  effect: "steer",
  spend: "none",
  input: SwitchPersonaInput,
  output: SwitchPersonaOutput,
  needs: ["intent"] as const,
  minimumRole: "editor",
  // The postures that can change the trip. `defineTool` closes this axis on an
  // absent posture, which is what keeps the tool out of the narrowest set
  // identification measures a guard against (`admission.ts`'s `NARROWEST`): a
  // viewer's request would otherwise be refused for a tool they are never
  // offered.
  postures: ["propose", "withheld"] as const,
  // The model's own words and our notes coming back to it; nothing to fence.
  run: (input, deps) => {
    const result = deps.intent.switchPersona(input.to, input.why);
    return result.ok
      ? { switched: true as const, note: `From your next step you are ${input.to}, with its tools and rules. You cannot switch again this turn.` }
      : { switched: false as const, refused: result.refused };
  },
});

export const PERSONA_TOOLS = [switchPersonaTool] as const;
