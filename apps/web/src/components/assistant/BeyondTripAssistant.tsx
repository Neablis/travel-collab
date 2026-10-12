"use client";

import { useState } from "react";
import { AI_NOT_ENTITLED_CODE, type ApiError, type BeyondTripAskScope } from "@/lib/apiClient";
import { useIsPhone, useIsTabletWidth } from "@/lib/useIsPhone";
import { usePhoneAsk, usePhoneAskEntry } from "@/components/nav/phoneAsk";
import { AskPill } from "./AskPill";
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
 * Docked and always there from 1100px up, where the trip board docks too
 * (Mitchell, 2026-10-12: at 768px Home's grids were left a column they were
 * not drawn for). Below that it is a sheet, a mount point no first paint has:
 * the page head's Ask opens it from 768px (`HomeAskButton`), the tab bar's
 * below, and Hide closes it. So at most one composer is mounted on the draft
 * at a time, and a resize or rotation hands the draft from one to the other
 * through storage. One conversation behind both, so the thread is the same.
 *
 * The docked rail is mounted until the width hooks answer, under CSS that
 * hides it on a phone (`AssistantRail`'s `presentation` note). Between 768 and
 * 1099px that is one frame of the rail on a hard load: the line is the board's
 * constant, which no CSS class can name.
 *
 * The caller lays it beside its content in a flex row, as the board does.
 */
export function BeyondTripAssistant({ scope }: { scope: BeyondTripAskScope }) {
  const name = beyondTripThreadName(scope);
  const ask = useAskThread({ scope, persistAs: name, errorMessage: (error: ApiError) => error.message });
  const isPhone = useIsPhone();
  const isTabletWidth = useIsTabletWidth();
  const docks = !isPhone && !isTabletWidth;
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheetShown = sheetOpen && !docks;
  // ⌘K's *Ask: <text>*, for whichever rail is mounted; it drops it once taken.
  const [handOff, setHandOff] = useState<{ text: string } | null>(null);

  // Read at a press, after hydration, so the width hooks have answered by then.
  usePhoneAskEntry(() => setSheetOpen(true), sheetShown || docks, (text) => {
    if (!docks) setSheetOpen(true);
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
      {docks && (
        <div className="hidden md:block">
          <AssistantRail presentation="docked" {...shared} />
        </div>
      )}
      {sheetShown && <AssistantRail presentation="sheet" {...shared} onHide={() => setSheetOpen(false)} />}
    </>
  );
}

/**
 * Home's Ask from 768 to 1099px, where its assistant is not docked and there
 * is no tab bar: the trip header's pill, opening the same entry the tab bar
 * and ⌘K do (`usePhoneAskEntry` above), so it cannot open it differently.
 */
export function HomeAskButton() {
  const entry = usePhoneAsk();
  const isTabletWidth = useIsTabletWidth();
  if (!isTabletWidth || entry === null) return null;
  return <AskPill open={entry.open} onOpen={entry.onOpen} />;
}
