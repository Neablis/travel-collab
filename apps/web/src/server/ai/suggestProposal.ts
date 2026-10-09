// **A planning turn of more than one change is stored as a suggestion**
// (ADR-067 decision 4), not returned as a card. This is the one place that
// decides it and does it; `handleAskRequest` calls it once, on the stream's
// final chunk, with the proposal `buildProposal` just resolved.
//
// Every write here is one the asking editor could make by hand (invariant 7):
// *Save snapshot* in the History panel is `saveSnapshot`, and a suggestion is
// `createSuggestion` — the same functions, with the same role checks, run as
// that editor. Nothing is appended to the trip's stream: a pending suggestion
// is not planning state until someone accepts it (ADR-064), and a snapshot is
// a label on a `seq`, not an event.
import { CreateSuggestionInput, SNAPSHOT_NAME_MAX, type AskStreamMetadata, type AssistantProposal } from "@tc/contracts";
import { deleteSnapshot, saveSnapshot } from "@/server/snapshots/snapshots";
import { createSuggestion } from "@/server/suggestions/create";

/**
 * Whether a proposal goes on the board rather than on a card: more than one
 * command and no library insert (ADR-067 decisions 4 and 5). One change has no
 * reviewing problem, and an insert is a saved-day reference the apply door
 * expands, not a command a suggestion can hold.
 */
export function storesAsSuggestion(proposal: AssistantProposal): boolean {
  return proposal.commands.length > 1 && proposal.inserts.length === 0;
}

const SNAPSHOT_PREFIX = "Before: ";

/**
 * The snapshot's name, for the request that made it (decision 6): "Before:
 * add a day in Kyoto", on one line and inside the table's 80 characters.
 */
export function snapshotNameFor(question: string): string {
  const said = question.replace(/\s+/g, " ").trim() || "an assistant change";
  const room = SNAPSHOT_NAME_MAX - SNAPSHOT_PREFIX.length;
  return SNAPSHOT_PREFIX + (said.length <= room ? said : `${said.slice(0, room - 1).trimEnd()}…`);
}

/**
 * Store a multi-change proposal as ONE suggestion `via: "assistant"`, authored
 * by the person who asked, with a snapshot saved before it. Answers the final
 * chunk's `suggested` shape.
 *
 * **Each command is one change.** The proposal's commands are already resolved
 * against the trip in order, so `createSuggestion` dry-runs each on the one
 * before it, writes its History sentence (spec W2) and computes which earlier
 * change it builds on — the day an `AddActivity` lands on, say. That is the
 * dependency walk a suggester's draft gets; nothing here repeats it.
 *
 * **A refusal falls back to the card, so the user loses nothing.** The trip at
 * its 200-change cap, a turn of more than 50 changes, a command the dry run no
 * longer takes, a lapse that capped the asker to viewer: the proposal comes
 * back as ADR-022's card with `notSuggested` saying why, and the snapshot this
 * call saved is deleted again, so nothing at all is stored (decision 3).
 */
export async function suggestProposal(
  proposal: AssistantProposal,
  { tripId, userId, question }: { tripId: string; userId: string; question: string },
): Promise<AskStreamMetadata> {
  const card = (notSuggested: string): AskStreamMetadata => ({ proposal: { ...proposal, notSuggested } });
  const input = CreateSuggestionInput.safeParse({ units: proposal.commands.map((command) => ({ commands: [command] })) });
  if (!input.success) {
    return card(
      `These ${proposal.commands.length} changes are more than one suggestion can hold, so they are here to review instead of on the board.`,
    );
  }

  try {
    // Before the suggestion, as decision 6 says: its `seq` is the head the
    // suggestion's changes were checked against. A trip at its snapshot cap
    // still gets the suggestion, and the chat says the snapshot was skipped.
    const snapshot = await saveSnapshot(tripId, userId, { name: snapshotNameFor(question) });
    const created = await createSuggestion(tripId, userId, input.data, undefined, { via: "assistant" });
    if (!created.ok) {
      if (snapshot.ok) await deleteSnapshot(tripId, snapshot.value.id, userId);
      return card(`${created.error.message} So they are here to review instead of on the board.`);
    }
    const [first] = created.value;
    return {
      suggested: {
        suggestionId: first!.suggestionId,
        changeCount: created.value.length,
        snapshotId: snapshot.ok ? snapshot.value.id : null,
        snapshotName: snapshot.ok ? snapshot.value.name : null,
        ...(snapshot.ok ? {} : { snapshotSkipped: snapshot.error.message }),
      },
    };
  } catch (error) {
    // A throw here runs inside the response stream, where it would cost the
    // turn its answer (KI-2026-09-24-w). The card is still a right answer.
    console.error("ask: storing a multi-change proposal as a suggestion failed", { tripId, error });
    return card("These changes could not be put on the board just now, so they are here to review instead.");
  }
}
