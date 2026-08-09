"use client";
import { createContext, useContext, useMemo, useState } from "react";

type FocusCtx = { focusedDay: number | null; setFocusedDay: (i: number | null) => void };
const Ctx = createContext<FocusCtx | null>(null);

export function useFocus(): FocusCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useFocus outside FocusProvider");
  return v;
}

export function FocusProvider({ children }: { children: React.ReactNode }) {
  const [focusedDay, setFocusedDay] = useState<number | null>(null);
  const value = useMemo(() => ({ focusedDay, setFocusedDay }), [focusedDay]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
