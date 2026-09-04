"use client";
import { useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { SLASH_LISTBOX_ID, slashOptionId, type SlashMenuState } from "./useSlashMenu";

// How close to a viewport edge the menu may sit. Small and fixed: the point is
// that a menu at the edge is still fully readable, not that it floats.
const EDGE_MARGIN_PX = 8;

// The caret menu itself. Deliberately thin: `useSlashMenu` owns when it is open,
// what is in it and which row is active, so this file is only "draw that".
//
// `position: fixed` at the caret's viewport coordinates, rather than an
// absolutely-positioned box inside the editor. ProseMirror owns the DOM inside
// `EditorContent` — putting a positioned wrapper in there means a node the
// schema never agreed to, and ProseMirror will eventually remove it.
//
// The inline `style` is coordinates, not styling: they are computed per caret
// position and cannot be a class. Every colour, size and spacing below is a
// token, which is what the design wall actually asks for.
export function SlashMenu({
  state,
  onPick,
}: {
  state: SlashMenuState | null;
  onPick: (name: string) => void;
}) {
  // Measured, not estimated. The menu's height changes with how many rows
  // survived the filter, and guessing it is how a menu ends up flipped above
  // the caret when it would have fitted below.
  const box = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const rows = state?.names.length ?? 0;
  useLayoutEffect(() => {
    const el = box.current;
    if (el) setSize({ width: el.offsetWidth, height: el.offsetHeight });
  }, [rows]);

  if (state === null) return null;

  // **Clamped to the viewport.** The caret's own coordinates put a fixed 18rem
  // menu off the right edge near the end of a line, and off the bottom near the
  // foot of the page — worst on the 411px phone, and invisible at the 1280px
  // default the suite runs at. Flagged by CodeRabbit on PR 139.
  //
  // Horizontally it slides back in; vertically it FLIPS above the caret, which
  // is why `useSlashMenu` carries both edges of the caret. Sliding up instead
  // would put the menu over the word being typed.
  const maxLeft = window.innerWidth - size.width - EDGE_MARGIN_PX;
  const left = Math.max(EDGE_MARGIN_PX, Math.min(state.left, maxLeft));
  const overflowsBelow = state.top + size.height + EDGE_MARGIN_PX > window.innerHeight;
  const top = overflowsBelow
    ? Math.max(EDGE_MARGIN_PX, state.caretTop - size.height - EDGE_MARGIN_PX)
    : state.top;

  return (
    <div
      ref={box}
      // `listbox`, not `menu`: the caret stays in the document and the rows are
      // a completion over what has been typed, which is what a listbox is for.
      // The editor keeps focus throughout — moving it here would close the
      // selection the insert depends on.
      role="listbox"
      id={SLASH_LISTBOX_ID}
      aria-label="Insert a widget"
      className="overlay-layer fixed w-72 overflow-hidden rounded-md border border-hairline bg-surface shadow-overlay"
      // eslint-disable-next-line no-restricted-syntax -- caret coordinates, recomputed per keystroke from `coordsAtPos`. There is no token for "wherever the cursor happens to be", and every colour, size and spacing below is a token.
      style={{ left, top }}
    >
      <ul>
        {state.names.map((w, index) => (
          <li key={w.name}>
            <Button
              variant="ghost"
              role="option"
              // The id the focused editor points `aria-activedescendant` at —
              // see `useSlashMenu`. Without it the highlight is visible and
              // silent.
              id={slashOptionId(w.name)}
              aria-selected={index === state.active}
              className={
                index === state.active
                  ? "h-auto w-full flex-col items-start gap-0.5 rounded-none bg-brand-tint px-3 py-2 text-left"
                  : "h-auto w-full flex-col items-start gap-0.5 rounded-none px-3 py-2 text-left"
              }
              // `onMouseDown` with the default prevented, not `onClick`: a
              // click's mousedown blurs the editor first, which collapses the
              // selection the replaced range is measured from — so the widget
              // landed in the wrong place, or nowhere, depending on where the
              // caret fell.
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(w.name);
              }}
            >
              <span className="text-sm font-medium text-ink">{w.title}</span>
              {/* The same FIXED sample the picker shows (ADR-037 decision 5) —
                  one preview string per widget, wherever it is offered. */}
              <span className="text-xs text-slate">{w.preview}</span>
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
