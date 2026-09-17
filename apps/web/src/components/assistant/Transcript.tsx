"use client";

import { useEffect, useRef } from "react";
import { ProposalCard, type ProposalState } from "./ProposalCard";

/** One line of "showing its work" — a tool call, rendered as a sentence. */
export type ToolNote = { id: string; label: string };

/**
 * A turn in the conversation. Client-held: there is no conversations table and
 * no migration in this plan (Ruling R1), so this array IS the thread — it is
 * posted back in full on every turn and lives only as long as the board screen
 * is mounted.
 */
export type AssistantTurn =
  | { id: string; role: "user"; text: string }
  | {
      id: string;
      role: "assistant";
      text: string;
      tools: ToolNote[];
      pending: boolean;
      /**
       * The turn's proposal, once the stream's final chunk carried one (M9).
       * Optional rather than a third union member: a proposal belongs TO an
       * answer — the prose above it says what would change and the card is
       * where it is decided — and splitting them would let a transcript render
       * one without the other.
       */
      proposal?: ProposalState | null;
    };

/**
 * A tool call, said in one line. The full tool output is on the wire (a
 * trip-scoped `read_trip` on a 14-day trip is ~1.5 KB of JSON) and none of it
 * belongs on screen: the point of showing tool calls at all is that a
 * conversation which silently pauses for four seconds reads as broken, and one
 * quiet sentence fixes that where a JSON dump would replace it with a
 * different kind of broken.
 *
 * Day numbers arrive from the tools 1-based already (`readTools.ts` converts
 * once, server-side) — nothing here adds one.
 *
 * `read_day`'s `days` field is a bare number OR a list (`readTools.ts`'s
 * `ReadDayInput`) — a real model asking for several days in the ONE call this
 * whole change exists to make possible still deserves a note that says so,
 * rather than falling through to the single-day label or the empty one.
 */
function readDayNumbers(value: unknown): number[] | undefined {
  if (typeof value === "number") return [value];
  if (Array.isArray(value) && value.every((v) => typeof v === "number")) return value as number[];
  return undefined;
}

export function toolNoteLabel(toolName: string, input: unknown): string {
  const record = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : undefined;
  const day = typeof record?.day === "number" ? record.day : undefined;
  const onDay = typeof day === "number" ? ` on day ${day}` : "";
  switch (toolName) {
    case "read_trip":
      return "Read the trip";
    case "read_day": {
      const days = readDayNumbers(record?.days);
      if (days === undefined) return "Checked the day you're looking at";
      return days.length === 1 ? `Checked day ${days[0]}` : `Checked days ${days.join(", ")}`;
    }
    case "find_free_time":
      return `Looked for free time${onDay}`;
    default:
      // The write tools (M9) are the DERIVED planning tools, so their names are
      // the `BatchableCommand` type literals — PascalCase, where every read
      // tool is snake_case. That is the actual naming convention of the two
      // families (planningTools.ts vs readTools.ts), not a guess about this
      // one string, and it means a thirteenth command reads correctly here
      // without a second manifest to update. What the change IS belongs on the
      // proposal card underneath, which describes the resolved command; this
      // line only exists so the pause while the model drafts does not read as
      // the conversation having stopped.
      if (/^[A-Z]/.test(toolName)) return "Drafted a change";
      // A read tool this build has never heard of still gets a civil sentence
      // rather than a blank line.
      return `Used ${toolName.replace(/_/g, " ")}${onDay}`;
  }
}

/**
 * What a screen reader is told, and when.
 *
 * The transcript itself is NOT a live region. It used to be: `role="log"
 * aria-live="polite"` wrapped text that mutates on every streamed delta, with a
 * nested `role="status"` interleaved among the turns. A polite region
 * re-announces its changed contents, so a growing answer was read out again
 * from the top on every token — worse than no live region at all, because it
 * buries whatever the user was actually listening to (final branch review,
 * 2026-08-29, finding 4, rated above where it was first filed).
 *
 * So: announce turn BOUNDARIES and completion, never deltas. This returns one
 * of a small set of strings, and — the load-bearing part — the two "in
 * progress" strings are CONSTANTS. A turn that has streamed nine words and one
 * that has streamed nine hundred produce the same announcement, so nothing is
 * re-announced while it is still arriving. The finished answer is announced
 * exactly once, when it is finished and worth hearing.
 */
