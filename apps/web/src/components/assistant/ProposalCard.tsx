"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AssistantProposal } from "@/lib/apiClient";

/**
 * Where a proposal is in its life. Four states, and the two that matter are
 * terminal in opposite directions:
 *
 *   * `pending` — the assistant has drafted it; the trip is untouched.
 *   * `applying` — Approve was clicked and the batch is in flight.
 *   * `applied` — one atomic batch committed (ADR-013), one undo.
 *   * `rejected` — the user said no. **Nothing happened**: rejecting is the
 *     apply endpoint not being called, not an operation that undoes one.
 *   * `failed` — the batch was refused (a stale ref, a lost race). The trip is
 *     unchanged, and the card says which.
 */
export type ProposalStatus = "pending" | "applying" | "applied" | "rejected" | "failed";

export interface ProposalState {
  proposal: AssistantProposal;
  status: ProposalStatus;
  /** The server's derived receipt once applied, or the reason it was refused. */
  note: string | null;
}

/**
 * The review step of propose → review → approve (M9, ADR-022's Consequences).
 *
 * Everything on this card is the SERVER's description of already-resolved
 * commands (`writeTools.ts`), never the model's narration and never a client
 * reading of a command object: a card that described the change differently
 * from the batch that applies is the whole failure this step exists to prevent.
 *
 * The changes are listed one per line rather than summarised, because the
 * decision the user is being asked for is per-change even though the commit is
 * all-or-nothing — "add two stops to day 3" is approvable; "some changes" is
 * not.
 */
export function ProposalCard({
  state,
  onApprove,
  onReject,
  disabled = false,
  disabledReason = null,
}: {
  state: ProposalState;
  onApprove: () => void;
  onReject: () => void;
  /** True when approving is not available right now (view-only, or unsent edits queued). */
  disabled?: boolean;
  disabledReason?: string | null;
}) {
  const { proposal, status, note } = state;
  const pending = status === "pending" || status === "failed";

  return (
    <section
      aria-label="Proposed change"
      className="flex flex-col gap-2 rounded-md border border-border-strong bg-paper px-2.5 py-2"
    >
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-semibold text-ink">Proposed change</span>
        {status === "applied" ? (
          <Badge variant="success">Applied</Badge>
        ) : status === "rejected" ? (
          <Badge variant="neutral">Rejected</Badge>
        ) : (
          // Said out loud, in the one place the user decides: the sentence
          // above this card is the model's, and a model's word for what it has
          // done is not evidence.
          <Badge variant="warning">Not applied yet</Badge>
        )}
      </div>

      <ul aria-label="Changes" className="flex flex-col gap-0.5">
        {proposal.changes.map((change, index) => (
          // The index is part of the key because two identical changes in one
          // batch ("add a day", "add a day") are legitimate and distinct.
          <li key={`${change.type}-${index}`} className="text-xs text-ink">
            <span aria-hidden>· </span>
            {change.text}
          </li>
        ))}
      </ul>

      {proposal.skipped.length > 0 && (
        <ul aria-label="Skipped changes" className="flex flex-col gap-0.5">
          {proposal.skipped.map((reason) => (
            <li key={reason} className="text-xs text-slate">
              {reason}
            </li>
          ))}
        </ul>
      )}

      {note !== null && (
        <p className={status === "failed" ? "text-xs text-danger" : "text-xs text-slate"} role="status">
          {note}
        </p>
      )}

      {status === "rejected" && (
        <p className="text-xs text-slate" role="status">
          Discarded — nothing on the trip changed.
        </p>
      )}

      {pending && (
        <>
          {disabled && disabledReason !== null && (
            <p className="text-xs text-slate" role="status">
              {disabledReason}
            </p>
          )}
          <div className="flex gap-1.5">
            <Button variant="primary" size="sm" onClick={onApprove} disabled={disabled}>
              Approve
            </Button>
            <Button variant="ghost" size="sm" onClick={onReject}>
              Reject
            </Button>
          </div>
        </>
      )}

      {status === "applying" && (
        <p className="text-xs text-slate" role="status">
          Applying…
        </p>
      )}
    </section>
  );
}
