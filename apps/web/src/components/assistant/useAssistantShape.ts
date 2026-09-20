"use client";

import { useCallback, useEffect, useState } from "react";

import type { Point } from "./assistantPosition";

/**
 * **Which shape the assistant takes, and it is the reader's to choose** —
 * SPEC §9, M26 link 10a: *"The assistant is not a fixed rail. One panel, three
 * presentations, and the user picks."*
 *
 * All three geometries were built and nobody could choose between them: the
 * trip board hardcoded `docked`, the notebook hardcoded `floating`. §9's last
 * four words were the part that was missing.
 *
 * **Per SURFACE, not one global choice.** §9 says the user picks; it does not
 * say the pick is one setting for the whole app, and the two desktop surfaces
 * are not the same shape of problem. A trip board is a wide layout with room
 * for a rail beside the plan. A notebook page is a centred measure inside
 * `PageContainer`, and §9's own table says what docked costs there — *"real —
 * a flex sibling, so the plan shrinks instead of hiding"* — which for a
 * document means taking 356px off the column that IS the reading experience.
 * Mitchell asked for floating there by name (*"it should be on the bottom
 * right on desktop, floating till open, and always available in both editing
 * and reading mode"*, preview review).
 *
 * **So today only `board` calls this.** `PageScreen` withholds `onShapeChange`
 * and stays floating, which means the rail draws no control it cannot honour.
 * The `notebook` key exists because the surface split is the right shape for
 * the setting and not because a second caller is pending: one global choice
 * would have made docking the board silently change the notebook too, which is
 * the coupling worth refusing even while only one surface uses it.
 *
 * **`localStorage`, not the account preferences API.** This is a per-DEVICE
 * layout choice: a 27" monitor has room to dock where a laptop does not, and
 * the same person on both would have to keep changing an account-wide setting
 * back. It also costs no contract field, no migration and no round trip. The
 * honest lifetime is "this browser until its site data is cleared", which is
 * the same lifetime the conversation itself already has (`persistAs`).
 */
export type AssistantShape = "docked" | "floating";

/** The two surfaces that have a desktop assistant. A phone has neither (§23). */
export type AssistantSurface = "board" | "notebook";

const KEY: Record<AssistantSurface, string> = {
  board: "assistant:shape:board",
  notebook: "assistant:shape:notebook",
};

/**
 * The shape each surface opens in before anyone has chosen. Both are what that
 * surface already hardcoded, so nothing moves for a reader who never picks.
 */
export const DEFAULT_SHAPE: Record<AssistantSurface, AssistantShape> = {
  board: "docked",
  notebook: "floating",
};

function read(surface: AssistantSurface): AssistantShape | null {
  // Every access wrapped: Safari's private mode throws on `localStorage`, the
  // same reason `pendingDemoClone.ts` wraps its own.
  try {
    const stored = window.localStorage.getItem(KEY[surface]);
    return stored === "docked" || stored === "floating" ? stored : null;
  } catch {
    return null;
  }
}

export function useAssistantShape(surface: AssistantSurface): [AssistantShape, (next: AssistantShape) => void] {
  // **Starts at the default and corrects in an effect**, rather than reading
  // storage during render. `localStorage` does not exist on the server, so a
  // render-time read is a hydration mismatch — and the correction lands before
  // the first paint a reader can see, because the assistant is closed until
  // they open it.
  const [shape, setShape] = useState<AssistantShape>(DEFAULT_SHAPE[surface]);

  useEffect(() => {
    const stored = read(surface);
    if (stored !== null) setShape(stored);
  }, [surface]);

  const choose = useCallback(
    (next: AssistantShape) => {
      setShape(next);
      try {
        window.localStorage.setItem(KEY[surface], next);
      } catch {
        // A choice that cannot be remembered is still a choice that applies
        // now. Refusing to switch because storage is unavailable would make
        // the control dead in exactly the browsers that need it least.
      }
    },
    [surface],
  );

  return [shape, choose];
}

