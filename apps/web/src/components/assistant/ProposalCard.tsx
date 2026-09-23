"use client";

import { Button } from "@/components/ui/button";
import type { AssistantProposal, TripHistory } from "@tc/contracts";

/**
 * Where a proposal is in its life. Five states, and the two that matter are
 * terminal in opposite directions:
 *
 *   * `pending` — the assistant has drafted it; the trip is untouched.
 *   * `applying` — *Make the change* was clicked and the batch is in flight.
 *   * `applied` — one atomic batch committed (ADR-013), one undo.
 *   * `rejected` — the user said *Not now*. **Nothing happened**: rejecting is
 *     the apply endpoint not being called, not an operation that undoes one.
 *   * `failed` — the batch was refused (a stale ref, a lost race). The trip is
 *     unchanged, and the card says which.
 */
export type ProposalStatus = "pending" | "applying" | "applied" | "rejected" | "failed";

export interface ProposalState {
  proposal: AssistantProposal;
  status: ProposalStatus;
  /** The server's derived receipt once applied, or the reason it was refused. */
  note: string | null;
  /**
   * The history batch the apply committed, once applied — the head entry of
   * the outcome's own history. It is what lets the card know whether its
   * change is still the trip's last one (M27 D17). Absent before the apply,
   * and on anything applied before this field existed.
   */
  batchId?: string | null;
}

/** What an applied card may say about undoing it — see `proposalUndoFor`. */
export type ProposalUndo = "available" | "changed" | "undone";

/**
 * **Whether an applied card may still offer Undo** (M27 D17).
 *
 * *Undo* dispatches the trip's `UndoLastChange`, which undoes the LAST batch —
 * whoever made it. So it is offered only while this card's batch is still the
 * head of the trip's history. Once anyone has written since, pressing it would
 * undo *their* change, and the card points at History instead.
 *
 * Derived from the history the board already holds, never stored: an undo
 * made from History, or by a collaborator, reads correctly here too.
 *
 * @returns `available`, `changed` or `undone`; `null` when there is nothing
 *   to say — not applied, or no batch recorded.
 */
export function proposalUndoFor(state: ProposalState, history: TripHistory | null): ProposalUndo | null {
  if (state.status !== "applied" || state.batchId == null || history === null) return null;
  const mine = history.entries.find((entry) => entry.batchId === state.batchId);
  if (mine?.undone === true) return "undone";
  const head = history.entries[0];
  return head !== undefined && head.batchId === state.batchId && history.canUndo ? "available" : "changed";
}

/**
 * **The card's words, derived from the proposal** (M27 D16). The contract
 * carries only `changes[].text` — the server's sentence for each resolved
 * command — and widening it so the model could write a title and a button
 * would be a contracts change for words the client can already compose.
 *
 * One change is its own title. Several are counted, and listed underneath,
 * because the decision is per-change even though the commit is all-or-nothing
 * — "add two stops to day 3" is approvable; "some changes" is not. What the
 * server could not match rides in the detail line either way.
 */
export function proposalWords(proposal: AssistantProposal): { title: string; detail: string } {
  const texts = proposal.changes.map((change) => change.text);
  const [only] = texts;
  if (texts.length === 1 && only !== undefined) {
    return { title: only, detail: proposal.skipped.join(" · ") };
  }
  return { title: `${texts.length} changes`, detail: [...texts, ...proposal.skipped].join(" · ") };
}

/**
 * The review step of propose → review → approve (M9, ADR-022's Consequences),
 * drawn as a control rather than a question in prose (SPEC §35.9): *"an
 * action in a chat is a control, not a sentence."*
 *
 * Everything on this card is the SERVER's description of already-resolved
 * commands (`writeTools.ts`), never the model's narration and never a client
 * reading of a command object: a card that described the change differently
 * from the batch that applies is the whole failure this step exists to prevent.
 *
 * **The group outlives the decision.** Settled, it shrinks to one line — what
 * happened, and Undo while that is still honest — but it keeps its name, so
 * the answer's card is still findable as the same thing after it is decided.
 */
