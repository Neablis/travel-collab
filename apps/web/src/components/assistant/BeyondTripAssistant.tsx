"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AI_NOT_ENTITLED_CODE,
  createTrip,
  insertSavedDay,
  type ApiError,
  type PlaybookAskPage,
} from "@/lib/apiClient";
import { AI_ASK_ENTITLEMENT, useEntitled } from "@/lib/useAiEntitled";
import { useDocksAssistant, useIsPhone } from "@/lib/useIsPhone";
import { useSessionUser } from "@/components/account/useSessionUser";
import { usePhoneAsk, usePhoneAskEntry } from "@/components/nav/phoneAsk";
import { AskPill } from "./AskPill";
import { AssistantRail } from "./AssistantRail";
import type { ProposalState } from "./ProposalCard";
import { beyondTripThreadName } from "./askThreadStore";
import { useAskThread } from "./useAskThread";
import { useAssistantVisibility } from "./useAssistantVisibility";

const ACCOUNT_SUGGESTIONS = [
  "Which city have I been to most?",
  "How many countries have I been to?",
  "What was my most expensive meal?",
  "Where should I go next?",
];

/**
 * **An assistant about no one trip** (M45 D7): Home's, over the account.
 *
 * Closed until asked for at every width, with the trip board's open state
 * (`useAssistantVisibility`; Mitchell, walking PR 426 on 2026-10-12: "There
 * should be a way to collapse or hide the assistant and it starts closed").
 * The page head's Ask opens it above a phone (`AssistantAskButton`), the tab
 * bar's on one, ⌘K's *Ask: <text>* anywhere, and Hide closes it. Open, it docks
 * beside the list from 1100px, where the board docks too, and is a sheet below
 * (Mitchell, 2026-10-12: at 768px Home's grids were left a column they were
 * not drawn for).
 *
 * Nothing opens it before hydration, so the width it is presented by is
 * always known when it mounts (PR 426 review round 2: a rail mounted on a
 * guess stored its empty box over the draft as it unmounted). One rail at a
 * time, so one composer on the stored draft, which carries what was typed
 * through Hide and a reload. One conversation behind it either way. Opening
 * moves focus to the composer and Hide gives it back to the control that
 * opened it (`useAssistantVisibility`).
 *
 * The caller lays it beside its content in a flex row, as the board does.
 */
export function BeyondTripAssistant({ scope }: { scope: { kind: "account" } }) {
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
  return (
    <AssistantRail
      presentation={docks ? "docked" : "sheet"}
      contextLine="Across your trips"
      scope={scope}
      turns={ask.thread}
      suggestions={ACCOUNT_SUGGESTIONS}
      asksRemaining={ask.asksRemaining}
      restoreDraft={ask.restoredDraft}
      onRestoreTaken={ask.clearRestoredDraft}
      rememberDraftAs={name}
      incoming={handOff}
      onIncomingTaken={() => setHandOff(null)}
      onNewConversation={ask.startNewConversation}
      onAsk={(text: string) => void ask.runAsk(text)}
      asking={ask.asking}
      askError={ask.askError}
      askUpgrade={ask.askErrorCode === AI_NOT_ENTITLED_CODE}
      simulated={ask.simulated}
      takeFocus={assistant.takeFocus}
      onHide={assistant.hide}
    />
  );
}

/** What a playbook page offers to ask before a conversation starts: a shared day's buttons, or a list's questions. */
function playbookSuggestions(page: PlaybookAskPage): string[] {
  return page.kind === "day"
    ? ["What does this cover?", "Add this to one of my trips", "Start a trip with this"]
    : ["Which of these is the cheapest?", "Which is the most popular?"];
}

/**
 * **A playbook page's assistant** (M45 D9): about what that page shows and,
 * on a shared day, its own two buttons — *add it to a trip, on a day* and
 * *start a trip with it* — proposed on a card and run, on Approve, by the
 * calls those buttons make (`createTrip`, `insertSavedDay`).
 *
 * **Only for an account whose plan has the assistant** (D9: "Only signed-in
 * users on a plan with assistant access see it"). Nothing is drawn until both
 * are known: a reader who cannot use it never sees an Ask, here, in the tab
 * bar, or in ⌘K, which offer it only where a screen registered one. This
 * waits for a yes, where the trip rail treats an unknown plan as entitled,
 * because what it would show meanwhile is an Ask, not a paywall over a
 * subscriber's composer. The route refuses the rest regardless.
 *
 * Opened on demand like the trip board's rail (`useAssistantVisibility`),
 * and floating over the page, the notebook's shape, since a playbook page has
 * no column to give it; a sheet on a phone. It mounts only once opened, by a
 * click after hydration, so the width it is presented by is known (the rule
 * `AssistantRail`'s `presentation` note states). One conversation per page.
 */
