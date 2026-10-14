"use client";
import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import type { ChatLink } from "@tc/contracts";
import { useBoardFocus, type BoardFocus } from "./boardFocus";
import { wholeMention, type ChatMentions } from "./MessageChip";
import { cn } from "@/lib/cn";

/**
 * Something the composer can link: `label` is its row in the picker, as the
 * board names it, and `name` what a pick writes after the `@`, as its chip
 * reads (a day's number without its cities).
 */
export type PickerTarget = ChatLink & { label: string; name: string };

/** How many rows the picker shows: a completion, not a browser. */
const ROWS = 8;
/** The mention being typed: an `@` at the start or after a space, and what follows it to the end. */
const MENTION = /(^|\s)@([^@\n]*)$/;
const KIND_WORD = { day: "Day", stop: "Stop", person: "Person", notebook: "Notebook" } as const;

/**
 * The trip's days, stops, people and notebooks matching `query`, in that
 * order, each in the order its source lists it. A row matches on its kind and
 * its name together, so *@day* lists the days and *@person* the people, and
 * *@col* finds the Colosseum. A parked stop is left out, as its chip would be
 * (`resolveLink`).
 */
export function pickerTargets(
  board: Pick<BoardFocus, "days" | "stops"> | null,
  query: string,
  mentions: Pick<ChatMentions, "personas" | "notebooks"> | null = null,
): PickerTarget[] {
  const all: PickerTarget[] = [
    ...(board?.days ?? []).map((day, i) => ({ kind: "day" as const, id: day.dayId, label: day.label, name: `Day ${i + 1}` })),
    ...(board?.stops ?? []).flatMap((stop) => (stop.dayId === null ? [] : [{ kind: "stop" as const, id: stop.activityId, label: stop.label, name: stop.label }])),
    ...Object.entries(mentions?.personas ?? {}).map(([userId, persona]) => ({ kind: "person" as const, id: userId, label: persona.name, name: persona.name })),
    ...(mentions?.notebooks ?? []).map((notebook) => ({ kind: "notebook" as const, id: notebook.id, label: notebook.title, name: notebook.title })),
  ];
  const wanted = query.trim().toLowerCase();
  return all.filter((target) => `${target.kind} ${target.label}`.toLowerCase().includes(wanted)).slice(0, ROWS);
}

/**
 * The composer's *@* picker (M46 D3, people and notebooks since the walk),
 * keyboard first: typing `@` offers this trip's days, stops, people and
 * notebooks under the field, ↑/↓ move, Enter or Tab writes `@<name>` into the
 * draft, Escape closes. A message carries one link, the last one picked, and
 * only while its `@<name>` is still in the words.
 *
 * The field is the combobox: it keeps focus throughout and points
 * `aria-activedescendant` at the active row, as the notebook's slash menu does.
 */
export function useTargetPicker(draft: string, setDraft: (next: string) => void, mentions: ChatMentions | null = null) {
  const board = useBoardFocus();
  const listId = useId();
  // Where the picker was picked from or dismissed, and the draft as it was then.
  const [closed, setClosed] = useState<{ at: number; draft: string } | null>(null);
  const [active, setActive] = useState({ query: "", index: 0 });
  const [picked, setPicked] = useState<PickerTarget | null>(null);

  // Typing on keeps the draft's start, so that `@` stays closed. Deleting or
  // replacing back into it does not, and an `@` typed there again is a new one.
  if (closed !== null && !draft.startsWith(closed.draft)) setClosed(null);
  const match = MENTION.exec(draft);
  const at = match === null ? null : match.index + match[1]!.length;
  const query = match?.[2] ?? "";
  const targets = at === null || (closed !== null && at === closed.at && draft.startsWith(closed.draft)) ? [] : pickerTargets(board, query, mentions);
  const open = targets.length > 0;
  const index = active.query === query ? Math.min(active.index, targets.length - 1) : 0;
  const optionId = (i: number) => `${listId}-${i}`;

  const pick = (target: PickerTarget) => {
    if (at === null) return;
    const mention = `${draft.slice(0, at)}@${target.name}`;
    setDraft(`${mention} `);
    setPicked(target);
    // Remembered without the space after it, so taking that space back keeps the picker closed.
    setClosed({ at, draft: mention });
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
      if (at !== null) setClosed({ at, draft });
    }
  };

  const list: ReactNode = open ? (
    <ul
      id={listId}
      role="listbox"
      aria-label="Mentions"
      className="overlay-layer absolute inset-x-0 bottom-full mb-1 max-h-72 overflow-y-auto rounded-md border border-hairline bg-surface py-1 shadow-overlay"
    >
      {targets.map((target, i) => (
        <li
          key={`${target.kind}:${target.id}`}
          id={optionId(i)}
          role="option"
          aria-selected={i === index}
          // A finger's row is 44px, as the sheet's composer is.
          className={cn("flex cursor-pointer items-baseline gap-2 px-3 py-1.5 text-sm text-ink pointer-coarse:min-h-11 pointer-coarse:items-center", i === index && "bg-brand-tint")}
          // `onMouseDown`, default prevented: the field keeps focus, and with it the draft's end.
          onMouseDown={(event) => {
            event.preventDefault();
            pick(target);
          }}
        >
          {/* As wide as "Notebook", the longest kind. */}
          <span className="w-14 shrink-0 text-xs text-slate">{KIND_WORD[target.kind]}</span>
          <span className="truncate">{target.label}</span>
        </li>
      ))}
    </ul>
  ) : null;

  return {
    inputProps: {
      onKeyDown,
      role: "combobox" as const,
      "aria-expanded": open,
      "aria-autocomplete": "list" as const,
      "aria-controls": open ? listId : undefined,
      "aria-activedescendant": open ? optionId(index) : undefined,
    },
    list,
    /** The link to send with `body`: the last pick, while its mention is still there. */
    linkFor: (body: string): ChatLink | undefined => (picked !== null && wholeMention(body, `@${picked.name}`) !== -1 ? { kind: picked.kind, id: picked.id } : undefined),
    /** After a send: a new message starts with no link. */
    clear: () => {
      setPicked(null);
      setClosed(null);
    },
  };
}
