import type { KeyboardEvent } from "react";

/**
 * "Pressing Enter in this field does what the button beside it does."
 *
 * Mitchell, 2026-09-01: *"Pressing enter in many fields doesnt submit"*, naming
 * the sign-up screen's invite-code box. The cause is structural rather than a
 * missed handler in one file: most single-field surfaces in this app are
 * `Dialog`/`Sheet` bodies with a `DialogFooter` button, not `<form>`s — so
 * there is no implicit submission for Enter to trigger, and every field that
 * wants it has to say so.
 *
 * A helper rather than a `<form>` per dialog, deliberately. Wrapping these in
 * real forms would reintroduce the hydration hazard `AuthScreen`'s dev-login
 * form documents at length: before React hydrates, a `<form>` with no `action`
 * still submits NATIVELY on Enter — a GET to the same URL that reloads the
 * page, wipes the controlled input, and writes whatever was typed into the
 * address bar as a query parameter, where it lands in history and server logs.
 * A `keydown` handler simply does not exist before hydration, so Enter is inert
 * until it means something, which is the outcome that form needed a disabled
 * submit button to reach.
 *
 * Three keystrokes are deliberately let through:
 *
 *   * **A composing Enter.** An IME uses Enter to accept a candidate — this
 *     app's whole demo corpus is Japanese place names, so "Enter submits" while
 *     someone is mid-conversion would submit a half-typed word. `isComposing`
 *     is the standard guard and is on the native event, not React's synthetic
 *     one.
 *   * **A modified Enter** (⌘/Ctrl/Alt/Shift). Those are somebody's shortcut or
 *     a newline, not a submit.
 *   * **A repeat.** Holding Enter fires `keydown` continuously; one press is
 *     one submit.
 */
export function submitOnEnter(run: () => void) {
  return (event: KeyboardEvent) => {
    if (event.key !== "Enter") return;
    if (event.nativeEvent.isComposing || event.repeat) return;
    if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
    // Before `run`, and unconditional: an Enter that reaches a surrounding
    // form (or a Radix dialog's own default) after this handler has acted is
    // the same action twice.
    event.preventDefault();
    run();
  };
}
