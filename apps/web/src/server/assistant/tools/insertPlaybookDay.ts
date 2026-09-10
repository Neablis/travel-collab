// ADR-042 Decision 3's one hand-written write tool.
//
// **One tool here is not derived, and exactly one.** The rest of the write half
// IS derived — `planning.ts`, the family emitted from `@tc/contracts` command
// schemas (ADR-015 invariant 5, ADR-022 §4: "M9's write tools return by
// wrapping that pipeline from inside the agent, not by reimplementing it").
// `insert_playbook_day` is hand-written, which ADR-042 Decision 3 permits on a
// narrow reading: it takes a `savedDayId` and nothing else, executes no
// command, and the commands it eventually becomes are minted SERVER-side by
// `insertCommands` at approval. So ADR-022's argument transfers unchanged —
// there is nothing for its schema to drift from. A hand-written write tool
// that carried command fields from the model is still forbidden.
import { z } from "zod";
import { readableSavedDay } from "@/server/savedDays";
import { MAX_PROPOSAL_INSERTS } from "@/server/ai/limits";
import { defineTool } from "@/server/assistant/defineTool";

/** ADR-042 Decision 3's one hand-written write tool. */
export const INSERT_PLAYBOOK_DAY = "insert_playbook_day";

/**
 * The whole of what the model may say about an insert.
 *
 * One field, and it names a row rather than describing one — which is the
 * narrow reading ADR-042 Decision 3 permits a hand-written write tool under.
 * No `tripId` (ADR-022 §3, and the trip arrives from the URL at apply), no day
 * position, no stop list: everything about WHAT gets inserted comes from
 * `insertCommands` reading the row.
 *
 * `.min(1)` rather than `.uuid()` on purpose. A malformed id is a
 * hallucination like any other, and `readableSavedDay` already answers every
 * flavour of unreachable — never existed, not yours, withdrawn, not even a
 * uuid — with the same "no row". Validating the shape here would tell the
 * model which kind of wrong it was.
 */
export const InsertPlaybookDayInput = z.object({
  savedDayId: z
    .string()
    .min(1)
    .describe("The `savedDayId` of a day search_playbooks returned. Never write or guess one."),
});

// Either the receipt or a refusal the model can act on. Both are results, not
// throws: a thrown tool error ends the turn with nothing the user can act on.
const InsertPlaybookDayOutput = z.union([
  z.object({ queued: z.literal(true), name: z.string(), stopCount: z.number() }),
  z.object({ error: z.string() }),
]);

/**
 * **`insert_playbook_day` is collect-only like every other write tool**, and it
 * resolves the row it was handed before collecting. That read is not
 * decoration: a hallucinated or unreadable id fails HERE, at propose time, with
 * a message the model can act on in the same turn — rather than surfacing as a
 * 404 after the user has already clicked Approve on a card naming a day that
 * was never reachable. The apply door re-reads regardless (`commitProposal`);
 * this one is for the model, that one is the guarantee.
 *
 * `needs` names both halves of what it touches, and they are exactly the two
 * things a hand-written write tool has to be audited for: WHO it reads the
 * library as (`actor` — the trip is not this tool's business, so it is not
 * declared) and WHERE the intent lands (`proposalBuffer`).
 */
export const insertPlaybookDayTool = defineTool({
  name: INSERT_PLAYBOOK_DAY,
  description:
    "Propose adding a whole day from the playbook library to this trip — every stop it holds, in order, as a new day at the end. Pass a `savedDayId` that search_playbooks returned; never invent one, and propose at most ONE day per turn. Like every other change tool this only DRAFTS: the day is inserted when the user approves.",
  domain: "library",
  effect: "propose",
  spend: "none",
  input: InsertPlaybookDayInput,
  output: InsertPlaybookDayOutput,
  needs: ["actor", "proposalBuffer"] as const,
  minimumRole: "editor",
  run: async ({ savedDayId }, deps) => {
    // The collector's own ceiling, so the cap holds on both sides of the
    // stream: `/ask/apply` refuses an over-cap approval (limits.ts), and a
    // turn cannot draft a card that would be refused. Refused as a tool
    // result rather than a throw — the model can read it and stop.
    if (deps.proposalBuffer.inserts().length >= MAX_PROPOSAL_INSERTS) {
      return {
        error: `You have already queued ${MAX_PROPOSAL_INSERTS} playbook days, which is the most one proposal may carry. Stop and tell the user what you have drafted.`,
      };
    }
    const saved = await readableSavedDay(savedDayId, deps.actor.userId);
    if (saved === null) {
      return {
        error:
          "There is no playbook day with that id that you can open. Call search_playbooks and use a savedDayId from its results.",
      };
    }
    deps.proposalBuffer.addInsert({ savedDayId: saved.savedDayId, name: saved.name, stopCount: saved.stops.length });
    return { queued: true as const, name: saved.name, stopCount: saved.stops.length };
  },
});
