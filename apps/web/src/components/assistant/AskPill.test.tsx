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
  it.each([1, 12, 120])("draws a dot and no count for %i unread, and still names them", (unread) => {
    const button = pill(unread);
    expect(button.textContent).toBe("Ask");
    expect(screen.getByTestId("ask-pill-unread").getAttribute("aria-hidden")).toBe("true");
    expect(button.getAttribute("aria-label")).toMatch(/^Ask or chat, \d+ unread messages?$/);
  });

  it.each([0, undefined])("draws no dot for %s unread", (unread) => {
    pill(unread);
    expect(screen.queryByTestId("ask-pill-unread")).toBeNull();
  });
});
