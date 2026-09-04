// What a widget's `resolve` can answer.
//
// `unbound` carries WHAT is missing, because the two cases read differently to
// a person: a widget with no day chosen is something they can fix from the
// chrome row, and a widget on a notebook with no trip is not.
/**
 * What a widget can be missing — **one member per `WidgetInput` type that has an
 * unbound state**, and `tags` is the one that has none.
 *
 * It read `"day" | "trip"` while `WidgetInput` already declared five types, so a
 * widget taking a range or a person could not report "not set up" without a cast
 * or a contract change: the framework's total state was total only for the two
 * inputs that happened to exist. Found by Copilot on PR 139. `registry-types.ts`
 * carries a compile-time check that the two lists stay in step, so adding an
 * input type without a `needs` member is a type error rather than a discovery.
 *
 * **`tags` is excluded on purpose, not by omission.** ADR-037 decision 9: an
 * absent tag means "every stop", which is a real binding — a `tags` input is
 * never waiting for a choice, so a widget that reported `unbound: "tags"` would
 * be describing a state it cannot be in.
 */
export type UnboundNeeds = "day" | "days" | "person" | "trip";

export type MacroResult<T> =
  | { status: "ok"; value: T }
  | { status: "empty" }
  | { status: "unbound"; needs: UnboundNeeds };

export const ok = <T>(value: T): MacroResult<T> => ({ status: "ok", value });
export const empty = (): MacroResult<never> => ({ status: "empty" });
export const unbound = (needs: UnboundNeeds): MacroResult<never> => ({ status: "unbound", needs });

// The answer every trip-reading widget gives when handed a context with no
// trip. Named rather than inlined seven times so the reason survives: ADR-037
// open question 2 requires every resolver to handle an absent trip, because
// root-account notebooks are the stated direction — and a resolver that
// assumes a trip is one that has to be rewritten when they arrive.
export const needsTrip = (): MacroResult<never> => unbound("trip");
