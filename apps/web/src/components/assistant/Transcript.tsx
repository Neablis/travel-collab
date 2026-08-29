"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";

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
  | { id: string; role: "assistant"; text: string; tools: ToolNote[]; pending: boolean };

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
 */
export function toolNoteLabel(toolName: string, input: unknown): string {
  const day = typeof input === "object" && input !== null ? (input as { day?: unknown }).day : undefined;
  const onDay = typeof day === "number" ? ` on day ${day}` : "";
  switch (toolName) {
    case "read_trip":
      return "Read the trip";
    case "read_day":
      return typeof day === "number" ? `Checked day ${day}` : "Checked the day you're looking at";
    case "find_free_time":
      return `Looked for free time${onDay}`;
    default:
      // A tool this build has never heard of still gets a civil sentence
      // rather than a blank line — Task 6 adds write tools to this same stream.
      return `Used ${toolName.replace(/_/g, " ")}${onDay}`;
  }
}

export function Transcript({ turns }: { turns: AssistantTurn[] }) {
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
    <div role="log" aria-label="Conversation" aria-live="polite" className="flex flex-col gap-3">
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
            {turn.pending && (
              <p className={cn("text-xs text-slate", turn.text !== "" && "sr-only")} role="status">
                {turn.text === "" && turn.tools.length === 0 ? "Thinking…" : "Still writing…"}
              </p>
            )}
          </div>
        ),
      )}
      <div ref={endRef} />
    </div>
  );
}
