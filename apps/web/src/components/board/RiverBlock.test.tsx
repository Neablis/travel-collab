import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActivityView } from "@tc/contracts";
import { activityFactory } from "@tc/factories";
import { RiverBlock } from "./RiverBlock";

afterEach(cleanup);

// jsdom has no clipboard.
function stubClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  return writeText;
}

// M44 decision 1: a booked stop says so on its card. The tap is the editor's
// way to the code; below editor the server has already taken the code out
// (part 3), so what is checked here is that nothing is offered without one.
function renderBlock(booking: ActivityView["booking"], readOnly = false) {
  const stop = activityFactory.build({ title: "Hotel", booking, timeWindow: { start: "14:00", end: "16:00" } });
  render(
    <ul>
      <RiverBlock
        activity={stop}
        window={{ start: "14:00", end: "16:00" }}
        placement={{ id: stop.activityId, topPx: 0, heightPx: 120, lane: 0, lanes: 1, tier: "tall" }}
        accent="brand"
        hasConflict={false}
        overlap={null}
        overlapPartners={[]}
        currency="USD"
        onEdit={vi.fn()}
        onRemove={vi.fn()}
        onDismissOverlap={vi.fn()}
        readOnly={readOnly}
      />
    </ul>,
  );
}

describe("RiverBlock — the Booked chip", () => {
  it("is absent when nothing is booked", () => {
    renderBlock(null);
    expect(screen.queryByText(/^Booked/)).toBeNull();
  });

  it("copies the confirmation for an editor, says so, and offers the link", async () => {
    const writeText = stubClipboard();
    renderBlock({ confirmation: "ABC123", provider: "Hotel Okura", url: "https://okura.example/manage" });
    await userEvent.click(screen.getByRole("button", { name: "Booked · Hotel Okura" }));
    expect(writeText).toHaveBeenCalledWith("ABC123");
    expect(await screen.findByText("Confirmation copied")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open link" })).toBeTruthy();
  });

  it("reads just Booked with no provider", () => {
    renderBlock({ confirmation: "ABC123" });
    expect(screen.getByRole("button", { name: "Booked" })).toBeTruthy();
  });

  it("is inert for a reader, whose booking is only a provider", async () => {
    renderBlock({ provider: "Hotel Okura" }, true);
    expect(screen.getByText("Booked · Hotel Okura")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Booked/ })).toBeNull();
    await userEvent.click(screen.getByText("Booked · Hotel Okura"));
    expect(screen.queryByTestId("toast")).toBeNull();
  });

  // Below editor a code-only booking arrives as { provider: null } (part 3).
  it("reads just Booked, inert, for a reader whose booking has no provider", () => {
    renderBlock({ provider: null }, true);
    expect(screen.getByText("Booked")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Booked/ })).toBeNull();
  });

  // A read-side snapshot is not re-validated (part 2 review), and
  // `javascript:` is a valid URL: it must never become something to follow.
  it("never offers a javascript: link", async () => {
    stubClipboard();
    renderBlock({ confirmation: "ABC123", url: "javascript:alert(1)" });
    await userEvent.click(screen.getByRole("button", { name: "Booked" }));
    expect(await screen.findByText("Confirmation copied")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open link" })).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
