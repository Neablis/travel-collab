// Mitchell's M46 walk: "Drop the unread count and just use a dot". A number
// on the pill widens it as the count grows (1, 12, 99+) and the header
// reflows; the dot says only that there is something unread, and the name
// still says how much. That the dot leaves the pill's box alone is measured
// in m46-trip-chat.spec.ts — jsdom lays nothing out.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AskPill } from "./AskPill";

afterEach(cleanup);

const pill = (unread: number | undefined) => {
  render(<AskPill open={false} onOpen={() => {}} unread={unread} />);
  return screen.getByTestId("ask-pill");
};

describe("AskPill's unread mark", () => {
  // The names are literals, not built from `unreadWords`, so a wrong count fails here.
  it.each([
    [1, "Ask or chat, 1 unread message"],
    [12, "Ask or chat, 12 unread messages"],
    [120, "Ask or chat, 120 unread messages"],
  ])("draws a dot and no count for %i unread, and still names them", (unread, name) => {
    const button = pill(unread);
    expect(button.textContent).toBe("Ask");
    expect(screen.getByTestId("ask-pill-unread").getAttribute("aria-hidden")).toBe("true");
    expect(button.getAttribute("aria-label")).toBe(name);
  });

  it.each([0, undefined])("draws no dot for %s unread", (unread) => {
    pill(unread);
    expect(screen.queryByTestId("ask-pill-unread")).toBeNull();
  });
});
