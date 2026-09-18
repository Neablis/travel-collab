"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
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

/**
 * **How it got there, as one line until asked** (design §2b, SPEC §30.5).
 *
 * The tool notes used to be a flat, always-visible list above every answer.
 * Collapsed, they are `"<n> steps · <the last one>"` behind a disclosure.
 *
 * **The summary is derived, not captured, and that is load-bearing.** These
 * lines are the visible "something is happening" during a stream — the whole
 * reason they exist is that a conversation which silently pauses for four
 * seconds reads as broken. Collapsed to a snapshot taken when the first step
 * arrived, streaming would look stalled again in a new way. Reading
 * `tools[tools.length - 1]` on every render is what keeps the line moving.
 *
 * **The bordered container stays.** §30.5 is explicit that this is a
 * disclosure, not a third voice, and the border is what says so.
 *
 * No `role` and no live region: a second one nested inside the log is finding 4
 * of the 2026-08-29 branch review, and `aria-expanded` on a real button is
 * already the whole announcement a screen reader needs here.
 */
function ToolSteps({ tools }: { tools: readonly ToolNote[] }) {
  const [open, setOpen] = useState(false);
  const last = tools[tools.length - 1];
  if (last === undefined) return null;

  return (
    <div className="rounded-md border border-hairline px-2.5 py-1.5">
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={open}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        // `h-auto` undoes `sm`'s fixed height so a wrapped summary grows
        // instead of spilling; `px-0` keeps the label flush with the list it
        // reveals, so expanding does not shift the text sideways.
        className="h-auto w-full justify-between gap-2 px-0 text-left text-xs font-normal"
      >
        <span>
          {open
            ? "Hide how it got there"
            : `${tools.length} ${tools.length === 1 ? "step" : "steps"} · ${last.label}`}
        </span>
        <span aria-hidden>{open ? "⌃" : "⌄"}</span>
      </Button>
      {open && (
        <ul className="mt-1.5 flex flex-col gap-0.5">
          {tools.map((tool) => (
            <li key={tool.id} className="text-xs text-slate">
              {tool.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * **This component does not scroll.** It has no scrollport — its consumers do
 * (`AssistantRail`'s `overflow-y-auto` column, and the New-trip sheet's
 * thread). It used to call `scrollIntoView({ block: "end" })` on a trailing
 * div, which moves EVERY scrollable ancestor rather than the intended one:
 * banned repo-wide by SPEC §30.6, and KI-2026-09-13-a is an open bug in that
 * family. Pinning is `usePinToBottom`, called by whoever owns the scrollport.
 */
export function Transcript({
  turns,
  onApproveProposal = () => {},
  onRejectProposal = () => {},
  approvalBlockedReason = null,
  renderTurnFooter,
  look = "prose",
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
  /**
   * **An optional slot under each turn, whose contents this component never
   * learns about.** The New-trip flow needs a "Change" control under every
   * answered turn; "Change" has no meaning in the assistant panel (design §3),
   * so the shared component takes a render prop instead of the word.
   *
   * Optional, and `AssistantRail` passes nothing — it renders exactly as before.
   */
  renderTurnFooter?: (turn: AssistantTurn) => ReactNode;
  /**
   * **Which of the two transcript treatments to draw** (SPEC §31.1).
   *
   * `"prose"` is §30.5 and the default: no containers anywhere, the two voices
   * told apart by type. It is what the desktop panel and the phone Ask sheet
   * use, and passing nothing keeps them byte-identical to before this prop
   * existed.
   *
   * `"chat"` is the new-trip sheet, and only that. The divergence is decided
   * rather than accidental: there, half the transcript is two- and three-word
   * answers, and at that length a left-ruled quote is indistinguishable from a
   * caption. So the reader's turns become right-aligned bubbles and the
   * assistant gains a mark. §31.1 is explicit that this does NOT spread to the
   * other two surfaces.
   */
  look?: "prose" | "chat";
}) {
  const chat = look === "chat";
  return (
    <>
      {/* `aria-live="off"` is explicit and load-bearing: `role="log"` carries
          an IMPLICIT polite live region, so leaving the attribute off would
          not turn the announcements off — only stop saying so. The one region
          that does announce is below, outside the mutating content. */}
      <div
        role="log"
        aria-label="Conversation"
        aria-live="off"
        className={chat ? "flex flex-col gap-a-turn-chat" : "flex flex-col gap-a-turn"}
      >
      {turns.map((turn) =>
        turn.role === "user" ? (
          // **No bubble** (design §2a, SPEC §30.5). A 2px rule and an indent,
          // not a filled box — and not right-aligned either, because a rule on
          // the left of a right-aligned block points at nothing.
          //
          // The bubble was `rounded-md bg-brand-tint … text-ink`, and removing
          // it is what the theme contract above `--color-a-you-ink` exists for:
          // in `nightdesk` that pairing was near-white ink on a dark green
          // fill, and ink that was legible ON the fill has to stay legible on
          // the panel once the fill is gone. `transcriptLook.test.ts` measures
          // that for all four looks rather than trusting this comment.
          //
          // No max-width utility: an arbitrary Tailwind value trips the design
          // wall (scripts/check-color-wall.mjs), and the rail is 356px wide —
          // the column's own sizing is the cap.
          chat ? (
            // **§31.1 — a right-aligned bubble, and the notch marks the side.**
            // This is the one surface that keeps a filled message box; the
            // theme contract below still forbids looks from adding one to the
            // prose treatment, which is what `transcriptLook.test.ts` measures.
            <div key={turn.id} className="flex flex-col items-end gap-1">
              <p className="max-w-a-you rounded-a-bubble border border-hairline bg-moss px-a-bubble-x py-a-bubble-y text-right text-a-chat leading-a-you text-ink">
                {turn.text}
              </p>
              {renderTurnFooter?.(turn)}
            </div>
          ) : (
          <div key={turn.id} className="flex flex-col gap-1.5">
            <p className="border-l-2 border-a-you-rule pl-a-indent text-sm leading-a-you text-a-you-ink">
              {turn.text}
            </p>
            {renderTurnFooter?.(turn)}
          </div>
          )
        ) : (
          <div key={turn.id} className={chat ? "flex gap-2" : "flex flex-col gap-1.5"}>
            {/* **The mark is what makes a one-line question read as the other
                party rather than as a form label** (§31.1). `aria-hidden`: the
                role is already carried by the log's turn order, and a screen
                reader announcing "C" before every assistant line would be
                noise. It is the assistant's only ornament — no name, no
                timestamp. */}
            {chat && (
              <span
                aria-hidden
                className="flex size-a-mark shrink-0 items-center justify-center rounded-sm bg-brand font-mono text-xs text-paper"
              >
                C
              </span>
            )}
            <div className={chat ? "flex min-w-0 max-w-a-asst flex-col gap-1.5" : "contents"}>
            <ToolSteps tools={turn.tools} />
            {turn.text !== "" && (
              // `whitespace-pre-wrap`: the answer arrives as one text part
              // whose deltas concatenate with their spacing intact. Rendering
              // each delta as its own paragraph would break sentences in half.
              //
              // No container at all (§2a) — it already had none, so this is a
              // type change rather than a structural one: 14px/1.65 in place of
              // `text-sm leading-relaxed`.
              <p className="whitespace-pre-wrap text-base leading-a-asst text-a-asst-ink">
                {turn.text}
              </p>
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
            {renderTurnFooter?.(turn)}
            </div>
          </div>
        ),
      )}
      </div>
      {/* The one live region. `sr-only` because everything it says is already
          on screen — its job is timing, not content a sighted user is missing. */}
      <p role="status" aria-atomic className="sr-only">
        {announcementFor(turns)}
      </p>
    </>
  );
}
