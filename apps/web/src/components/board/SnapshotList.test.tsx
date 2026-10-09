import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { TripHistory, TripSnapshot } from "@tc/contracts";
import { tripDetailFactory } from "@tc/factories";
import { makeTripHandlers } from "@/mocks/handlers";
import { HistoryPanel } from "./HistoryPanel";

const TRIP = "7d9a1f8e-0000-4000-8000-00000000005a";
const history: TripHistory = { tripId: TRIP, canUndo: true, canRedo: false, entries: [] };
const snapshot = (n: number, seq: number): TripSnapshot => ({
  id: `7d9a1f8e-0000-4000-8000-0000000005${String(n).padStart(2, "0")}`,
  tripId: TRIP,
  seq,
  name: `Snapshot ${n}`,
  createdBy: "dev-alice",
  createdAt: "2026-10-09T00:00:00.000Z",
});

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  cleanup();
});
afterAll(() => server.close());

function panel({ readOnly = false, onPreview = vi.fn(), onRestored = vi.fn() } = {}) {
  render(
    <HistoryPanel
      history={history}
      previewSeq={null}
      readOnly={readOnly}
      onPreview={onPreview}
      onExitPreview={() => {}}
      onRevert={() => {}}
      snapshots={{ tripId: TRIP, busy: false, onRestored }}
    />,
  );
  return { onPreview, onRestored };
}

const seeded = (snapshots: TripSnapshot[]) =>
  server.use(...makeTripHandlers(tripDetailFactory.build({ tripId: TRIP }), { snapshots }));

describe("HistoryPanel — snapshots", () => {
  it("saves one under the name typed, and lists it first", async () => {
    seeded([snapshot(1, 3)]);
    panel();
    await screen.findByRole("button", { name: "Snapshot 1" });
    await userEvent.type(screen.getByLabelText("Snapshot name"), "Before Kyoto");
    await userEvent.click(screen.getByRole("button", { name: "Save snapshot" }));
    await screen.findByRole("button", { name: "Before Kyoto" });
    expect(screen.getAllByTestId("snapshot").map((row) => row.textContent)).toEqual([
      expect.stringContaining("Before Kyoto"),
      expect.stringContaining("Snapshot 1"),
    ]);
  });

  it("says the server's reason when the save is refused", async () => {
    seeded([]);
    server.use(
      http.post("/api/trips/:tripId/snapshots", () =>
        HttpResponse.json(
          { error: "A trip keeps at most 20 snapshots. Delete one to save another.", code: "too-many-snapshots" },
          { status: 409 },
        ),
      ),
    );
    panel();
    await userEvent.type(await screen.findByLabelText("Snapshot name"), "One too many");
    await userEvent.click(screen.getByRole("button", { name: "Save snapshot" }));
    expect((await screen.findByRole("alert")).textContent).toContain("at most 20 snapshots");
  });

  it("restores through the route and hands the board its outcome", async () => {
    seeded([snapshot(1, 3)]);
    const { onRestored } = panel();
    await userEvent.click(await screen.findByRole("button", { name: "Restore Snapshot 1" }));
    await vi.waitFor(() => expect(onRestored).toHaveBeenCalledOnce());
    expect(onRestored.mock.calls[0]![0]).toMatchObject({ detail: { tripId: TRIP }, history: { tripId: TRIP } });
  });

  it("deletes only once asked twice", async () => {
    seeded([snapshot(1, 3), snapshot(2, 5)]);
    panel();
    await userEvent.click(await screen.findByRole("button", { name: "Delete Snapshot 1" }));
    const row = screen.getAllByTestId("snapshot")[0]!;
    expect(screen.getAllByTestId("snapshot")).toHaveLength(2);
    await userEvent.click(within(row).getByRole("button", { name: "Delete" }));
    await vi.waitFor(() => expect(screen.getAllByTestId("snapshot")).toHaveLength(1));
    expect(screen.queryByRole("button", { name: "Snapshot 1" })).toBeNull();
  });

  it("renames in place", async () => {
    seeded([snapshot(1, 3)]);
    panel();
    await userEvent.click(await screen.findByRole("button", { name: "Rename Snapshot 1" }));
    const field = screen.getByLabelText("New name for Snapshot 1");
    await userEvent.clear(field);
    await userEvent.type(field, "Day zero{Enter}");
    expect(await screen.findByRole("button", { name: "Day zero" })).toBeTruthy();
  });

  it("shows a reader the list to preview, and nothing that changes it", async () => {
    seeded([snapshot(1, 3)]);
    const { onPreview } = panel({ readOnly: true });
    await userEvent.click(await screen.findByRole("button", { name: "Snapshot 1" }));
    expect(onPreview).toHaveBeenCalledWith(3);
    for (const name of ["Save snapshot", "Restore Snapshot 1", "Rename Snapshot 1", "Delete Snapshot 1"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    expect(screen.queryByLabelText("Snapshot name")).toBeNull();
  });
});
