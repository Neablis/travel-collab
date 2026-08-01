import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tripDetailFixture, historyFixture } from "@/mocks/fixtures";

// A15: TripHeader now reads useRouter() (for the delete toast's post-dismiss
// navigation) — not exercised by the rename tests below, but the component
// calls it unconditionally on every render, so it needs a mount-time stub.
const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

const sendTripCommandMock = vi.fn();
const sendTripCommandBatchMock = vi.fn();

vi.mock("@/lib/apiClient", async (orig) => {
  const actual = await orig<typeof import("@/lib/apiClient")>();
  return {
    ...actual,
    fetchTripDetail: vi.fn().mockResolvedValue({ ok: true, value: tripDetailFixture({ tripId: "x", name: "Japan" }) }),
    fetchTripHistory: vi.fn().mockResolvedValue({ ok: true, value: historyFixture("x") }),
    fetchTripDetailAt: vi.fn(),
    sendTripCommand: (...args: unknown[]) => sendTripCommandMock(...args),
    sendTripCommandBatch: (...args: unknown[]) => sendTripCommandBatchMock(...args),
  };
});

// TripHeader reads everything from useTrip(), so it's rendered under a real
// TripProvider (apiClient mocked, per TripProvider.test.tsx's pattern) rather
// than a mocked context — this exercises the real dispatch -> sendTripCommand
// path, matching how the header's SetTripName dispatch actually resolves.
import { TripProvider } from "@/components/trip/context/TripProvider";
import { TripHeader } from "./TripHeader";

afterEach(cleanup);

beforeEach(() => {
  pushMock.mockReset();
  sendTripCommandMock.mockReset();
  sendTripCommandBatchMock.mockReset();
  sendTripCommandMock.mockResolvedValue({
    ok: true,
    value: { detail: tripDetailFixture({ tripId: "x", name: "Japan 2027" }), history: historyFixture("x") },
  });
});

async function renderHeader() {
  render(
    <TripProvider tripId="x">
      <TripHeader tripId="x" />
    </TripProvider>,
  );
  await waitFor(() => expect(screen.getByText("Japan")).toBeTruthy());
}

describe("TripHeader rename", () => {
  it("dispatches SetTripName when the title is edited", async () => {
    await renderHeader();

    await userEvent.click(screen.getByRole("button", { name: /rename trip/i }));
    const input = screen.getByRole("textbox", { name: /trip name/i });
    await userEvent.clear(input);
    await userEvent.type(input, "Japan 2027{Enter}");

    await waitFor(() =>
      expect(sendTripCommandMock).toHaveBeenCalledWith(
        expect.objectContaining({ type: "SetTripName", tripId: "x", name: "Japan 2027" }),
      ),
    );
  });

  it("does not dispatch when the name is unchanged", async () => {
    await renderHeader();

    await userEvent.click(screen.getByRole("button", { name: /rename trip/i }));
    const input = screen.getByRole("textbox", { name: /trip name/i });
    await userEvent.click(input);
    await userEvent.keyboard("{Enter}");

    expect(sendTripCommandMock).not.toHaveBeenCalled();
  });

  it("does not dispatch when the name is cleared to empty/whitespace", async () => {
    await renderHeader();

    await userEvent.click(screen.getByRole("button", { name: /rename trip/i }));
    const input = screen.getByRole("textbox", { name: /trip name/i });
    await userEvent.clear(input);
    await userEvent.type(input, "   {Enter}");

    expect(sendTripCommandMock).not.toHaveBeenCalled();
  });

  it("Escape cancels without dispatching and reverts to read-only", async () => {
    await renderHeader();

    await userEvent.click(screen.getByRole("button", { name: /rename trip/i }));
    const input = screen.getByRole("textbox", { name: /trip name/i });
    await userEvent.clear(input);
    await userEvent.type(input, "Something else");
    await userEvent.keyboard("{Escape}");

    expect(sendTripCommandMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox", { name: /trip name/i })).toBeNull();
    expect(screen.getByText("Japan")).toBeTruthy();
  });
});

// A15: exercises the cross-component handoff — SettingsSheet's own subtree
// closes on a successful delete, so it can't host the toast itself; it
// reports success via onDeleted and TripHeader raises the toast one level up
// (see the comment on TripHeader's deleteToast state).
describe("TripHeader delete/undo (A15)", () => {
  async function deleteViaSettings() {
    await userEvent.click(screen.getByRole("button", { name: /trip settings/i }));
    await userEvent.click(screen.getByRole("button", { name: /^delete trip$/i }));
    await userEvent.click(screen.getByRole("button", { name: /^delete$/i }));
  }

  it("raises an undo toast after a confirmed delete", async () => {
    await renderHeader();
    await deleteViaSettings();

    await waitFor(() =>
      expect(sendTripCommandMock).toHaveBeenCalledWith({ type: "DeleteTrip", tripId: "x" }),
    );
    const toast = await screen.findByRole("status");
    expect(toast.textContent).toMatch(/deleted "japan"/i);
  });

  it("undo dispatches RestoreTrip and dismisses the toast", async () => {
    await renderHeader();
    await deleteViaSettings();

    const toast = await screen.findByRole("status");
    // Scoped to the toast: TripHeader's own UndoRedoControls also has a
    // button named "Undo" for history undo, unrelated to this toast's action.
    await userEvent.click(within(toast).getByRole("button", { name: /undo/i }));

    await waitFor(() =>
      expect(sendTripCommandMock).toHaveBeenCalledWith({ type: "RestoreTrip", tripId: "x" }),
    );
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("dismissing without undo navigates back to the trip list", async () => {
    await renderHeader();
    await deleteViaSettings();

    const toast = await screen.findByRole("status");
    await userEvent.click(within(toast).getByRole("button", { name: /dismiss/i }));

    expect(pushMock).toHaveBeenCalledWith("/");
  });
});
