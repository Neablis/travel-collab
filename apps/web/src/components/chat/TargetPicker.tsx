"use client";
import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import type { ChatLink } from "@tc/contracts";
import { buttonVariants } from "@/components/ui/button";
import { useBoardFocus, type BoardFocus } from "./boardFocus";
import { wholeMention, type ChatMentions } from "./MessageChip";
import { cn } from "@/lib/cn";

/**
 * Something the composer can name: a link, or the assistant (M52 decision
 * 18), which a message asks rather than links. `label` is its row in the
 * picker, as the board names it, and `name` what a pick writes after the `@`,
 * as its chip reads (a day's number without its cities).
 */
export type PickerTarget = LinkTarget | { kind: "assistant"; id: "assistant"; label: string; name: string };
type LinkTarget = ChatLink & { label: string; name: string };

/** What the composer writes for the assistant, and what makes a message an ask. */
export const ASSISTANT_MENTION = "@assistant";
/** The offer to a reader whose plan has no assistant (M52 decision 18), in `AssistantRail`'s voice. */
export const ASSISTANT_OFFER = "Asking the assistant in chat comes with Plus.";

/** How many rows the picker shows: a completion, not a browser. */
const ROWS = 8;
/** The rows each kind with matches is sure of, so a long trip's days cannot hide its people and notebooks. */
const ROWS_PER_KIND = 2;
const KINDS = ["assistant", "day", "stop", "person", "notebook"] as const;
/** The mention being typed: an `@` at the start or after a space, and what follows it to the end. */
const MENTION = /(^|\s)@([^@\n]*)$/;
/**
 * A message asks the assistant where `@assistant` stands as the picker writes
 * it: after a space or at the start, and not run on into an address
 * (`bookings@assistant.com`), since an ask is a turn on the asker's plan. A
 * full stop that ends the sentence still asks.
 */
const ASKS = /(^|\s)@assistant(?![\p{L}\p{N}_@-]|\.[\p{L}\p{N}])/u;
const KIND_WORD = { assistant: "Ask", day: "Day", stop: "Stop", person: "Person", notebook: "Notebook" } as const;

/**
 * The assistant when `assistant` offers it, then the trip's days, stops,
 * people and notebooks, matching `query`, in that order, each in the order its
 * source lists it. A row matches on its kind and
 * its name together, so *@day* lists the days and *@person* the people, and
 * *@col* finds the Colosseum. A parked stop is left out, as its chip would be
 * (`resolveLink`). Each kind with matches keeps `ROWS_PER_KIND` of the rows,
 * and the rest go to the earlier kinds first.
 */
export function pickerTargets(
  board: Pick<BoardFocus, "days" | "stops"> | null,
  query: string,
  mentions: Pick<ChatMentions, "personas" | "notebooks"> | null = null,
  assistant = false,
): PickerTarget[] {
  const all: PickerTarget[] = [
    ...(assistant ? [{ kind: "assistant" as const, id: "assistant" as const, label: "Assistant", name: ASSISTANT_MENTION.slice(1) }] : []),
    ...(board?.days ?? []).map((day, i) => ({ kind: "day" as const, id: day.dayId, label: day.label, name: `Day ${i + 1}` })),
    ...(board?.stops ?? []).flatMap((stop) => (stop.dayId === null ? [] : [{ kind: "stop" as const, id: stop.activityId, label: stop.label, name: stop.label }])),
    ...Object.entries(mentions?.personas ?? {}).map(([userId, persona]) => ({ kind: "person" as const, id: userId, label: persona.name, name: persona.name })),
    ...(mentions?.notebooks ?? []).map((notebook) => ({ kind: "notebook" as const, id: notebook.id, label: notebook.title, name: notebook.title })),
  ];
  const wanted = query.trim().toLowerCase();
  const groups = KINDS.map((kind) => all.filter((target) => target.kind === kind && `${target.kind} ${target.label}`.toLowerCase().includes(wanted)));
  const take = groups.map((group) => Math.min(group.length, ROWS_PER_KIND));
  let left = ROWS - take.reduce((sum, n) => sum + n, 0);
  groups.forEach((group, i) => {
    const more = Math.min(left, group.length - take[i]!);
    take[i] = take[i]! + more;
    left -= more;
  });
  return groups.flatMap((group, i) => group.slice(0, take[i]));
}

