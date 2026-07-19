"use client";
import { createContext, useCallback, useContext, useMemo, useState } from "react";

export type ActivityPrefill = {
  dayId?: string;
  location?: { name: string; lat?: number; lng?: number };
  timeWindow?: { start: string; end: string };
};
type EditorState = { mode: "create" | "edit" | null; prefill?: ActivityPrefill; activityId?: string };
type EditorCtx = {
  state: EditorState;
  openCreate: (prefill?: ActivityPrefill) => void;
  openEdit: (activityId: string) => void;
  close: () => void;
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
  const openCreate = useCallback((prefill?: ActivityPrefill) => setState({ mode: "create", prefill }), []);
  const openEdit = useCallback((activityId: string) => setState({ mode: "edit", activityId }), []);
  const close = useCallback(() => setState({ mode: null }), []);
  const api = useMemo<EditorCtx>(
    () => ({ state, openCreate, openEdit, close }),
    [state, openCreate, openEdit, close],
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
