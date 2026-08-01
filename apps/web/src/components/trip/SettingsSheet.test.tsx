import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

const sendTripCommandMock = vi.fn();
const duplicateTripMock = vi.fn();
vi.mock("@/lib/apiClient", () => ({
  sendTripCommand: (...args: unknown[]) => sendTripCommandMock(...args),
  duplicateTrip: (...args: unknown[]) => duplicateTripMock(...args),
}));

import { SettingsSheet } from "./SettingsSheet";

const tripId = "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f";

afterEach(cleanup);

beforeEach(() => {
  pushMock.mockReset();
  sendTripCommandMock.mockReset();
  duplicateTripMock.mockReset();
});

function renderSheet(onDeleted = vi.fn()) {
  render(
    <SettingsSheet
      tripId={tripId}
      tripName="Japan"
      open
      onOpenChange={vi.fn()}
      startDate={null}
      endDate={null}
      dayCount={0}
      currency="USD"
      budget={null}
      onCommand={vi.fn()}
      onDeleted={onDeleted}
    />,
  );
  return { onDeleted };
}

describe("SettingsSheet delete/duplicate (A15)", () => {
  it("confirms before deleting, then reports success via onDeleted", async () => {
    sendTripCommandMock.mockResolvedValue({ ok: true, value: {} });
    const { onDeleted } = renderSheet();

    await userEvent.click(screen.getByRole("button", { name: /^delete trip$/i }));
    // Confirmation gate: the command isn't sent until the dialog is confirmed.
    expect(sendTripCommandMock).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: /^delete$/i }));

    await waitFor(() =>
      expect(sendTripCommandMock).toHaveBeenCalledWith({ type: "DeleteTrip", tripId }),
    );
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith({ tripId, name: "Japan" }));
  });

  it("does not report success when the delete command fails", async () => {
    sendTripCommandMock.mockResolvedValue({ ok: false, error: { status: 400, message: "nope" } });
    const { onDeleted } = renderSheet();

    await userEvent.click(screen.getByRole("button", { name: /^delete trip$/i }));
    await userEvent.click(screen.getByRole("button", { name: /^delete$/i }));

    await waitFor(() => expect(sendTripCommandMock).toHaveBeenCalled());
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("duplicates the trip and navigates to the copy", async () => {
    const newTripId = "9f8e7d6c-5b4a-3928-1716-0f1e2d3c4b5a";
    duplicateTripMock.mockResolvedValue({ ok: true, value: { tripId: newTripId } });
    renderSheet();

    await userEvent.click(screen.getByRole("button", { name: /duplicate trip/i }));

    await waitFor(() => expect(duplicateTripMock).toHaveBeenCalledWith(tripId));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith(`/trips/${newTripId}`));
  });
});
