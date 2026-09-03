"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronDown, NotebookText } from "lucide-react";
import type { PageSummary } from "@tc/contracts";
import { createPage, fetchPages } from "@/lib/pagesClient";
import { scopeLabel } from "@/lib/pageScope";
import { Button } from "@/components/ui/button";
import { Popover } from "@/components/ui/popover";
import { Text } from "@/components/ui/text";

type Status = "idle" | "loading" | "ready" | "error";

/**
 * The Notebooks menu — SPEC §11's "Notebooks is a menu, not a tab".
 *
 * A bordered pill (icon + "Notebooks" + ▾) at the far right of the view row,
 * *deliberately* a different class of thing from the lens tabs beside it: the
 * tabs project the same trip through a different view, and this navigates to
 * another route. It replaces the plain text `<Link>` that sat in `TripHeader`'s
 * nav row, where it read as a peer of "← Your trips".
 *
 * **One noun, "notebook", in all three sections** (§11) — the route below still
 * calls its rows pages internally, and the contract type is `PageSummary`, but
 * nothing a person reads says "page".
 */
export function NotebooksMenu({ tripId, readOnly = false }: { tripId: string; readOnly?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [notebooks, setNotebooks] = useState<PageSummary[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Which open this is. Close-and-reopen starts a second `fetchPages` while the
  // first may still be in flight, and responses are not guaranteed to arrive in
  // the order they were sent — so without this the older response can land last
  // and overwrite the newer list with stale notebooks, silently. Only the
  // latest request is allowed to write state; superseded ones are dropped.
  // (CodeRabbit, PR #126. A generation counter rather than an AbortController
  // because the point is to ignore the answer, not to save the request — and
  // because an AbortController that nothing ever aborts is its own bug, which
  // this repo has already shipped once in `ComposePanel`.)
  const openSeq = useRef(0);

  // Fetched on open rather than on mount, and re-fetched on every open rather
  // than cached: this menu sits on the board, where a person can spend an hour
  // without ever opening it, and where a notebook created in another tab (or on
  // the index route in this one) would otherwise show a list that is quietly
  // wrong. The list is small and the request is cheap; a stale menu is not.
  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) return;
    const seq = ++openSeq.current;
    setStatus("loading");
    void fetchPages(tripId).then((result) => {
      if (seq !== openSeq.current) return;
      if (result.ok) {
        setNotebooks(result.value.pages);
        setStatus("ready");
      } else {
        setStatus("error");
      }
    });
  };

  // "New notebook" creates and navigates in one go, matching what the index
  // route's own create does — a create that leaves you looking at a list is a
  // second click to reach the thing you just made.
  const handleCreate = () => {
    setCreating(true);
    setCreateError(null);
    void createPage(tripId, {
      title: "Untitled notebook",
      context: { tripId },
      content: { type: "doc", content: [] },
    }).then((result) => {
      setCreating(false);
      if (!result.ok) {
        // NOT `setStatus("error")`: that is the LIST's state, so a failed
        // create used to blank the notebooks the menu had already loaded and
        // then blame the load ("Could not load your notebooks") for something
        // the load did not do (Copilot, PR #126).
        setCreateError(result.error.message);
        return;
      }
      setOpen(false);
      router.push(`/trips/${tripId}/pages/${result.value.id}`);
    });
  };

  return (
    <Popover
      open={open}
      onOpenChange={handleOpenChange}
      align="end"
      // No `aria-haspopup="menu"` on the trigger: Radix's Popover exposes
      // dialog semantics, and this content is ordinary links and buttons rather
      // than `menuitem`s with menu keyboard behaviour. Advertising a menu hands
      // assistive technology an interaction model the surface does not
      // implement (Copilot, PR #126). "Menu" in this component's name is SPEC
      // §11's word for the affordance, not an ARIA role.
      trigger={
        <Button variant="secondary" size="sm" aria-label="Notebooks">
          <NotebookText aria-hidden="true" className="size-4" />
          Notebooks
          <ChevronDown aria-hidden="true" className="size-4" />
        </Button>
      }
    >
      {/*
        §11 pins this popover's height rules, and they are load-bearing rather
        than cosmetic: the create row and the footer stay put while only the
        list scrolls, so the two actions never scroll out of reach behind a
        long list of notebooks.

        The `max-height` is an inline style because the value is
        `--radix-popover-content-available-height`, which Radix measures per
        open against the actual viewport — a static token cannot hold it. The
        Tailwind arbitrary-value form (`max-h-[…]`) is explicitly warned off in
        §11 for a reason that applies to this page: it loads the precompiled
        `_ds_bundle.css` with no JIT, so an uncompiled utility lands in the DOM
        and silently does nothing.
      */}
      <div
        className="flex flex-col gap-2"
        // eslint-disable-next-line no-restricted-syntax -- a Radix-measured viewport value has no static token, and §11 warns off the Tailwind arbitrary-value form on this page
        style={{ maxHeight: "calc(var(--radix-popover-content-available-height, 420px) - 24px)" }}
      >
        {/* HIDDEN for a reader, not greyed — ADR-031's rule, the one
            `TripHeader` applies to Share three files over. A viewer may READ a
            trip's notebooks (the GET is viewer-gated) and may not add to them
            (the POST is editor-gated), so an exposed "New notebook" is a
            guaranteed 403 — and it surfaced as "Could not load your notebooks",
            which is not even what went wrong (Copilot, PR #126). */}
        {!readOnly && (
          <div className="flex flex-col gap-1">
            <Button variant="secondary" onClick={handleCreate} disabled={creating} className="w-full justify-start">
              New notebook
            </Button>
            {/* Beside the control that failed, and separate from the list's own
                error below, so the reason shown matches the thing that broke. */}
            {createError !== null && (
              <Text variant="muted" role="alert">
                Could not create a notebook. {createError}
              </Text>
            )}
          </div>
        )}

        {/* `min-h-0` is what makes the max-height above actually bite: a flex
            child's default `min-height: auto` refuses to shrink below its
            content, so without this the list grows the popover instead of
            scrolling inside it. */}
        <ul className="flex min-h-0 flex-col gap-0.5 overflow-y-auto">
          {status === "loading" && (
            <li>
              <Text variant="secondary">Loading…</Text>
            </li>
          )}
          {status === "error" && (
            <li>
              <Text variant="secondary" role="alert">
                Could not load your notebooks.
              </Text>
            </li>
          )}
          {status === "ready" && notebooks.length === 0 && (
            <li>
              <Text variant="secondary">No notebooks yet.</Text>
            </li>
          )}
          {status === "ready" &&
            notebooks.map((notebook) => (
              <li key={notebook.id}>
                <Link
                  href={`/trips/${tripId}/pages/${notebook.id}`}
                  onClick={() => setOpen(false)}
                  className="flex items-baseline justify-between gap-3 rounded-md px-2 py-1.5 hover:bg-moss"
                >
                  <Text as="span" className="truncate text-ink">
                    {notebook.title}
                  </Text>
                  {/* A real space between the two spans. Without it the link's
                      accessible name computes as "Trip OverviewTrip-wide" —
                      one run-together word to a screen reader. A whitespace-only
                      text node is not rendered as a flex item, so this changes
                      the name and not the layout. */}{" "}
                  {/* The binding, per §11 ("the trip's notebooks with their
                      day/trip-wide binding") — the one thing that distinguishes
                      two notebooks with similar names. */}
                  <Text as="span" variant="secondary" className="shrink-0">
                    {scopeLabel(notebook.context)}
                  </Text>
                </Link>
              </li>
            ))}
        </ul>

        <Link
          href={`/trips/${tripId}/pages`}
          onClick={() => setOpen(false)}
          className="border-t border-hairline pt-2 text-sm text-slate hover:text-ink"
        >
          Browse all notebooks →
        </Link>
      </div>
    </Popover>
  );
}
