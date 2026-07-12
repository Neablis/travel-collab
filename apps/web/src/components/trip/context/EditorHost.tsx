"use client";
import { createContext, useContext, useMemo, useState } from "react";

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
  const api = useMemo<EditorCtx>(
    () => ({
      state,
      openCreate: (prefill) => setState({ mode: "create", prefill }),
      openEdit: (activityId) => setState({ mode: "edit", activityId }),
      close: () => setState({ mode: null }),
    }),
    [state],
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
