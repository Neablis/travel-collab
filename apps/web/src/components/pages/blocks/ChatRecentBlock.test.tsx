import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@tc/contracts";
import { tripDetailFactory } from "@tc/factories";
import { registerPhoneAsk } from "@/components/nav/phoneAsk";
import { MacroView } from "../MacroView";
import { ChatRecentBlock } from "./ChatRecentBlock";

// "Group chat" (M52 decision 15) through the notebook's own renderer. Which
// messages and whose names are `chatRecent.test.ts`'s; this holds what only
// the app decides: that the board's chat reaches the widget, that the widget
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
  // Mitchell, PR 537 round 3: the widget is the way in, not a button under it.
  it("is one control that opens the chat, from a click on any of its messages", async () => {
    const onOpen = vi.fn();
    unregister.push(registerPhoneAsk({ open: false, onOpen: () => {}, chat: { onOpen, messages: [message] } }));
    render(view());
    const control = screen.getByRole("button", { name: "Open group chat" });
    expect(screen.getAllByRole("button")).toEqual([control]);
    expect(control.textContent).toBe("Traveler 2: On the train");
    await userEvent.click(screen.getByText("On the train"));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("opens nothing from a click while the page is being edited", async () => {
    const onOpen = vi.fn();
    unregister.push(registerPhoneAsk({ open: false, onOpen: () => {}, chat: { onOpen, messages: [message] } }));
    render(<ChatRecentBlock payload={{ kind: "chat-recent", lines: [{ messageId: message.messageId, author: "Sam", body: "On the train" }] }} interactive={false} />);
    expect(screen.queryByRole("button")).toBeNull();
    await userEvent.click(screen.getByText("On the train"));
    expect(onOpen).not.toHaveBeenCalled();
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