/**
 * **Where the floating panel was left, across a navigation** — SPEC §29, M26
 * link 10c.
 *
 * §29 asks for something this build's shape cannot give literally: *"On `plans`
 * the floating dock keeps its place in the tree with `visibility: hidden;
 * pointer-events: none` … unmounting it loses the thread, the open/closed state
 * and the dragged position, so coming back from Plans would reset it."*
 *
 * **There is nothing in that route's tree to hide.** The assistant is mounted
 * by `TripBoardScreen`; `/plans` is an account-scope route that renders neither
 * the board nor the trip, so the subtree is gone on navigation rather than
 * hidden. The build's existing note said that made §29 inapplicable, and M26
 * link 10 says why that stopped being true: *"it stops being sound the moment
 * this link gives the assistant a position worth losing."*
 *
 * So the RESULT §29 protects is delivered a different way — the state outlives
 * the unmount instead of the element outliving the route:
 *
 * - **The thread already survived**, and always did (`useAskThread`'s
 *   `persistAs`), which is the piece §29 names first.
 * - **The shape survives** (`useAssistantShape`, link 10a).
 * - **The position survives**, which is this.
 *
 * **The open/closed state deliberately does NOT**, and that is the one place
 * this falls short of §29's sentence. `TripBoardScreen`'s own note is the
 * reason, at length: the assistant's presentation is chosen with
 * `useIsPhone()`, which returns `false` on the server and the first client
 * paint, and the flash that would cause is unreachable *"and the reason is
 * `useAssistantVisibility` … `useState(false)`, with no restore from storage,
 * no URL parameter and no server prop, so `assistant.open` is false on EVERY
 * first paint."* Restoring it would paint a 356px docked rail on a phone for a
 * frame — reintroducing a defect that file guards by construction, to save a
 * reader one click. Recorded in `DRIFT.md` rather than traded quietly.
 */
export function useAssistantPosition(
  key: string,
): [Point | null, (next: Point | null | ((current: Point | null) => Point | null)) => void] {
  const [position, setPosition] = useState<Point | null>(null);

  // Read in an effect, not during render: `localStorage` does not exist on the
  // server. The panel keeps `.assistant-float`'s own corner until this lands,
  // which is the same thing it does before any drag at all.
  useEffect(() => {
    // **An empty key means "do not remember", and it has to be checked rather
    // than assumed inert.** `localStorage` accepts `""` as a perfectly good
    // key, so a caller that asked for no memory was getting memory — shared
    // with every other caller that also asked for none. Caught by the test
    // that asserts the panel forgets (CLAUDE.md rule 3).
    if (key === "") return;
    try {
      const stored = window.localStorage.getItem(key);
      if (stored === null) return;
      const parsed: unknown = JSON.parse(stored);
      const point = parsed as { x?: unknown; y?: unknown } | null;
      // **`Number.isFinite` and nothing else.** A first version also checked
      // `typeof === "number"` on both fields, which is strictly implied — and
      // the redundancy showed up as a test that stayed green with one of the
      // two guards deleted. This is the one that carries: it rejects a string,
      // a null, a missing field, and the `NaN`/`Infinity` that a `typeof`
      // check waves through and that would position the panel nowhere.
      if (point === null || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
      setPosition({ x: point.x as number, y: point.y as number });
    } catch {
      // Unreadable or unparseable storage is the same as none: the corner.
    }
  }, [key]);

  // **Takes an updater as well as a value**, exactly as `useState` does, because
  // the re-clamp on resize has to read the CURRENT position without making it a
  // dependency — a listener re-registered on every frame of a drag is a cost
  // nobody asked for. The write happens inside the updater so the value written
  // is the one React committed, not one computed from a stale closure.
  const remember = useCallback(
    (next: Point | null | ((current: Point | null) => Point | null)) => {
      setPosition((current) => {
        const resolved = typeof next === "function" ? next(current) : next;
        if (key === "") return resolved;
        try {
          if (resolved === null) window.localStorage.removeItem(key);
          else window.localStorage.setItem(key, JSON.stringify(resolved));
        } catch {
          // Same as the shape: a position that cannot be remembered still
          // applies now.
        }
        return resolved;
      });
    },
    [key],
  );

  return [position, remember];
}
