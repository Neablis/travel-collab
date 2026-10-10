"use client";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

export type ActivityPrefill = {
  dayId?: string;
  /** A paste or a drop's title and notes (M41 D8, `pasteToStop`). */
  title?: string;
  notes?: string;
  location?: { name: string; lat?: number; lng?: number };
  timeWindow?: { start: string; end: string };
};
type EditorState = { mode: "create" | "edit" | null; prefill?: ActivityPrefill; activityId?: string };
type EditorCtx = {
  state: EditorState;
  openCreate: (prefill?: ActivityPrefill) => void;
  openEdit: (activityId: string) => void;
  close: () => void;
  /**
   * What had focus when the editor opened, for the sheet to hand focus back
   * to when it closes: the sheet opens from state, with no trigger, so Radix
   * would otherwise drop focus on <body> (KI-2026-10-09-b). Null when focus
   * was nowhere in particular, as after a double-click on a river.
   */
  returnFocus: { readonly current: HTMLElement | null };
};

const Ctx = createContext<EditorCtx | null>(null);
export const useEditor = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useEditor outside EditorHost");
  return v;
};

export function EditorHost({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<EditorState>({ mode: null });
  // Stable identities: setState is stable, so these never need to change.
  // Consumers that depend on the actions (e.g. MapLens's mount effect) must
  // not re-run just because editor state changed — otherwise the map is torn
  // down and rebuilt on every open (#24/#25).
  const returnFocus = useRef<HTMLElement | null>(null);
  // Whether the editor is open, read by `remember` without making the actions
  // depend on `state`.
  const isOpen = useRef(false);
  // Only from outside the editor (PR 398 review): reopened from within it (⌘K
  // over the open sheet), focus is on the sheet's own field, which is gone by
  // the time the sheet closes, and the control that first opened it is kept.
  const remember = () => {
    if (isOpen.current) return;
    const at = document.activeElement;
    returnFocus.current = at instanceof HTMLElement && at !== document.body ? at : null;
  };
  const openCreate = useCallback((prefill?: ActivityPrefill) => {
    remember();
    isOpen.current = true;
    setState({ mode: "create", prefill });
  }, []);
  const openEdit = useCallback((activityId: string) => {
    remember();
    isOpen.current = true;
    setState({ mode: "edit", activityId });
  }, []);
  const close = useCallback(() => {
    isOpen.current = false;
    setState({ mode: null });
  }, []);
  const api = useMemo<EditorCtx>(
    () => ({ state, openCreate, openEdit, close, returnFocus }),
    [state, openCreate, openEdit, close],
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
