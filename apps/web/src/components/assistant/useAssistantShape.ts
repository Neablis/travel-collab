"use client";

import { useCallback, useEffect, useState } from "react";

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
