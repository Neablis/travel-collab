// What a widget's `resolve` can answer.
//
// `unbound` carries WHAT is missing, because the two cases read differently to
// a person: a widget with no day chosen is something they can fix from the
// chrome row, and a widget on a notebook with no trip is not.
export type MacroResult<T> =
  | { status: "ok"; value: T }
  | { status: "empty" }
  | { status: "unbound"; needs: "day" | "trip" };

export const ok = <T>(value: T): MacroResult<T> => ({ status: "ok", value });
export const empty = (): MacroResult<never> => ({ status: "empty" });
export const unbound = (needs: "day" | "trip"): MacroResult<never> => ({ status: "unbound", needs });

// The answer every trip-reading widget gives when handed a context with no
// trip. Named rather than inlined seven times so the reason survives: ADR-037
// open question 2 requires every resolver to handle an absent trip, because
// root-account notebooks are the stated direction — and a resolver that
// assumes a trip is one that has to be rewritten when they arrive.
export const needsTrip = (): MacroResult<never> => unbound("trip");
