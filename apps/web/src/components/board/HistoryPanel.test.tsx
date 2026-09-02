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
  // HistoryPanel no longer owns its own open/toggle state or trigger button —
  // it's meant to render as a Popover's content (TripHeader owns the Popover
  // and its "History" trigger, #13), so entries render immediately.
  it("lists entries newest-first, marks undone, previews on click", () => {
    const onPreview = vi.fn();
    render(
      <HistoryPanel history={history} previewSeq={null} onPreview={onPreview} onExitPreview={() => {}} onRevert={() => {}} />,
    );
    const items = screen.getAllByTestId("history-entry");
    expect(items[0]!.textContent).toContain("Added Day 1");
    // eslint-disable-next-line testing-library/no-node-access -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    expect(items[0]!.querySelector("s, [style*='line-through']")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Added Day 1/ }));
    expect(onPreview).toHaveBeenCalledWith(2);
  });

  it("bounds the entries list to a page size with a Show older affordance", () => {
    const manyEntries: TripHistory = {
      tripId: TRIP,
      canUndo: true,
      canRedo: false,
      entries: Array.from({ length: 25 }, (_, i) => ({
        batchId: `7d9a1f8e-0000-4000-8000-0000000000${String(i).padStart(2, "0")}`,
        fromSeq: i + 1, toSeq: i + 1, actorId: "u1", occurredAt: "2026-07-08T00:00:00.000Z",
        origin: { kind: "user" as const }, description: `Change ${i}`, undone: false,
      })),
    };
    render(
      <HistoryPanel history={manyEntries} previewSeq={null} onPreview={() => {}} onExitPreview={() => {}} onRevert={() => {}} />,
    );
    expect(screen.getAllByTestId("history-entry")).toHaveLength(20);
    fireEvent.click(screen.getByRole("button", { name: "Show older" }));
    expect(screen.getAllByTestId("history-entry")).toHaveLength(25);
  });

  // #16: while previewing a past version, the banner offers Revert plus an
  // exit control; the exit control is labelled "Dismiss" (was "Back to now",
  // which read as unobvious) and calls onExitPreview.
  it("in preview mode, Dismiss exits the preview", () => {
    const onExitPreview = vi.fn();
    render(
      <HistoryPanel history={history} previewSeq={1} onPreview={() => {}} onExitPreview={onExitPreview} onRevert={() => {}} />,
    );
    expect(screen.getByText(/Viewing version 1/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Revert to here" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onExitPreview).toHaveBeenCalledOnce();
  });
});
