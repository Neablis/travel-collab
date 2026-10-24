import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@tc/contracts";
import { tripDetailFactory } from "@tc/factories";
import { registerPhoneAsk, type PhoneChat } from "@/components/nav/phoneAsk";
import { MacroView } from "../MacroView";
import { ChatRecentBlock } from "./ChatRecentBlock";

// "Trip chat" (M52 decision 15) through the notebook's own renderer. Which
// messages and whose names are `chatRecent.test.ts`'s; this holds what only
// the app decides: that the board's chat reaches the widget, that it is drawn
// as the chat draws a message, that the whole card opens the chat, that a solo
// trip's says why there is none and opens nothing, and that a reader the chat
// is not for (decision 20) is shown nothing.

const trip = tripDetailFactory.build(
  { members: [{ userId: "dana", role: "owner" }, { userId: "sam", role: "editor" }] },
  { transient: { dayCount: 1, activitiesPerDay: 0, unscheduledCount: 0 } },
);

const message: ChatMessage = {
  messageId: "00000000-0000-4000-8000-000000000001", authorId: "sam", kind: "member", requestedBy: null,
  replyTo: null, suggestionId: null, asksAssistant: false, createdAt: "2026-10-23T10:00:00Z", editedAt: null,
  removed: false, body: "On the train",
};
// The chat panel's own clock format (`ChatMessage`'s `time`), in this runner's zone.
const sentAt = new Date(message.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

const unregister: (() => void)[] = [];
afterEach(() => {
  unregister.splice(0).forEach((undo) => undo());
  cleanup();
});

const offer = (chat: PhoneChat) => unregister.push(registerPhoneAsk({ open: false, onOpen: () => {}, chat }));
const view = () => <MacroView detail={trip} context={{ tripId: trip.tripId }} name="chat.recent" params={{}} />;
const controls = () => [...screen.queryAllByRole("button"), ...screen.queryAllByRole("link")];
// What a screen reader reads after the card's name.
const description = (el: HTMLElement) =>
  (el.getAttribute("aria-describedby") ?? "")
    .split(" ")
    // eslint-disable-next-line testing-library/no-node-access -- the description is found by the ids the card points at, which is the relationship under test.
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ");

describe("ChatRecentBlock", () => {
  // Mitchell, PR 537 preview walk: a mini chat card, each message as the chat
  // draws it, and the whole card the one way in.
  it("draws each message with its author and time, as one control that opens the chat", async () => {
    const onOpen = vi.fn();
    offer({ onOpen, messages: [message], unread: 0 });
    render(view());
    const card = screen.getByRole("button", { name: "Trip chat Open chat" });
    expect(controls()).toEqual([card]);
    expect(within(card).getByText("Traveler 2")).toBeTruthy();
    expect(within(card).getByText(sentAt)).toBeTruthy();
    await userEvent.click(within(card).getByText("On the train"));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  // As the server stores it (`postSystemLine`): the actor is its author, the
  // body only what was done, and the chat names the actor in front of it.
  it("names whoever made a change, as the chat panel does", () => {
    const change: ChatMessage = { ...message, messageId: "00000000-0000-4000-8000-000000000002", kind: "system", body: "moved “Dinner” to 20:30" };
    offer({ onOpen: () => {}, messages: [change], unread: 0 });
    render(view());
    expect(description(screen.getByRole("button", { name: "Trip chat Open chat" }))).toMatch(/^Traveler 2 moved “Dinner” to 20:30 · /);
  });

  // In the description, not the name, so the name stays exactly the words shown.
  it("says how many are unread in its header, and to a screen reader", () => {
    offer({ onOpen: () => {}, messages: [message], unread: 2 });
    render(view());
    const card = screen.getByRole("button", { name: "Trip chat Open chat" });
    expect(within(card).getByText("2 unread messages")).toBeTruthy();
    expect(description(card)).toMatch(/^2 unread messages /);
  });

  it("still shows what it is while the chat is being read", () => {
    offer({ onOpen: () => {}, messages: null, unread: 0 });
    render(view());
    expect(screen.getByRole("button", { name: "Trip chat Open chat" })).toBeTruthy();
  });

  // Mitchell, PR 537 walk (2026-10-24): the same card, and still the way in.
  it("says so when nobody has written yet, and still opens the chat", async () => {
    const onOpen = vi.fn();
    offer({ onOpen, messages: [], unread: 0 });
    render(view());
    const card = screen.getByRole("button", { name: "Trip chat Open chat" });
    expect(within(card).getByText("No messages yet")).toBeTruthy();
    await userEvent.click(card);
    expect(onOpen).toHaveBeenCalledOnce();
  });

  // Mitchell, PR 537 walk (2026-10-24): a solo trip has no chat to open, so
  // the card is there, saying how to get one, and is no control.
  // Offered a chat as well, so that `solo` alone is what keeps the card from
  // being a control, and from drawing "Open chat" as if it were one (round 17).
  it("tells a reader alone on the trip how to get a chat, and opens nothing", () => {
    unregister.push(registerPhoneAsk({ open: false, onOpen: () => {}, soloTrip: true, chat: { onOpen: () => {}, messages: [], unread: 0 } }));
    render(view());
    const card = screen.getByRole("group", { name: "Trip chat" });
    expect(within(card).getByText("Add other travelers to see the trip chat")).toBeTruthy();
    expect(within(card).queryByText("Open chat")).toBeNull();
    expect(controls()).toEqual([]);
  });

  // Whether there is a chat at all is still being read (a notebook's cold
  // load): the card's frame holds its place, busy, and is no control yet.
  it("holds its place, and opens nothing, while the screen is still finding out whether there is a chat", () => {
    offer({ onOpen: () => {}, messages: null, unread: 0, pending: true });
    render(view());
    const card = screen.getByRole("group", { name: "Trip chat" });
    expect(card.getAttribute("aria-busy")).toBe("true");
    // The place held is the body's: the two lines a card with messages fills.
    expect(within(card).getAllByTestId("chat-recent-skeleton")).toHaveLength(2);
    expect(within(card).queryByText("Open chat")).toBeNull();
    expect(controls()).toEqual([]);
  });

  it("opens nothing from a click while the page is being edited", async () => {
    const onOpen = vi.fn();
    offer({ onOpen, messages: [message], unread: 0 });
    render(<ChatRecentBlock payload={{ kind: "chat-recent", solo: false, lines: [{ message, author: "Sam" }] }} interactive={false} />);
    expect(controls()).toEqual([]);
    await userEvent.click(screen.getByText("On the train"));
    expect(onOpen).not.toHaveBeenCalled();
  });

  // A member the chat refuses is offered no chat, and a share link's page
  // registers nothing at all: either way, no widget, not a disabled one.
  it("is absent where the screen offers Ask and no chat", () => {
    unregister.push(registerPhoneAsk({ open: false, onOpen: () => {}, onAsk: () => {} }));
    render(<div data-testid="page">{view()}</div>);
    expect(screen.getByTestId("page").textContent).toBe("");
  });

  it("is absent where no screen offers anything", () => {
    render(<div data-testid="page">{view()}</div>);
    expect(screen.getByTestId("page").textContent).toBe("");
  });
});
