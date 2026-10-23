"use client";
import { createContext, useContext } from "react";
import Link from "next/link";
import type { ChatLink } from "@tc/contracts";
import type { Persona } from "@/lib/persona";
import { resolveLink, useBoardFocus, type BoardFocus } from "./boardFocus";
import { Button } from "@/components/ui/button";

/**
 * The trip's people and notebooks a message can name (the M46 walk), beside
 * the board's days and stops. `ChatPanel` provides them; a member removed or a
 * notebook deleted since is simply not here, so its mention stays plain text.
 */
export type ChatMentions = {
  tripId: string;
  personas: Readonly<Record<string, Persona>> | null;
  notebooks: readonly { id: string; title: string }[];
};

const MentionsContext = createContext<ChatMentions | null>(null);
export const ChatMentionsProvider = MentionsContext.Provider;

/** A link resolved for this trip: its name as written after the `@`, and what pressing it does, if anything. */
type Resolved = { name: string; focus?: () => void; href?: string };

/** A day by its number alone: the board's label goes on to name its cities, which the chip leaves out. */
const dayName = (board: BoardFocus, dayId: string) => `Day ${board.days.findIndex((d) => d.dayId === dayId) + 1}`;

function resolve(board: BoardFocus | null, mentions: ChatMentions | null, link: ChatLink): Resolved | null {
  if (link.kind === "person") {
    const persona = mentions?.personas?.[link.id];
    return persona === undefined ? null : { name: persona.name };
  }
  if (link.kind === "notebook") {
    const notebook = mentions?.notebooks.find((n) => n.id === link.id);
    return mentions === null || notebook === undefined ? null : { name: notebook.title, href: `/trips/${mentions.tripId}/pages/${notebook.id}` };
  }
  const target = resolveLink(board, { kind: link.kind, id: link.id });
  if (target === null || board === null) return null;
  return { name: link.kind === "day" ? dayName(board, link.id) : target.label, focus: target.focus };
}

/**
 * Small and plain, as the words around it (Mitchell's M46 walk): no `@`, no
 * pill, and below the 44px floor `Button` carries on a phone, which made an
 * inline chip a line taller than the message.
 */
const CHIP = "mx-0.5 inline h-auto min-h-0 min-w-0 rounded-sm bg-brand-tint px-1 py-0 align-baseline font-medium text-brand-pressed";
/**
 * A pressable chip's hit area on a phone: an invisible overlay 12px above and
 * below, so the small chip still takes a 44px finger (SPEC §13.1) without
 * growing the line it sits in. Only 4px sideways: the message's Report and ⋯
 * sit 8px past the body (PR 446 review), and a tap there is theirs. A mouse
 * gets the chip as drawn.
 */
const HIT = "relative after:absolute after:-inset-x-1 after:-inset-y-3 fine:after:hidden";

/** A message's reference as a chip: a day or stop focuses the board, a notebook opens, a person is their name. */
export function MessageChip({ target }: { target: Resolved }) {
  if (target.focus !== undefined) {
    return (
      <Button variant="ghost" size="sm" onClick={target.focus} className={`${CHIP} ${HIT} hover:bg-brand-tint hover:text-brand-pressed hover:underline`}>
        {target.name}
      </Button>
    );
  }
  if (target.href !== undefined) {
    return (
      <Link href={target.href} className={`${CHIP} ${HIT} hover:underline`}>
        {target.name}
      </Link>
    );
  }
  return <span className={CHIP}>{target.name}</span>;
}

/** Where `mention` stands whole in `body`, or -1: `@Day 1` is not the start of `@Day 10`. */
export function wholeMention(body: string, mention: string): number {
  for (let at = body.indexOf(mention); at !== -1; at = body.indexOf(mention, at + 1)) {
    const after = body[at + mention.length];
    if (after === undefined || !/[\p{L}\p{N}_]/u.test(after)) return at;
  }
  return -1;
}

/**
 * A message's words with its link drawn as a chip: in place of the mention
 * the composer wrote (`@<name>`), or after the words where the target has
 * been renamed since. A link that does not resolve on this trip — a target
 * deleted since, a member removed, or an id from another trip — leaves the
 * words exactly as written, so the name stays as plain text.
 */
export function MessageBody({ body, link }: { body: string; link?: ChatLink | undefined }) {
  const board = useBoardFocus();
  const mentions = useContext(MentionsContext);
  const target = link === undefined ? null : resolve(board, mentions, link);
  if (target === null) return <>{body}</>;
  const mention = `@${target.name}`;
  const at = wholeMention(body, mention);
  if (at === -1) {
    return (
      <>
        {body} <MessageChip target={target} />
      </>
    );
  }
  return (
    <>
      {body.slice(0, at)}
      <MessageChip target={target} />
      {body.slice(at + mention.length)}
    </>
  );
}
