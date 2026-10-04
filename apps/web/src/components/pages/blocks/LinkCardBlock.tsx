"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight } from "lucide-react";
import type { LinkCardPayload, MissingNotebookPayload } from "@tc/pages";
import { fetchTripAccess } from "@/lib/apiClient";
import { cn } from "@/lib/cn";
import { addMissingDefaultNotebooks } from "@/lib/pagesClient";
import { cachedRead } from "@/lib/queryCache";
import { tripKeys } from "@/lib/queryKeys";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { notebooksChanged } from "../useExternalInputs";
import { linkHref } from "./linkHref";

// An internal link, as a small preview card (M30, ADR-056): what KIND of place
// it is, its name, and one line about it from the trip's own data — then the
// arrow that says it goes somewhere.
//
// Spans, not divs, for the reason every block here gives: a widget node is an
// inline atom inside a paragraph, and a `<div>` in a `<p>` is closed out by the
// parser. `display: flex` on a span lays out the same.
//
// **One reason it is not a link**, drawing the same card without the arrow: the
// page is being EDITED, where a click on a widget selects it for its settings
// and leaving the page would be the wrong answer to that click. Every reader can
// follow one — the demo's visitor and an invitee having a look included, whose
// notebook links stay on their own path (`linkHref`). Until 2026-09-27 those two
// got a card with no link, which Mitchell reported as "i cant click them".
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

/** An internal link card — a link to its target unless the page is being edited. */
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
      {interactive ? <ArrowRight aria-hidden className="size-4 shrink-0 text-slate" /> : null}
    </>
  );
  const card = "my-1 flex items-center gap-3 rounded-md border border-hairline bg-surface px-3.5 py-3 no-underline";
  if (!interactive) {
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

/**
 * A link to a default notebook this trip does not have (Mitchell, 2026-10-03:
 * *"A missing default notebook widget should have a call to action to click
 * and generate that missing notebook"*). The card's own box, dashed where a
 * live card is solid, naming the notebook and what it is for.
 *
 * **The button is the owner's, in Reading.** Adding a default is owner only on
 * the server (Mitchell, 2026-09-27), so an editor or a viewer gets the card
 * without a control the server would refuse; and in Editing a click on a
 * widget selects it, as it does on a live card. It adds THIS notebook and no
 * other missing one, then tells the page, whose cards re-read the list and
 * this one becomes a link.
 */
export function MissingNotebookBlock({
  payload,
  tripId,
  interactive = true,
}: {
  payload: MissingNotebookPayload;
  tripId: string;
  interactive?: boolean;
}) {
  const [isOwner, setIsOwner] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void cachedRead(tripKeys.access(tripId), () => fetchTripAccess(tripId)).then((access) => {
      if (live) setIsOwner(access.ok && access.value.myRole === "owner");
    });
    return () => {
      live = false;
    };
  }, [tripId]);

  const add = () => {
    setAdding(true);
    void addMissingDefaultNotebooks(tripId, payload.seedKey).then((result) => {
      setAdding(false);
      if (!result.ok) return setError(result.error.message);
      setError(null);
      notebooksChanged();
    });
  };

  return (
    <span
      className="my-1 flex items-center gap-3 rounded-md border border-dashed border-border-strong bg-surface px-3.5 py-3"
      data-testid="link-missing"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-xs font-medium text-slate">Notebook · not in this trip yet</span>
        <span className="text-base font-semibold text-ink">{payload.title}</span>
        <span className="text-sm text-slate">{payload.description}</span>
        {error === null ? null : (
          <span role="alert" className="text-sm text-ink">
            {error}
          </span>
        )}
      </span>
      {interactive && isOwner ? (
        <Button variant="secondary" size="sm" className="shrink-0" onClick={add} disabled={adding}>
          {`Add ${payload.title}`}
        </Button>
      ) : null}
    </span>
  );
}
