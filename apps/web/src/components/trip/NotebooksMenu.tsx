"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronDown, NotebookText } from "lucide-react";
import { newPageDoc } from "@tc/contracts";
import type { PageSummary } from "@tc/contracts";
import { createPage, fetchPages } from "@/lib/pagesClient";
import { provenanceLabel } from "@/lib/pageScope";
import { formatRelativeInstant } from "@/lib/formatDate";
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
  // Who is reading, so each row's provenance line can say "Yours" without
  // guessing — `actorId` alone cannot tell the reader's own notebook from a
  // collaborator's, which is the whole reason `provenanceLabel` takes this.
  const [viewerId, setViewerId] = useState<string | null>(null);
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
        setViewerId(result.value.viewerId);
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
      content: newPageDoc(),
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
      // `p-1` beats the primitive's default `p-3` through `cn`'s tailwind-merge:
      // the rows below carry their own 10px inset so their hover fill can run
      // the full width of the popover instead of stopping inside a padded box.
      contentClassName="w-80 p-1"
      collisionPadding={12}
      // No `aria-haspopup="menu"` on the trigger: Radix's Popover exposes
      // dialog semantics, and this content is ordinary links and buttons rather
      // than `menuitem`s with menu keyboard behaviour. Advertising a menu hands
      // assistive technology an interaction model the surface does not
      // implement (Copilot, PR #126). "Menu" in this component's name is SPEC
      // §11's word for the affordance, not an ARIA role.
      trigger={
        // `size="sm"` is `h-7` (28px) and the design pins this pill and the tab
        // strip beside it at the same 32px, so the height comes from the
        // className — tailwind-merge resolves `h-8` against the variant's own
        // `h-7`. (The strip itself computes to 30.2px in this build's tokens:
        // `p-0.5` + `py-1` + `text-sm`'s 13px/1.4 line box. 32px is the
        // design's number and the nearest step on the scale; `h-7` was the
        // furthest from it.)
        <Button variant="secondary" size="sm" aria-label="Notebooks" className="h-8">
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
        className="flex min-h-0 flex-col"
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
          <div className="flex flex-none flex-col gap-1">
            {/* Borderless, matching the design: a bordered Button read as a
                second class of thing from the notebook rows under it, when it
                is the same list's first row. Still a real Button so it keeps
                its focus ring, its disabled state and the accessible name the
                tests reach it by. `h-auto` because the row is two text lines
                tall at most and the `md` size's fixed `h-9` would clip it. */}
            <Button
              variant="ghost"
              onClick={handleCreate}
              disabled={creating}
              className="h-auto w-full justify-start gap-2.5 rounded-md px-2.5 py-2"
            >
              {/* `aria-hidden` keeps the accessible name "New notebook" rather
                  than "+ New notebook". */}
              <span
                aria-hidden="true"
                className="grid size-5.5 flex-none place-items-center rounded-sm bg-brand text-base leading-none text-surface"
              >
                +
              </span>
              <Text as="span" className="text-sm font-semibold">
                New notebook
              </Text>
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

        {/* Inside the same gate as the create row: a divider with nothing above
            it is a rule across the top of a viewer's popover. */}
        {!readOnly && <div className="my-1 h-px flex-none bg-hairline" />}

        {/* An explicit `min-height` is what makes the max-height above actually
            bite: a flex child's default `min-height: auto` refuses to shrink
            below its content, so without this the list grows the popover
            instead of scrolling inside it. The design's floor is 44px — one
            row — rather than zero, so a long list never collapses the list to
            nothing between the create row and the footer. */}
        <ul className="flex min-h-11 flex-auto flex-col overflow-y-auto">
          {status === "loading" && (
            <li className="px-2.5 py-2">
              <Text variant="secondary">Loading…</Text>
            </li>
          )}
          {status === "error" && (
            <li className="px-2.5 py-2">
              <Text variant="secondary" role="alert">
                Could not load your notebooks.
              </Text>
            </li>
          )}
          {status === "ready" && notebooks.length === 0 && (
            <li className="px-2.5 py-2">
              <Text variant="secondary">No notebooks yet.</Text>
            </li>
          )}
          {status === "ready" &&
            notebooks.map((notebook) => (
              <li key={notebook.id}>
                <Link
                  href={`/trips/${tripId}/pages/${notebook.id}`}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2.5 rounded-md px-2.5 py-2 hover:bg-moss"
                >
                  <span className="min-w-0 flex-1">
                    <Text as="span" className="block truncate text-sm font-semibold">
                      {notebook.title}
                    </Text>
                    {/* A real space between the two spans in this row. Without
                        it the link's accessible name computes as
                        "Trip OverviewComes with your trip…" — one run-together
                        word to a screen reader. A whitespace-only text node is
                        not rendered as a flex item, so this changes the name and
                        not the layout. */}{" "}
                    {/* The same second line the index route gives each notebook
                        (`NotebookScreen`), from the same two helpers, so the two
                        surfaces cannot drift into describing one notebook two
                        ways. Relative rather than a wall-clock stamp: the
                        question a person asks of a notebook is "is this stale?",
                        not "at what second?". */}
                    <Text as="span" variant="muted" className="mt-px block">
                      {provenanceLabel(notebook, viewerId)} · edited{" "}
                      {formatRelativeInstant(notebook.updatedAt) ?? "recently"}
                    </Text>
                  </span>
                </Link>
              </li>
            ))}
        </ul>

        <div className="my-1 h-px flex-none bg-hairline" />

        <Link
          href={`/trips/${tripId}/pages`}
          onClick={() => setOpen(false)}
          className="flex-none rounded-md px-2.5 py-2 text-xs text-slate hover:bg-moss hover:text-ink"
        >
          Browse all notebooks →
        </Link>
      </div>
    </Popover>
  );
}
