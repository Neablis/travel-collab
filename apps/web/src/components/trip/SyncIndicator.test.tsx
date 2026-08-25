import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SyncIndicator } from "./SyncIndicator";

afterEach(cleanup);

// Contract note (task 8b.3): the send queue (optimistic.ts's `failHead`)
// discards the pending queue on a failed send rather than reporting failure,
// so there is no error signal to render here — only saved/saving ship.
// `pending` stays boolean | number, not widened for a third state.
describe("SyncIndicator", () => {
  it("labels the saving state with visible text, in the brand voice", () => {
    render(<SyncIndicator pending={2} />);
    const status = screen.getByRole("status", { name: /saving/i });
    expect(status.textContent).toMatch(/saving/i);
  });

  it("keeps 'All changes saved' as the accessible name when the queue is drained, with no visible label text", () => {
    render(<SyncIndicator pending={0} />);
    const status = screen.getByRole("status", { name: "All changes saved" });
    // The saved state draws a bare dot — no rendered text. The accessible
    // name (title/aria-label) is the only place a screen reader gets
    // confirmation, so this asserts it's carried on the element attributes,
    // not derived from content.
    expect(status.textContent).toBe("");
    expect(status.getAttribute("title")).toBe("All changes saved");
    expect(status.getAttribute("aria-label")).toBe("All changes saved");
  });

  it("rejects a third 'error' pending state at compile time (compile-time assertion, not a runtime check)", () => {
    // Pins the contract note above: `pending` stays `boolean | number` until
    // the send queue can report a persisted failure. If this line stops
    // erroring, the prop widened without that decision being revisited.
    // @ts-expect-error -- "error" is not a valid `pending` value
    render(<SyncIndicator pending="error" />);
  });
});
