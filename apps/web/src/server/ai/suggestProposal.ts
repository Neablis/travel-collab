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
import {
  CreateSuggestionInput,
  SNAPSHOT_NAME_MAX,
  SUGGESTION_UNITS_MAX,
  type AskStreamMetadata,
  type AssistantProposal,
} from "@tc/contracts";
import { recordAskOutcomeMetrics } from "@/server/ai/aiMetrics";
import { deleteSnapshot, saveSnapshot } from "@/server/snapshots/snapshots";
import { createSuggestion } from "@/server/suggestions/create";
import type { SuggestionErrorCode } from "@/server/suggestions/shared";

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
 * How a planning turn that proposed something ended, for the `ai.ask.outcome`
 * line (`recordAskOutcome`): its card, a stored suggestion, or a card because
 * storing was refused — with the refusal's code, a bounded set.
 */
export type ProposalOutcome =
  | { kind: "card" }
  | { kind: "suggested"; changeCount: number; snapshot: "saved" | "skipped" }
  | { kind: "notSuggested"; code: NotSuggestedCode };

/**
 * Why a multi-change proposal stayed a card: one of `createSuggestion`'s
 * refusal codes, `too-many-changes` (more than a suggestion holds),
 * `unsupported-command` (a command no suggestion may hold — `DismissConflict`,
 * spec W3), or `error` (something threw).
 */
export type NotSuggestedCode = SuggestionErrorCode | "too-many-changes" | "unsupported-command" | "error";

const INSTEAD = "So they are here to review instead of on the board.";

/**
 * Store a multi-change proposal as ONE suggestion `via: "assistant"`, authored
 * by the person who asked, with a snapshot saved before it. Answers the final
 * chunk — `suggested`, or the card — and how the turn ended, for telemetry.
 *
 * **Each command is one change.** The proposal's commands are already resolved
 * against the trip in order, so `createSuggestion` dry-runs each on the one
 * before it, writes its History sentence (spec W2) and computes which earlier
 * change it builds on — the day an `AddActivity` lands on, say. That is the
 * dependency walk a suggester's draft gets; nothing here repeats it. What the
 * resolver skipped is in no change, so it rides on the outcome to be said.
 *
 * **A refusal falls back to the card, so the user loses nothing.** The trip at
 * its 200-change cap, a turn of more than 50 changes, a command a suggestion
 * cannot hold, a command the dry run no longer takes, a lapse that capped the
 * asker to viewer, or a throw: the proposal comes back as ADR-022's card with
 * `notSuggested` saying why, and the snapshot this call saved is deleted again
 * — best effort after a throw — so nothing is stored (decision 3).
 */
export async function suggestProposal(
  proposal: AssistantProposal,
  { tripId, userId, question }: { tripId: string; userId: string; question: string },
): Promise<{ metadata: AskStreamMetadata; outcome: ProposalOutcome }> {
  const card = (code: NotSuggestedCode, reason: string) => ({
    metadata: { proposal: { ...proposal, notSuggested: `${reason} ${INSTEAD}` } },
    outcome: { kind: "notSuggested" as const, code },
  });
  const input = CreateSuggestionInput.safeParse({ units: proposal.commands.map((command) => ({ commands: [command] })) });
  if (!input.success) {
    return proposal.commands.length > SUGGESTION_UNITS_MAX
      ? card(
          "too-many-changes",
          `These are ${proposal.commands.length} changes, and one suggestion holds at most ${SUGGESTION_UNITS_MAX}.`,
        )
      : // The unit schema's own sentence ("A suggestion cannot dismiss a
        // conflict; only an editor can."), so the reason is the rule's.
        card("unsupported-command", input.error.issues[0]?.message ?? "A suggestion cannot hold one of these changes.");
  }

  let snapshotId: string | null = null;
  try {
    // Before the suggestion, as decision 6 says: its `seq` is the head the
    // suggestion's changes were checked against. A trip at its snapshot cap
    // still gets the suggestion, and the chat says the snapshot was skipped.
    const snapshot = await saveSnapshot(tripId, userId, { name: snapshotNameFor(question) });
    if (snapshot.ok) snapshotId = snapshot.value.id;
    const created = await createSuggestion(tripId, userId, input.data, undefined, { via: "assistant" });
    if (!created.ok) {
      if (snapshotId !== null) await deleteSnapshot(tripId, snapshotId, userId);
      return card(created.error.code, created.error.message);
    }
    const [first] = created.value;
    return {
      metadata: {
        suggested: {
          suggestionId: first!.suggestionId,
          changeCount: created.value.length,
          snapshotId,
          snapshotName: snapshot.ok ? snapshot.value.name : null,
          ...(snapshot.ok ? {} : { snapshotSkipped: snapshot.error.message }),
          skipped: proposal.skipped,
        },
      },
      outcome: { kind: "suggested", changeCount: created.value.length, snapshot: snapshot.ok ? "saved" : "skipped" },
    };
  } catch (error) {
    // A throw here runs inside the response stream, where it would cost the
    // turn its answer (KI-2026-09-24-w). The card is still a right answer, and
    // the snapshot saved for a suggestion that never landed is taken back.
    console.error("ask: storing a multi-change proposal as a suggestion failed", { tripId, error });
    if (snapshotId !== null) {
      await deleteSnapshot(tripId, snapshotId, userId).catch((cleanup: unknown) =>
        console.error("ask: deleting the snapshot of a failed suggestion failed", { tripId, snapshotId, cleanup }),
      );
    }
    return card("error", "These changes could not be put on the board just now.");
  }
}

/**
 * One planning turn's outcome — `ai.ask.outcome` — written once the final
 * chunk is settled, which is after `ai.ask` itself: that record is finished in
 * the agent's `onEnd`, before anything is stored. Joined to it by `turnId`.
 * `console.info` like `ai.ask` and `ai.proposal.apply`, plus a bounded counter
 * (`recordAskOutcomeMetrics`). Never throws.
 */
export interface AskOutcomeRecord {
  event: "ai.ask.outcome";
  turnId: string;
  tripId: string;
  userId: string;
  /** `card`, `suggested`, or `notSuggested:<code>`. */
  outcome: string;
  commandCount: number;
  /** Changes stored, for `suggested`; null otherwise. */
  changeCount: number | null;
  /** For `suggested`: whether the snapshot was saved or skipped at the cap. */
  snapshot: "saved" | "skipped" | null;
}

/** `ai.ask.outcome` for `outcome`, as the log line and the counter carry it. */
export function askOutcomeRecord(
  ids: { turnId: string; tripId: string; userId: string },
  commandCount: number,
  outcome: ProposalOutcome,
): AskOutcomeRecord {
  return {
    event: "ai.ask.outcome",
    ...ids,
    outcome: outcome.kind === "notSuggested" ? `notSuggested:${outcome.code}` : outcome.kind,
    commandCount,
    changeCount: outcome.kind === "suggested" ? outcome.changeCount : null,
    snapshot: outcome.kind === "suggested" ? outcome.snapshot : null,
  };
}

/** Write one `ai.ask.outcome`: the log line, then its counter. Never throws. */
export function recordAskOutcome(record: AskOutcomeRecord): void {
  try {
    console.info(record.event, record);
    recordAskOutcomeMetrics(record);
  } catch {
    // Telemetry never costs a turn its answer.
  }
}
