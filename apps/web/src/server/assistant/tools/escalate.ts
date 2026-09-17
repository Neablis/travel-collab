// **The recovery path a misclassified turn did not have** (M9 design §1b).
//
// Mitchell, 2026-09-15:
//
// > *"i really dislike how the AI right now will ask me to reframe a ask in
// > order for it to do the work. It should do what it needs to do."*
//
// The copy he is describing is the `withheld` posture's — an editor whose turn
// the classifier read as a question, so the write tools were not handed over.
// That posture's own comment argues the copy is honest, and it is. **The defect
// is that there is no recovery path**, so a misclassification costs a whole
// turn and makes the user do the classifier's job.
//
// This is the act half of the fix (`certainty` in `askIntent.ts` is the band
// half). The model that finds itself holding read tools for a request that
// plainly needs a change says so, and the turn re-enters with the write set —
// not a turn restart, not a client retry.
//
// **Why it cannot widen access, mechanically rather than by promise.** It is
// tagged `postures: ["withheld"]`, and `withheld` is BY DEFINITION the case
// where role and plan both already permit `propose` — a viewer and an
// unentitled plan both resolve to `read-only`. So the escalated set can never
// exceed what the actor may do, and `askIntent.ts`'s rule 2 ("it never widens
// access") holds without anyone remembering it. `grants.test.ts` asserts that
// as a property over every combination of caps rather than over three
// scenarios.
//
// **It is charged, and that is deliberate.** One step against `MAX_ASK_STEPS`
// and against the quota's admission reservation, and a line in the `TurnLedger`
// so M21 bills it like anything else. An escape hatch that is free is an escape
// hatch the model learns to take.
import { z } from "zod";
import { defineTool } from "@/server/assistant/defineTool";

export const ESCALATE_TOOL_NAME = "request_change_tools";

const EscalateInput = z.object({
  reason: z
    .string()
    .min(1)
    .max(300)
    .describe("Why the read-only reading of this message was wrong, in one sentence."),
  intendedChange: z
    .string()
    .min(1)
    .max(300)
    .describe("What you intend to propose once you have the change tools — the change itself, not a promise to make one."),
});

const EscalateOutput = z.object({
  granted: z.boolean(),
  note: z.string(),
});

const GRANTED_NOTE =
  "The change tools are available from your next step. Make the change you described — do not ask the user to rephrase, and do not ask permission: nothing you propose is applied until they approve it.";

// A second call is refused rather than silently re-granted, and it says why.
// The model is not being punished; it is being told the thing it wanted has
// already happened, which is the answer most likely to get it to act instead of
// trying a third time.
const ALREADY_NOTE =
  "You have already escalated this turn and the change tools are already available. Use them now rather than calling this again.";

/**
 * **`domain: "system"` and `effect: "read"`, which together say what it is.**
 *
 * It is not `propose`: it proposes nothing, collects nothing, and changes
 * nothing about the trip. What it changes is which tools the NEXT step holds,
 * which is a fact about the turn rather than about the itinerary — and
 * `system` is the domain that has been reserved for exactly that since ADR-043
 * decision 2 named six and used four.
 *
 * `minimumRole: "editor"` is the belt to `postures`' braces. `withheld`
 * already implies an editor, so this can never be the binding constraint; it is
 * here because `minimumRoleFor` is computed over the set actually selected, and
 * a tool that unlocks write tools should raise that answer on its own account
 * rather than by inheriting it from the tools it unlocks.
 */
export const escalateTool = defineTool({
  name: ESCALATE_TOOL_NAME,
  description:
    "Call this when the message you are answering asks for a CHANGE to the trip but you were only given read tools. Say why, and what you intend to propose. Your next step will have the change tools. Use this instead of telling the user to ask again — they should never have to rephrase to get a change made.",
  domain: "system",
  effect: "read",
  spend: "none",
  input: EscalateInput,
  output: EscalateOutput,
  needs: ["escalation"] as const,
  minimumRole: "editor",
  postures: ["withheld"] as const,
  // Nothing here is user-authored: `reason` and `intendedChange` are the
  // MODEL's own words coming back to it, and both notes are ours. A fence
  // would teach a reader that the mark means nothing (`defineTool`'s `taint`).
  run: (input, deps) => {
    const granted = deps.escalation.request({ reason: input.reason, intendedChange: input.intendedChange });
    return { granted, note: granted ? GRANTED_NOTE : ALREADY_NOTE };
  },
});

export const ESCALATION_TOOLS = [escalateTool] as const;
