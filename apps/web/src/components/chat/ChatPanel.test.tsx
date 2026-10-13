import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChatMessage } from "@tc/contracts";
import { uuidFrom } from "@tc/factories";
import { ChatPanel, NO_ACCESS_LINE, READ_ONLY_LINE } from "./ChatPanel";
import type { TripChat } from "./useTripChat";

const chat = (over: Partial<TripChat> = {}): TripChat => ({
  status: "ready",
  messages: [
    ChatMessage.parse({
      messageId: uuidFrom(1, 46),
      authorId: "u-bea",
      createdAt: "2026-10-13T10:00:00.000Z",
      editedAt: null,
      removed: false,
      body: "Train at nine?",
    }),
  ],
  hasEarlier: false,
  unread: 0,
  canPost: true,
  post: async () => true,
  posting: false,
  postError: null,
  ...over,
});

describe("ChatPanel", () => {
  it("offers a composer to a member who may post", () => {
    render(<ChatPanel chat={chat()} personas={null} />);
    expect(screen.getByRole("textbox", { name: "Message" })).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  // M46 D2: after the owner's lapse the conversation stays readable, and the
  // composer says why instead of being there.
  it("is read-only after a lapse: the messages stay, the composer is a line saying why", () => {
    render(<ChatPanel chat={chat({ canPost: false })} personas={null} />);
    expect(within(screen.getByRole("list", { name: "Messages" })).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.queryByRole("textbox", { name: "Message" })).toBeNull();
    expect(screen.getByRole("status").textContent).toBe(READ_ONLY_LINE);
  });

  // M46 D2: a 403 says so, with a way out, instead of looking live.
  it("says the reader no longer has access, with a link home, and shows no conversation", () => {
    render(<ChatPanel chat={chat({ status: "no-access" })} personas={null} />);
    expect(screen.getByRole("status").textContent).toContain(NO_ACCESS_LINE);
    expect(screen.getByRole("link", { name: "Back to your trips" }).getAttribute("href")).toBe("/");
    expect(screen.queryByRole("list", { name: "Messages" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Message" })).toBeNull();
  });
});
