export type MacroResult<T> =
  | { status: "ok"; value: T }
  | { status: "empty" }
  | { status: "unbound"; needs: "day" };

export const ok = <T>(value: T): MacroResult<T> => ({ status: "ok", value });
export const empty = (): MacroResult<never> => ({ status: "empty" });
export const unbound = (needs: "day"): MacroResult<never> => ({ status: "unbound", needs });
