"use client";

import { useState } from "react";
import { AI_NOT_ENTITLED_CODE, type ApiError, type BeyondTripAskScope } from "@/lib/apiClient";
import { useDocksAssistant } from "@/lib/useIsPhone";
import { usePhoneAsk, usePhoneAskEntry } from "@/components/nav/phoneAsk";
import { AskPill } from "./AskPill";
import { AssistantRail } from "./AssistantRail";
import { beyondTripThreadName } from "./askThreadStore";
import { useAskThread } from "./useAskThread";
import { useAssistantVisibility } from "./useAssistantVisibility";

/** What a scope about no one trip says above its conversation, and offers to start one. */
const SURFACE = {
  account: {
    contextLine: "Across your trips",
    suggestions: ["Which city have I been to most?", "How many countries have I been to?", "What was my most expensive meal?", "Where should I go next?"],
  },
} as const satisfies Record<BeyondTripAskScope["kind"], { contextLine: string; suggestions: readonly string[] }>;

/**
 * **An assistant about no one trip** (M45 D7): Home's, over the account.
 * Not the playbook pages' shape: D9 gives theirs a surface of its own, so they
 * take the shared half (the scope, its thread name, `SURFACE`) and own the rest.
 *
 * Closed until asked for at every width, with the trip board's open state
 * (`useAssistantVisibility`; Mitchell, walking PR 426 on 2026-10-12: "There
 * should be a way to collapse or hide the assistant and it starts closed").
 * The page head's Ask opens it above a phone (`HomeAskButton`), the tab bar's
 * on one, ⌘K's *Ask: <text>* anywhere, and Hide closes it. Open, it docks
 * beside the list from 1100px, where the board docks too, and is a sheet below
 * (Mitchell, 2026-10-12: at 768px Home's grids were left a column they were
 * not drawn for).
 *
 * The width is read only once it is open, and nothing opens it before
 * hydration, so no rail is ever mounted on a guess (PR 426 review round 2:
 * one that unmounted a frame later stored its empty box over the draft). One
 * rail at a time, so one composer on the stored draft, which carries what was
 * typed through Hide and a reload. One conversation behind it either way.
 *
 * The caller lays it beside its content in a flex row, as the board does.
 */
export function BeyondTripAssistant({ scope }: { scope: BeyondTripAskScope }) {
  const name = beyondTripThreadName(scope);
  const ask = useAskThread({ scope, persistAs: name, errorMessage: (error: ApiError) => error.message });
  const assistant = useAssistantVisibility();
  const docks = useDocksAssistant() ?? true;
  // ⌘K's *Ask: <text>*, for the rail it opens; it drops it once taken.
  const [handOff, setHandOff] = useState<{ text: string } | null>(null);

  usePhoneAskEntry(assistant.show, assistant.open, (text) => {
    assistant.show();
    setHandOff({ text });
  });

  if (!assistant.open) return null;
  const { contextLine, suggestions } = SURFACE[scope.kind];
  return (
    <AssistantRail
      presentation={docks ? "docked" : "sheet"}
      contextLine={contextLine}
      scope={scope}
      turns={ask.thread}
      suggestions={[...suggestions]}
      asksRemaining={ask.asksRemaining}
      restoreDraft={ask.restoredDraft}
      rememberDraftAs={name}
      incoming={handOff}
      onIncomingTaken={() => setHandOff(null)}
      onNewConversation={ask.startNewConversation}
      onAsk={(text: string) => void ask.runAsk(text)}
      asking={ask.asking}
      askError={ask.askError}
      askUpgrade={ask.askErrorCode === AI_NOT_ENTITLED_CODE}
      simulated={ask.simulated}
      onHide={assistant.hide}
    />
  );
}

/**
 * Home's Ask above a phone, in the page head: the trip header's pill, opening
 * the same entry the tab bar and ⌘K do (`usePhoneAskEntry` above), so it
 * cannot open it differently. Hidden by CSS on a phone, as the trip header's
 * is, where the tab bar's Ask is the way in.
 */
export function HomeAskButton() {
  const entry = usePhoneAsk();
  if (entry === null) return null;
  return <AskPill open={entry.open} onOpen={entry.onOpen} className="max-md:hidden" />;
}
