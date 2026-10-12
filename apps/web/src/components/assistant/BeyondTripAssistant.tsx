"use client";

import { useState } from "react";
import { AI_NOT_ENTITLED_CODE, type ApiError, type BeyondTripAskScope } from "@/lib/apiClient";
import { useIsPhone } from "@/lib/useIsPhone";
import { usePhoneAskEntry } from "@/components/nav/phoneAsk";
import { AssistantRail } from "./AssistantRail";
import { beyondTripThreadName } from "./askThreadStore";
import { useAskThread } from "./useAskThread";

/** What a scope about no one trip says above its conversation, and offers to start one. */
const SURFACE = {
  account: {
    contextLine: "Across your trips",
    suggestions: ["Which city have I been to most?", "How many countries have I been to?", "What was my most expensive meal?", "Where should I go next?"],
  },
} as const satisfies Record<BeyondTripAskScope["kind"], { contextLine: string; suggestions: readonly string[] }>;

/**
 * **An assistant that is always on screen, about no one trip** (M45 D7):
 * Home's, over the account, and the shape the playbook pages' will take with
 * a scope of their own.
 *
 * Docked from 768px up and always there, so it is chosen by a CSS breakpoint
 * and never across the first paint (`AssistantRail`'s `presentation` note).
 * On a phone a docked rail is the whole screen, so there it is hidden and the
 * tab bar's Ask opens the sheet instead: a mount point no first paint has.
 * One conversation behind both, so the thread is the same in either.
 *
 * The caller lays it beside its content in a flex row, as the board does.
 */
export function BeyondTripAssistant({ scope }: { scope: BeyondTripAskScope }) {
  const name = beyondTripThreadName(scope);
  const ask = useAskThread({ scope, persistAs: name, errorMessage: (error: ApiError) => error.message });
  const isPhone = useIsPhone();
  const [sheetOpen, setSheetOpen] = useState(false);
  // ⌘K's *Ask: <text>*, for the rail that is on screen. Dropped when the sheet
  // closes, so reopening it does not send the same words again.
  const [handOff, setHandOff] = useState<{ text: string; sheet: boolean } | null>(null);

  // Read at a press, after hydration, so `useIsPhone` has answered by then.
  usePhoneAskEntry(() => setSheetOpen(true), sheetOpen || !isPhone, (text) => {
    if (isPhone) setSheetOpen(true);
    setHandOff({ text, sheet: isPhone });
  });

  const { contextLine, suggestions } = SURFACE[scope.kind];
  const rail = (presentation: "docked" | "sheet") => (
    <AssistantRail
      presentation={presentation}
      contextLine={contextLine}
      scope={scope}
      turns={ask.thread}
      suggestions={[...suggestions]}
      asksRemaining={ask.asksRemaining}
      restoreDraft={ask.restoredDraft}
      rememberDraftAs={name}
      incoming={handOff !== null && handOff.sheet === (presentation === "sheet") ? handOff : null}
      onNewConversation={ask.startNewConversation}
      onAsk={(text) => void ask.runAsk(text)}
      asking={ask.asking}
      askError={ask.askError}
      askUpgrade={ask.askErrorCode === AI_NOT_ENTITLED_CODE}
      simulated={ask.simulated}
      {...(presentation === "sheet"
        ? {
            onHide: () => {
              setSheetOpen(false);
              setHandOff(null);
            },
          }
        : {})}
    />
  );

  return (
    <>
      <div className="hidden md:block">{rail("docked")}</div>
      {sheetOpen && rail("sheet")}
    </>
  );
}
