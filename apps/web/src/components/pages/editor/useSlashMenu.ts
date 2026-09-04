"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { macroCatalog } from "@tc/pages";
import { widgetMatches } from "@/components/pages/WidgetPicker";

// Typing `/` opens the widget picker where the caret is — Mitchell, walking the
// preview (2026-09-04): *"Typing '/' doesnt bring up the inline widget picker"*.
//
// **Hand-rolled, on purpose.** The obvious implementation is `@tiptap/suggestion`
// plus `tippy.js`, and neither is a dependency of this repo. A slash menu is
// roughly forty lines of "read the text behind the caret, filter the registry,
// replace a range" — a new runtime dependency (and a second popover engine
// alongside Radix) is a poor trade for that. What it costs instead is this
// comment and the tests beside it.
//
// It reads the SAME registry and the SAME matcher as the popover and the phone
// sheet (`widgetMatches`), so a widget cannot be findable in one and hidden in
// the other. Insertion goes through `insertWidget` in the caller, which is the
// one construction path (ADR-037 decision 4).

// How many rows the caret menu shows. It is a menu at the caret, not the
// catalogue: past about six rows it covers the paragraph the author is writing,
// which is the thing they are trying to look at. Refining the query is the way
// to see the seventh, and the popover in the header is the way to browse.
const MAX_ROWS = 6;

// `/` counts as opening the menu only at the start of a word — after a space, a
// newline, or at the very start of the block. Otherwise `and/or` and a typed URL
// both open a widget menu mid-word, which is the classic way this feature
// becomes something people turn off.
//
// The query is letters, digits and dots: dots because a widget's stored name is
// `cost.day` and the picker searches those too, so `/cost.day` has to survive
// the match rather than ending at the dot.
const TRIGGER = /(?:^|\s)\/([\w.]*)$/;

export interface SlashMenuState {
  // Document position of the `/` itself. The replaced range is [from, caret),
  // so the typed query disappears when the widget lands.
  from: number;
  query: string;
  // Viewport coordinates of the caret, for a `position: fixed` menu. Fixed
  // rather than absolute so the menu does not need a positioned ancestor
  // inside ProseMirror's contenteditable — putting a wrapper in there is how
  // you end up with a node the schema did not ask for.
  left: number;
  top: number;
  active: number;
  names: readonly { name: string; title: string; preview: string }[];
}

export interface SlashMenu {
  state: SlashMenuState | null;
  close: () => void;
  // Called by the caller's insert path once it has a validated node.
  rangeToReplace: () => { from: number; to: number } | null;
  // Wired into the editor's keydown so Enter/arrows drive the menu instead of
  // the document while it is open.
  handleKeyDown: (event: KeyboardEvent) => boolean;
  onPick: (name: string) => void;
}

export function useSlashMenu({
  editor,
  enabled,
  onPick,
}: {
  editor: Editor | null;
  enabled: boolean;
  onPick: (name: string, range: { from: number; to: number }) => void;
}): SlashMenu {
  const [state, setState] = useState<SlashMenuState | null>(null);
  // The keydown handler is installed once, at editor creation, and must see the
  // CURRENT menu. A ref rather than a dependency, because re-creating the
  // editor on every keystroke is not an option.
  const stateRef = useRef<SlashMenuState | null>(null);
  stateRef.current = state;
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  const close = useCallback(() => setState(null), []);

  // Recompute from the document on every transaction. Deriving the menu from
  // the document rather than tracking keystrokes is what makes it survive
  // undo, paste, and a click that moves the caret away — all three of which
  // leave a keystroke-tracked menu open over nothing.
  useEffect(() => {
    if (!editor || !enabled) {
      setState(null);
      return;
    }
    const sync = () => {
      const { state: editorState, view } = editor;
      const { selection } = editorState;
      if (!selection.empty) return setState(null);
      const $from = selection.$from;
      if (!$from.parent.isTextblock) return setState(null);
      const textBefore = editorState.doc.textBetween($from.start(), $from.pos, "\n", "￼");
      const match = TRIGGER.exec(textBefore);
      if (!match) return setState(null);
      const query = match[1] ?? "";
      const from = $from.pos - query.length - 1;
      const names = macroCatalog()
        .filter((w) => widgetMatches(w, query))
        .slice(0, MAX_ROWS)
        .map((w) => ({ name: w.name, title: w.title, preview: w.preview }));
      // A query that matches nothing closes the menu rather than showing an
      // empty box: at that point the person is writing a date, not choosing a
      // widget, and a menu hovering over "9/11" is in the way.
      if (names.length === 0) return setState(null);
      const coords = view.coordsAtPos(from);
      setState((was) => ({
        from,
        query,
        left: coords.left,
        top: coords.bottom,
        // Keep the highlighted row across a keystroke when it still exists, so
        // typing one more letter does not silently move the target of Enter.
        active: was && was.active < names.length ? was.active : 0,
        names,
      }));
    };
    sync();
    editor.on("transaction", sync);
    return () => {
      editor.off("transaction", sync);
    };
  }, [editor, enabled]);

  const rangeToReplace = useCallback(() => {
    const current = stateRef.current;
    if (!current || !editor) return null;
    return { from: current.from, to: editor.state.selection.from };
  }, [editor]);

  const pick = useCallback(
    (name: string) => {
      const range = rangeToReplace();
      if (!range) return;
      onPickRef.current(name, range);
      setState(null);
    },
    [rangeToReplace],
  );

  // `handleKeyDown` is installed into the editor once, at creation, so it
  // cannot close over `pick` — this ref is the seam, the same one `stateRef`
  // is above and for the same reason.
  const pickRef = useRef(pick);
  pickRef.current = pick;

  const handleKeyDown = useCallback((event: KeyboardEvent): boolean => {
    const current = stateRef.current;
    if (current === null) return false;
    if (event.key === "Escape") {
      setState(null);
      return true;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setState((was) =>
        was === null
          ? was
          : { ...was, active: (was.active + delta + was.names.length) % was.names.length },
      );
      return true;
    }
    // Enter and Tab both commit. Tab because the menu is a completion and that
    // is what a completion answers to; Enter because it is what a menu answers
    // to. Neither may reach the document while the menu is open — an Enter that
    // splits the paragraph *and* inserts a widget is the worst of both.
    if (event.key === "Enter" || event.key === "Tab") {
      const chosen = current.names[current.active];
      if (chosen === undefined) return false;
      pickRef.current(chosen.name);
      return true;
    }
    return false;
  }, []);

  return { state, close, rangeToReplace, handleKeyDown, onPick: pick };
}
