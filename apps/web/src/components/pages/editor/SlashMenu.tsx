"use client";
import { Button } from "@/components/ui/button";
import type { SlashMenuState } from "./useSlashMenu";

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
  if (state === null) return null;
  return (
    <div
      // `listbox`, not `menu`: the caret stays in the document and the rows are
      // a completion over what has been typed, which is what a listbox is for.
      // The editor keeps focus throughout — moving it here would close the
      // selection the insert depends on.
      role="listbox"
      aria-label="Insert a widget"
      className="overlay-layer fixed w-72 overflow-hidden rounded-md border border-hairline bg-surface shadow-overlay"
      // eslint-disable-next-line no-restricted-syntax -- caret coordinates, recomputed per keystroke from `coordsAtPos`. There is no token for "wherever the cursor happens to be", and every colour, size and spacing below is a token.
      style={{ left: state.left, top: state.top }}
    >
      <ul>
        {state.names.map((w, index) => (
          <li key={w.name}>
            <Button
              variant="ghost"
              role="option"
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