function announcementFor(turns: readonly AssistantTurn[]): string {
  const last = turns[turns.length - 1];
  if (last === undefined || last.role !== "assistant") return "";
  if (last.pending) {
    return last.text === "" && last.tools.length === 0 ? "Thinking…" : "Writing the answer…";
  }
  if (last.text === "") return "";
  const proposal =
    last.proposal != null && last.proposal.status === "pending"
      ? " A proposed change is waiting for your review below."
      : "";
  return `Answer: ${last.text}${proposal}`;
}

export function Transcript({
  turns,
  onApproveProposal = () => {},
  onRejectProposal = () => {},
  approvalBlockedReason = null,
}: {
  turns: AssistantTurn[];
  /** Commits the turn's proposal as one atomic batch. Keyed by turn id. */
  onApproveProposal?: (turnId: string) => void;
  /** Discards it. Nothing is sent — see ProposalCard's `rejected` state. */
  onRejectProposal?: (turnId: string) => void;
  /**
   * Why approving is unavailable right now, or `null`. Read once for every
   * card: the two reasons (view-only access, unsent edits still queued) are
   * properties of the board, not of a proposal.
   */
  approvalBlockedReason?: string | null;
}) {
  const endRef = useRef<HTMLDivElement | null>(null);

  // Follow the answer as it streams. A transcript that does not scroll makes
  // streaming look like it stopped — the tokens are arriving below the fold.
  // `scrollIntoView` is absent in jsdom, so the guard is load-bearing for the
  // unit suite as well as for anything without a layout engine.
  useEffect(() => {
    const node = endRef.current;
    if (node !== null && typeof node.scrollIntoView === "function") {
      node.scrollIntoView({ block: "end" });
    }
  }, [turns]);

  return (
    <>
      {/* `aria-live="off"` is explicit and load-bearing: `role="log"` carries
          an IMPLICIT polite live region, so leaving the attribute off would
          not turn the announcements off — only stop saying so. The one region
          that does announce is below, outside the mutating content. */}
      <div role="log" aria-label="Conversation" aria-live="off" className="flex flex-col gap-3">
      {turns.map((turn) =>
        turn.role === "user" ? (
          <div key={turn.id} className="flex justify-end">
            {/* No max-width utility: an arbitrary Tailwind value trips the
                design wall (scripts/check-color-wall.mjs), and the rail is
                356px wide — the flex row's own sizing is the cap. */}
            <p className="rounded-md bg-brand-tint px-2.5 py-1.5 text-sm leading-relaxed text-ink">
              {turn.text}
            </p>
          </div>
        ) : (
          <div key={turn.id} className="flex flex-col gap-1.5">
            {turn.tools.length > 0 && (
              <ul className="flex flex-col gap-0.5">
                {turn.tools.map((tool) => (
                  <li key={tool.id} className="text-xs text-slate">
                    <span aria-hidden>· </span>
                    {tool.label}
                  </li>
                ))}
              </ul>
            )}
            {turn.text !== "" && (
              // `whitespace-pre-wrap`: the answer arrives as one text part
              // whose deltas concatenate with their spacing intact. Rendering
              // each delta as its own paragraph would break sentences in half.
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{turn.text}</p>
            )}
            {turn.proposal != null && (
              <ProposalCard
                state={turn.proposal}
                onApprove={() => onApproveProposal(turn.id)}
                onReject={() => onRejectProposal(turn.id)}
                disabled={approvalBlockedReason !== null}
                disabledReason={approvalBlockedReason}
              />
            )}
            {/* Visible only, and no `role` — a second live region nested
                inside the log is what finding 4 was about. Once text is
                arriving the text IS the progress indicator, so this drops away
                rather than becoming an `sr-only` duplicate of it. */}
            {turn.pending && turn.text === "" && (
              <p className="text-xs text-slate">
                {turn.tools.length === 0 ? "Thinking…" : "Still writing…"}
              </p>
            )}
          </div>
        ),
      )}
      <div ref={endRef} />
      </div>
      {/* The one live region. `sr-only` because everything it says is already
          on screen — its job is timing, not content a sighted user is missing. */}
      <p role="status" aria-atomic className="sr-only">
        {announcementFor(turns)}
      </p>
    </>
  );
}
