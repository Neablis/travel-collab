import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@tc/contracts";
import { tripDetailFactory } from "@tc/factories";
import { registerPhoneAsk } from "@/components/nav/phoneAsk";
import { MacroView } from "../MacroView";

// "Group chat" (M52 decision 15) through the notebook's own renderer. Which
// messages and whose names are `chatRecent.test.ts`'s; this holds what only
// the app decides: that the board's chat reaches the widget, that *Open chat*
// opens it, and that a reader with no chat (decision 20) is shown nothing.

const trip = tripDetailFactory.build(
  { members: [{ userId: "dana", role: "owner" }, { userId: "sam", role: "editor" }] },
  { transient: { dayCount: 1, activitiesPerDay: 0, unscheduledCount: 0 } },
);

const message: ChatMessage = {
  messageId: "00000000-0000-4000-8000-000000000001", authorId: "sam", kind: "member", requestedBy: null,
  replyTo: null, suggestionId: null, asksAssistant: false, createdAt: "2026-10-23T10:00:00Z", editedAt: null,
  removed: false, body: "On the train",
};

const unregister: (() => void)[] = [];
afterEach(() => {
  unregister.splice(0).forEach((undo) => undo());
  cleanup();
});

const view = () => <MacroView detail={trip} context={{ tripId: trip.tripId }} name="chat.recent" params={{}} />;

describe("ChatRecentBlock", () => {
  it("shows the chat the board holds, and Open chat opens it", async () => {
    const onOpen = vi.fn();
    unregister.push(registerPhoneAsk({ open: false, onOpen: () => {}, chat: { onOpen, messages: [message] } }));
    render(view());
    expect(screen.getByRole("listitem").textContent).toBe("Traveler 2: On the train");
    await userEvent.click(screen.getByRole("button", { name: "Open chat" }));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  // A screen with nobody to chat with offers no chat, and a share link's page
  // registers nothing at all: either way, no widget, not a disabled one.
  it("is absent where the screen offers Ask and no chat", () => {
    unregister.push(registerPhoneAsk({ open: false, onOpen: () => {}, onAsk: () => {} }));
    render(<div data-testid="page">{view()}</div>);
    expect(screen.getByTestId("page").textContent).toBe("");
    expect(screen.queryByRole("group")).toBeNull();
  });

  it("is absent where no screen offers anything", () => {
    render(<div data-testid="page">{view()}</div>);
    expect(screen.getByTestId("page").textContent).toBe("");
    expect(screen.queryByRole("group")).toBeNull();
  });
});
