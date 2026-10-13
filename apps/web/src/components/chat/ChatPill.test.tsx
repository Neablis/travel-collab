import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatPill } from "./ChatPill";

// M46 D5: the header's pill carries the unread count, in its name as well as
// its badge, so a screen reader hears it too.
describe("ChatPill", () => {
  it("names the unread count, and opens the chat", () => {
    const onOpen = vi.fn();
    render(<ChatPill unread={3} open={false} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: "Chat, 3 unread" }));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("is plain Chat with nothing unread", () => {
    render(<ChatPill unread={0} open={false} onOpen={() => {}} />);
    expect(screen.getByRole("button", { name: "Chat" })).toBeTruthy();
  });
});