export function ProposalCard({
  state,
  onApprove,
  onReject,
  disabled = false,
  disabledReason = null,
  touch = false,
  undo = null,
  onUndo,
}: {
  state: ProposalState;
  onApprove: () => void;
  onReject: () => void;
  /** True when approving is not available right now (view-only, or unsent edits queued). */
  disabled?: boolean;
  disabledReason?: string | null;
  /** The phone sheet: §35.9's 44px targets and 13px radius, where the desktop has 34px and 10px. */
  touch?: boolean;
  /** See `proposalUndoFor`. */
  undo?: ProposalUndo | null;
  onUndo?: () => void;
}) {
  const { proposal, status, note } = state;

  if (status === "applied" || status === "rejected") {
    return (
      <div
        role="group"
        aria-label="Suggested change"
        className="flex min-h-7.5 flex-wrap items-center gap-x-2 gap-y-1 text-a-note"
      >
        {status === "rejected" ? (
          // Nothing happened, so there is nothing to undo — said as such.
          <span role="status" className="text-slate">
            Left as it is.
          </span>
        ) : undo === "undone" ? (
          <span role="status" className="text-slate">
            Put back the way it was.
          </span>
        ) : (
          <>
            <span role="status" className="text-success-ink">
              ✓ {note ?? "Done."}
            </span>
            {undo === "available" && onUndo !== undefined && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onUndo}
                className="h-auto px-0 font-semibold text-ink underline underline-offset-2 hover:bg-transparent"
              >
                Undo
              </Button>
            )}
            {undo === "changed" && <span className="text-slate">Changed since — undo it from History.</span>}
          </>
        )}
      </div>
    );
  }

  const { title, detail } = proposalWords(proposal);
  const applying = status === "applying";
  // `min-h` on both sides of the breakpoint: `Button`'s base releases its
  // phone floor at `md`, and this card's target is its own at every width.
  const target = touch ? "min-h-11 md:min-h-11" : "min-h-8.5 md:min-h-8.5";

  return (
    <div
      role="group"
      aria-label="Suggested change"
      className={`border border-brand bg-brand-tint p-3 ${touch ? "rounded-a-card-touch" : "rounded-a-card"}`}
    >
      <div className="flex items-center gap-1.75">
        <span
          aria-hidden
          className="grid size-4.5 place-items-center rounded-full bg-brand text-2xs font-bold text-surface"
        >
          ↻
        </span>
        {/* Said out loud, in the one place the user decides: the sentence above
            this card is the model's, and a model's word for what it has done is
            not evidence. "Ready when you are" is the not-yet, in §35.9's voice. */}
        <span className="font-mono text-a-label font-semibold uppercase tracking-a-label text-brand-pressed">
          Ready when you are
        </span>
      </div>
      <p className={`pt-1.75 font-semibold text-pretty text-brand-pressed ${touch ? "text-base" : "text-a-chat"}`}>
        {title}
      </p>
      {detail !== "" && (
        <p className="pt-0.5 text-a-note leading-normal text-pretty text-brand-pressed">{detail}</p>
      )}
      {status === "failed" && note !== null && (
        <p role="status" className="pt-1 text-a-note text-danger-ink">
          {note}
        </p>
      )}
      {disabled && disabledReason !== null && (
        <p role="status" className="pt-1 text-a-note text-slate">
          {disabledReason}
        </p>
      )}
      <div className="flex gap-2 pt-2.5">
        <Button
          variant="primary"
          size="sm"
          onClick={onApprove}
          disabled={disabled || applying}
          className={`h-auto flex-1 rounded-full font-semibold ${target}`}
        >
          {applying ? "Applying…" : "Make the change"}
        </Button>
        {/* Always available while the card is open: declining sends nothing. */}
        <Button
          variant="secondary"
          size="sm"
          onClick={onReject}
          disabled={applying}
          className={`h-auto rounded-full border-brand bg-transparent px-3.5 text-brand-pressed hover:bg-brand-tint ${target}`}
        >
          Not now
        </Button>
      </div>
    </div>
  );
}
