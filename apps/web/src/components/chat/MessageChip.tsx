"use client";
import type { ChatLink } from "@tc/contracts";
import { resolveLink, useBoardFocus, type ResolvedLink } from "./boardFocus";
import { Button } from "@/components/ui/button";

/**
 * A message's day or stop (M46 D3) as a chip that goes to it on the board,
 * named as the board names it now.
 */
export function MessageChip({ target }: { target: ResolvedLink }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={target.focus}
      className="mx-0.5 h-auto rounded-full bg-brand-tint px-1.5 py-0 align-baseline font-semibold text-brand-pressed hover:bg-brand-tint hover:text-brand-pressed hover:underline"
    >
      @{target.label}
    </Button>
  );
}

/** Where `mention` stands whole in `body`, or -1: `@Day 1` is not the start of `@Day 10`. */
function wholeMention(body: string, mention: string): number {
  for (let at = body.indexOf(mention); at !== -1; at = body.indexOf(mention, at + 1)) {
    const after = body[at + mention.length];
    if (after === undefined || !/[\p{L}\p{N}_]/u.test(after)) return at;
  }
  return -1;
}

/**
 * A message's words with its link drawn as a chip: in place of the mention
 * the composer wrote (`@<label>`), or after the words where the target has
 * been renamed since. A link that does not resolve on this board — a target
 * deleted since, or an id from another trip (`resolveLink`) — leaves the
 * words exactly as written, so the name stays as plain text.
 */
export function MessageBody({ body, link }: { body: string; link?: ChatLink | undefined }) {
  const board = useBoardFocus();
  const target = link === undefined ? null : resolveLink(board, link);
  if (target === null) return <>{body}</>;
  const mention = `@${target.label}`;
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
