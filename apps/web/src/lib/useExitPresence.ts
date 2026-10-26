import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from "react";

/**
 * Takes focus out of an overlay the moment it starts to leave.
 *
 * `inert` alone does not, or not yet: measured in `m54-motion.spec.ts`, focus
 * was still inside a closing dialog and the account menu after both had
 * turned inert, so for some part of the exit a keypress still went to them.
 *
 * It goes to the opener at once, where Radix would put it on unmount anyway,
 * so a Tab or a screen reader does not start from `<body>` for the length of
 * the exit (spec §3). A modal overlay leaves the page `aria-hidden` until it
 * unmounts, and focus in there is focus a screen reader cannot see, so the
 * opener's own ancestors are shown first. Safe, because the page is about to
 * be shown anyway and `aria-hidden`'s undo is a no-op on an attribute already
 * gone. Only what an overlay hid (`data-aria-hidden`) is lifted, and a nested
 * modal's opener lives in the outer one's portal, so this never shows what the
 * outer modal hid. An opener that is gone, or hidden for another reason, gets
 * nothing: focus is blurred, and Radix's return (or the caller's
 * `onCloseAutoFocus`) still decides where it lands.
 */
function letGoOfFocus(opener: HTMLElement | null = null) {
  const at = document.activeElement;
  if (!(at instanceof HTMLElement) || at.closest('[data-motion][data-state="closed"]') === null) return;
  if (opener?.isConnected === true) {
    for (let el: HTMLElement | null = opener; el !== null; el = el.parentElement) {
      if (el.hasAttribute("data-aria-hidden")) el.removeAttribute("aria-hidden");
    }
    if (opener.closest('[aria-hidden="true"]') === null) opener.focus();
  }
  if (document.activeElement === at) at.blur();
}

/**
 * For a Radix overlay, which plays its own exit: with `open` gone false, its
 * `data-state` is already `closed` by the layout phase, so focus is let go
 * before the browser paints the first frame of the exit. The opener is
 * `trigger` where the caller has one (a menu opened by mouse never focuses its
 * trigger), else what held focus as `open` turned true, before Radix's own
 * autofocus (a passive effect) moved it inside.
 */
export function useLetGoOfFocusOnClose(open: boolean, trigger?: RefObject<HTMLElement | null>) {
  const opener = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (open) {
      const at = document.activeElement;
      opener.current = at instanceof HTMLElement && at !== document.body ? at : null;
      return;
    }
    letGoOfFocus(trigger?.current ?? opener.current);
    opener.current = null;
  }, [open, trigger]);
}

/**
 * Keeps a non-Radix surface mounted for its exit animation (ADR-082 §2).
 *
 * `exit(done)` turns the node `inert` and sets `data-state="closed"` at once,
 * so the CSS exit starts and the leaving node takes no click and holds no
 * focus. `done` (the caller's unmount) runs on the node's own `animationend`,
 * or straight away when no exit animation applies, which is what reduced
 * motion gives. The same check Radix's Presence makes.
 *
 * The DOM is written directly, not through state, so a caller whose unmount
 * is a timer (the toast's) unmounts in that same tick when nothing animates.
 * The caller renders `data-state="open"` and never changes it, so React never
 * writes over the closed state; `cancel` puts the node back.
 */
export function useExitPresence<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const leaving = useRef<(() => void) | null>(null);

  const cancel = useCallback(() => {
    leaving.current?.();
    leaving.current = null;
  }, []);

  const exit = useCallback((done: () => void) => {
    const node = ref.current;
    if (leaving.current !== null) return;
    if (node === null) {
      done();
      return;
    }
    node.setAttribute("inert", "");
    node.dataset.state = "closed";
    letGoOfFocus();
    const { animationName } = getComputedStyle(node);
    const finish = (event: AnimationEvent) => {
      if (event.target !== node) return;
      stop();
      done();
    };
    const stop = () => {
      node.removeEventListener("animationend", finish);
      node.removeEventListener("animationcancel", finish);
    };
    leaving.current = () => {
      stop();
      node.removeAttribute("inert");
      node.dataset.state = "open";
    };
    if (animationName === "" || animationName === "none") {
      stop();
      done();
      return;
    }
    node.addEventListener("animationend", finish);
    node.addEventListener("animationcancel", finish);
  }, []);

  useEffect(() => cancel, [cancel]);

  return { ref, exit, cancel };
}