export function PlaybookAssistant({ page, contextLine }: { page: PlaybookAskPage; contextLine: string }) {
  const signedIn = Boolean(useSessionUser()?.id);
  const entitled = useEntitled(AI_ASK_ENTITLEMENT, signedIn);
  if (!signedIn || entitled !== true) return null;
  return <OpenablePlaybookAssistant page={page} contextLine={contextLine} />;
}

function OpenablePlaybookAssistant({ page, contextLine }: { page: PlaybookAskPage; contextLine: string }) {
  const router = useRouter();
  const scope = { kind: "playbook", page } as const;
  const name = beyondTripThreadName(scope);
  const ask = useAskThread({
    scope,
    persistAs: name,
    errorMessage: (error: ApiError) => error.message,
    // The one event only this surface acts on: the card a shared day's write
    // drafted, attached to the answer and waiting.
    onEvent: (event, patchAnswer) => {
      if (event.type !== "proposal") return;
      patchAnswer((turn) => ({ ...turn, proposal: { proposal: event.proposal, status: "pending", note: null } }));
    },
  });
  const assistant = useAssistantVisibility();
  const phone = useIsPhone();
  const [handOff, setHandOff] = useState<{ text: string } | null>(null);

  usePhoneAskEntry(assistant.show, assistant.open, (text) => {
    assistant.show();
    setHandOff({ text });
  });

  const patchProposal = (turnId: string, fn: (state: ProposalState) => ProposalState) =>
    ask.patchTurn(turnId, (turn) => (turn.role === "assistant" && turn.proposal != null ? { ...turn, proposal: fn(turn.proposal) } : turn));

  // **Approve is the page's own button, pressed for you.** The same two calls
  // `AddToTripDialog` makes — `createTrip` named after the playbook, then
  // `insertSavedDay` — so the insert, its one history entry and the adds
  // ledger are the button's, and the route asks for editor on the trip as it
  // does for the button. Then to the trip, as the button goes.
  const approve = async (turnId: string) => {
    const turn = ask.thread.find((candidate) => candidate.id === turnId);
    if (turn?.role !== "assistant" || turn.proposal == null) return;
    if (turn.proposal.status === "applying" || turn.proposal.status === "applied") return;
    const { target, inserts } = turn.proposal.proposal;
    const insert = inserts[0];
    if (target === undefined || insert === undefined) return;
    patchProposal(turnId, (state) => ({ ...state, status: "applying", note: null }));
    let tripId: string;
    if (target.kind === "new-trip") {
      const created = await createTrip({ name: target.name });
      if (!created.ok) {
        patchProposal(turnId, (state) => ({ ...state, status: "failed", note: created.error.message }));
        return;
      }
      tripId = created.value.tripId;
      // A retry after a failed insert adds to the trip just made rather than
      // making a second one: the dialog's latch, kept on the card.
      patchProposal(turnId, (state) => ({ ...state, proposal: { ...state.proposal, target: { kind: "trip", tripId } } }));
    } else {
      tripId = target.tripId;
    }
    const startingAt = target.kind === "trip" ? target.startingAt : undefined;
    const added = await insertSavedDay(tripId, insert.savedDayId, startingAt === undefined ? {} : { startingAt });
    if (!added.ok) {
      patchProposal(turnId, (state) => ({ ...state, status: "failed", note: added.error.message }));
      return;
    }
    patchProposal(turnId, (state) => ({ ...state, status: "applied", note: "Added. Opening the trip…" }));
    router.push(`/trips/${tripId}`);
  };

  if (!assistant.open) return null;
  return (
    <AssistantRail
      presentation={phone ? "sheet" : "floating"}
      contextLine={contextLine}
      scope={scope}
      turns={ask.thread}
      suggestions={playbookSuggestions(page)}
      asksRemaining={ask.asksRemaining}
      restoreDraft={ask.restoredDraft}
      onRestoreTaken={ask.clearRestoredDraft}
      rememberDraftAs={name}
      incoming={handOff}
      onIncomingTaken={() => setHandOff(null)}
      onNewConversation={ask.startNewConversation}
      onAsk={(text: string) => void ask.runAsk(text)}
      onApproveProposal={(turnId) => void approve(turnId)}
      onRejectProposal={(turnId) => patchProposal(turnId, (state) => ({ ...state, status: "rejected" }))}
      asking={ask.asking}
      askError={ask.askError}
      askUpgrade={ask.askErrorCode === AI_NOT_ENTITLED_CODE}
      simulated={ask.simulated}
      takeFocus={assistant.takeFocus}
      onHide={assistant.hide}
    />
  );
}

/**
 * The page head's Ask above a phone: the trip header's pill, opening the same
 * entry the tab bar and ⌘K do (`usePhoneAskEntry` above), so it cannot open it
 * differently. Hidden by CSS on a phone, as the trip header's is, where the
 * tab bar's Ask is the way in. Drawn only where a screen registered one, so
 * nowhere the assistant is not offered.
 */
export function AssistantAskButton() {
  const entry = usePhoneAsk();
  if (entry === null) return null;
  return <AskPill open={entry.open} onOpen={entry.onOpen} className="max-md:hidden" />;
}
