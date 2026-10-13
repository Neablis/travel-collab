"use client";
import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import type { ChatLink } from "@tc/contracts";
import { useBoardFocus, type BoardFocus } from "@/components/trip/context/boardFocus";
import { cn } from "@/lib/cn";

/** A day or stop the composer can link, as the board names it. */
export type PickerTarget = ChatLink & { label: string };

/** How many rows the picker shows: a completion, not a browser. */
const ROWS = 8;
/** The mention being typed: an `@` at the start or after a space, and what follows it to the end. */
const MENTION = /(^|\s)@([^@\n]*)$/;

/**
 * The board's days and stops matching `query`, days first, each in the board's
 * order. A row matches on its kind and its name together, so *@day* lists the
 * days and *@stop* the stops, and *@col* finds the Colosseum. A parked stop is
 * left out, as its chip would be (`resolveLink`).
 */
export function pickerTargets(board: Pick<BoardFocus, "days" | "stops"> | null, query: string): PickerTarget[] {
  if (board === null) return [];
  const all: PickerTarget[] = [
    ...board.days.map((day) => ({ kind: "day" as const, id: day.dayId, label: day.label })),
    ...board.stops.flatMap((stop) => (stop.dayId === null ? [] : [{ kind: "stop" as const, id: stop.activityId, label: stop.label }])),
  ];
  const wanted = query.trim().toLowerCase();
  return all.filter((target) => `${target.kind} ${target.label}`.toLowerCase().includes(wanted)).slice(0, ROWS);
}

/**
 * The composer's *@day* / *@stop* picker (M46 D3), keyboard first: typing `@`
 * offers this board's days and stops under the field, ↑/↓ move, Enter or Tab
 * writes `@<name>` into the draft, Escape closes. A message carries one link,
 * the last one picked, and only while its `@<name>` is still in the words.
 *
 * The field keeps focus throughout and points `aria-activedescendant` at the
 * active row, as the notebook's slash menu does.
 */
export function useTargetPicker(draft: string, setDraft: (next: string) => void) {
  const board = useBoardFocus();
  const listId = useId();
  const [closedAt, setClosedAt] = useState<number | null>(null);
  const [active, setActive] = useState({ query: "", index: 0 });
  const [picked, setPicked] = useState<PickerTarget | null>(null);

  const match = MENTION.exec(draft);
  const at = match === null ? null : match.index + match[1]!.length;
  const query = match?.[2] ?? "";
  // Closed for the `@` it was picked or dismissed at, until that `@` is deleted.
  const targets = at === null || (at === closedAt && draft[closedAt] === "@") ? [] : pickerTargets(board, query);
  const open = targets.length > 0;
  const index = active.query === query ? Math.min(active.index, targets.length - 1) : 0;
  const optionId = (i: number) => `${listId}-${i}`;

  const pick = (target: PickerTarget) => {
    if (at === null) return;
    setDraft(`${draft.slice(0, at)}@${target.label} `);
    setPicked(target);
    setClosedAt(at);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!open) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive({ query, index: (index + step + targets.length) % targets.length });
    } else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      pick(targets[index]!);
    } else if (event.key === "Escape") {
      // The picker's, not the sheet's around it.
      event.preventDefault();
      event.stopPropagation();
      setClosedAt(at);
    }
  };

  const list: ReactNode = open ? (
    <ul
      id={listId}
      role="listbox"
      aria-label="Days and stops"
      className="overlay-layer absolute inset-x-0 bottom-full mb-1 max-h-72 overflow-y-auto rounded-md border border-hairline bg-surface py-1 shadow-overlay"
    >
      {targets.map((target, i) => (
        <li
          key={`${target.kind}:${target.id}`}
          id={optionId(i)}
          role="option"
          aria-selected={i === index}
          className={cn("flex cursor-pointer items-baseline gap-2 px-3 py-1.5 text-sm text-ink", i === index && "bg-brand-tint")}
          // `onMouseDown`, default prevented: the field keeps focus, and with it the draft's end.
          onMouseDown={(event) => {
            event.preventDefault();
            pick(target);
          }}
        >
          <span className="w-8 shrink-0 text-xs text-slate">{target.kind === "day" ? "Day" : "Stop"}</span>
          <span className="truncate">{target.label}</span>
        </li>
      ))}
    </ul>
  ) : null;

  return {
    inputProps: {
      onKeyDown,
      "aria-autocomplete": "list" as const,
      "aria-controls": open ? listId : undefined,
      "aria-activedescendant": open ? optionId(index) : undefined,
    },
    list,
    /** The link to send with `body`: the last pick, while its mention is still there. */
    linkFor: (body: string): ChatLink | undefined => (picked !== null && body.includes(`@${picked.label}`) ?{ kind: picked.kind, id: picked.id } : undefined),
    /** After a send: a new message starts with no link. */
    clear: () => {
      setPicked(null);
      setClosedAt(null);
    },
  };
}
