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
 * Home's, over the account. Not the playbook pages' shape: D9 opens theirs on
 * demand with a Hide, so they take the shared half (the scope, its thread
 * name, `SURFACE`) and own their open state.
 *
 * Docked from 768px up and always there, so it is chosen by a CSS breakpoint
 * across the first paint (`AssistantRail`'s `presentation` note), and unmounted
 * once `useIsPhone` says this is a phone. There the tab bar's Ask opens the
 * sheet instead, a mount point no first paint has, and only while it is a
 * phone. So at most one composer is mounted on the draft at a time, and a
 * rotation hands the draft from one to the other through storage. One
 * conversation behind both, so the thread is the same in either.
 *
 * The caller lays it beside its content in a flex row, as the board does.
 */
export function BeyondTripAssistant({ scope }: { scope: BeyondTripAskScope }) {
  const name = beyondTripThreadName(scope);
  const ask = useAskThread({ scope, persistAs: name, errorMessage: (error: ApiError) => error.message });
  const isPhone = useIsPhone();
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheetShown = sheetOpen && isPhone;
  // ⌘K's *Ask: <text>*, for whichever rail is mounted; it drops it once taken.
  const [handOff, setHandOff] = useState<{ text: string } | null>(null);

  // Read at a press, after hydration, so `useIsPhone` has answered by then.
  usePhoneAskEntry(() => setSheetOpen(true), sheetShown || !isPhone, (text) => {
    if (isPhone) setSheetOpen(true);
    setHandOff({ text });
  });

  const { contextLine, suggestions } = SURFACE[scope.kind];
  const shared = {
    contextLine,
    scope,
    turns: ask.thread,
    suggestions: [...suggestions],
    asksRemaining: ask.asksRemaining,
    restoreDraft: ask.restoredDraft,
    rememberDraftAs: name,
    incoming: handOff,
    onIncomingTaken: () => setHandOff(null),
    onNewConversation: ask.startNewConversation,
    onAsk: (text: string) => void ask.runAsk(text),
    asking: ask.asking,
    askError: ask.askError,
    askUpgrade: ask.askErrorCode === AI_NOT_ENTITLED_CODE,
    simulated: ask.simulated,
  };

  return (
    <>
      {!isPhone && (
        <div className="hidden md:block">
          <AssistantRail presentation="docked" {...shared} />
        </div>
      )}
      {sheetShown && <AssistantRail presentation="sheet" {...shared} onHide={() => setSheetOpen(false)} />}
    </>
  );
}
