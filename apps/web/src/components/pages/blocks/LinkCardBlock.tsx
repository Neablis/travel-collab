"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight } from "lucide-react";
import type { LinkCardPayload } from "@tc/pages";
import { cn } from "@/lib/cn";
import { Skeleton } from "@/components/ui/skeleton";
import { linkHref } from "./linkHref";

// An internal link, as a small preview card (M30, ADR-056): what KIND of place
// it is, its name, and one line about it from the trip's own data — then the
// arrow that says it goes somewhere.
//
// Spans, not divs, for the reason every block here gives: a widget node is an
// inline atom inside a paragraph, and a `<div>` in a `<p>` is closed out by the
// parser. `display: flex` on a span lays out the same.
//
// **Three reasons it is not a link**, each drawing the same card without the
// arrow: the reader cannot open the place (`openable` — the demo's visitor and
// an invitee having a look, who cannot open a notebook route); the page is
// being EDITED, where a click on a widget selects it for its settings and
// leaving the page would be the wrong answer to that click; and nothing else.
/**
 * A notebook card while the notebook list is still on its way — **the card's
 * own box, not a chip** (ADR-044: a widget's answer landing does not reflow the
 * page). The seeded Overview ends in three of these, and a chip-then-card swap
 * moved everything under the reader's cursor by three card heights; the M30
 * e2e walk clicked a heading mid-shift and landed in the paragraph above it.
 */
export function LinkCardPending() {
  return (
    <span className="my-1 flex items-center gap-3 rounded-md border border-hairline bg-surface px-3.5 py-3" aria-busy="true">
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-xs font-medium text-slate">Notebook</span>
        {/* The title's line box (text-base: 20px), holding a bar rather than words. */}
        <span className="flex h-5 items-center">
          <Skeleton className="h-3 w-1/3" />
        </span>
        <span className="text-sm text-slate">loading notebooks</span>
      </span>
    </span>
  );
}

/** An internal link card — a link to its target unless the reader cannot open it or the page is being edited. */
export function LinkCardBlock({
  payload,
  tripId,
  interactive = true,
}: {
  payload: LinkCardPayload;
  tripId: string;
  interactive?: boolean;
}) {
  const pathname = usePathname() ?? "";
  const body = (
    <>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-xs font-medium text-slate">{payload.eyebrow}</span>
        <span className="text-base font-semibold text-ink">{payload.title}</span>
        <span className="truncate text-sm text-slate">{payload.summary}</span>
      </span>
      {payload.openable && interactive ? <ArrowRight aria-hidden className="size-4 shrink-0 text-slate" /> : null}
    </>
  );
  const card = "my-1 flex items-center gap-3 rounded-md border border-hairline bg-surface px-3.5 py-3 no-underline";
  if (!payload.openable || !interactive) {
    return (
      <span className={card} data-testid="link-card">
        {body}
      </span>
    );
  }
  return (
    <Link
      href={linkHref(payload.to, tripId, pathname)}
      className={cn(card, "transition-colors hover:border-border-strong hover:bg-moss focus-visible:outline-2 focus-visible:outline-brand")}
      data-testid="link-card"
    >
      {body}
    </Link>
  );
}
