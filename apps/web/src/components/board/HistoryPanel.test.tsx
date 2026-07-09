import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TripHistory } from "@tc/contracts";
import { HistoryPanel } from "./HistoryPanel";

const TRIP = "7d9a1f8e-0000-4000-8000-00000000000a";
const history: TripHistory = {
  tripId: TRIP,
  canUndo: true,
  canRedo: false,
  entries: [
    {
      batchId: "7d9a1f8e-0000-4000-8000-000000000b02",
      fromSeq: 2, toSeq: 2, actorId: "u1", occurredAt: "2026-07-08T00:00:00.000Z",
      origin: { kind: "user" }, description: "Added Day 1", undone: true,
    },
    {
      batchId: "7d9a1f8e-0000-4000-8000-000000000b01",
      fromSeq: 1, toSeq: 1, actorId: "u1", occurredAt: "2026-07-08T00:00:00.000Z",
      origin: { kind: "user" }, description: 'Created trip "Rome"', undone: false,
    },
  ],
};

describe("HistoryPanel", () => {
  it("opens on toggle, lists entries newest-first, marks undone, previews on click", () => {
    const onPreview = vi.fn();
    render(
      <HistoryPanel history={history} previewSeq={null} onPreview={onPreview} onExitPreview={() => {}} onRevert={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    const items = screen.getAllByTestId("history-entry");
    expect(items[0]!.textContent).toContain("Added Day 1");
    expect(items[0]!.querySelector("s, [style*='line-through']")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Added Day 1/ }));
    expect(onPreview).toHaveBeenCalledWith(2);
  });
});