/**
 * The composer's *@* picker (M46 D3, people and notebooks since the walk,
 * the assistant since M52), keyboard first: typing `@` offers the assistant
 * and this trip's days, stops, people and notebooks under the field, ↑/↓ move, Enter or Tab writes `@<name>` into the
 * draft, Escape closes. A message carries one link, the last one picked, and
 * only while its `@<name>` is still in the words.
 *
 * `assistant` is offered unless null; a reader whose plan lacks it (`entitled`
 * false) picks the offer of Plus instead of the mention. A message asks the
 * assistant while `@assistant` is in its words, picked or typed.
 *
 * The field is the combobox: it keeps focus throughout and points
 * `aria-activedescendant` at the active row, as the notebook's slash menu does.
 */
export function useTargetPicker(
  draft: string,
  setDraft: (next: string) => void,
  mentions: ChatMentions | null = null,
  assistant: { entitled: boolean } | null = null,
) {
  const board = useBoardFocus();
  const listId = useId();
  // Where the picker was picked from or dismissed, and the draft as it was then.
  const [closed, setClosed] = useState<{ at: number; draft: string } | null>(null);
  const [active, setActive] = useState({ query: "", index: 0 });
  const [picked, setPicked] = useState<LinkTarget | null>(null);
  // The upgrade offer, shown from a pick of the assistant until the draft is emptied.
  const [offered, setOffered] = useState(false);
  if (offered && draft === "") setOffered(false);

  // Typing on keeps the draft's start, so that `@` stays closed. Deleting or
  // replacing back into it does not, and an `@` typed there again is a new one.
  if (closed !== null && !draft.startsWith(closed.draft)) setClosed(null);
  const match = MENTION.exec(draft);
  const at = match === null ? null : match.index + match[1]!.length;
  const query = match?.[2] ?? "";
  const targets = at === null || (closed !== null && at === closed.at && draft.startsWith(closed.draft)) ? [] : pickerTargets(board, query, mentions, assistant !== null);
  const open = targets.length > 0;
  const index = active.query === query ? Math.min(active.index, targets.length - 1) : 0;
  const optionId = (i: number) => `${listId}-${i}`;

  const pick = (target: PickerTarget) => {
    if (at === null) return;
    if (target.kind === "assistant" && assistant?.entitled === false) {
      setOffered(true);
      setClosed({ at, draft });
      return;
    }
    const mention = `${draft.slice(0, at)}@${target.name}`;
    setDraft(`${mention} `);
    // The assistant is no link: a pick of it keeps the last one.
    if (target.kind !== "assistant") setPicked(target);
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
          {target.kind === "assistant" && assistant?.entitled === false && <span className="ml-auto shrink-0 text-xs text-slate">Plus</span>}
        </li>
      ))}
    </ul>
  ) : null;

  // Mounted empty: a live region that arrives holding its words is often not read out.
  const offer: ReactNode = (
    <div role="status" className={cn(offered && "mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1")}>
      {offered && (
        <>
          <p className="text-xs text-ink">{ASSISTANT_OFFER}</p>
          {/* An anchor, as the rail's upgrade is: it navigates out of the trip. */}
          <Link href="/plans" className={buttonVariants({ variant: "secondary", size: "sm" })}>
            See plans
          </Link>
        </>
      )}
    </div>
  );

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
    /** The upgrade offer, for the panel to show above the composer. */
    offer,
    /** Whether `body` asks the assistant: its mention is in the words, and the reader's plan has it. */
    asks: (body: string) => assistant?.entitled === true && ASKS.test(body),
    /** The link to send with `body`: the last pick, while its mention is still there. */
    linkFor: (body: string): ChatLink | undefined =>
      picked !== null && wholeMention(body, `@${picked.name}`) !== -1 ? { kind: picked.kind, id: picked.id } : undefined,
    /** After a send: a new message starts with no link. */
    clear: () => {
      setPicked(null);
      setClosed(null);
    },
    /** What `clear` forgets, for `restore` to give back with a send's text when it was not stored. */
    held: { picked, closed },
    restore: (held: { picked: LinkTarget | null; closed: { at: number; draft: string } | null }) => {
      setPicked(held.picked);
      setClosed(held.closed);
    },
  };
}
