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
import { TripProvider, useTrip } from "@/components/trip/context/TripProvider";
// Task 9: TripHeader's new "Add stop" button calls useEditor().openCreate(),
// so it now needs an EditorHost ancestor (the real app tree provides one —
// trips/[tripId]/page.tsx wraps TripBoardScreen, which mounts TripHeader, in
// <EditorHost>). Same StateSpy pattern board.test.tsx uses to observe
// openCreate's effect on EditorHost's state without mocking useEditor.
import { EditorHost, useEditor } from "@/components/trip/context/EditorHost";
import { TripHeader } from "./TripHeader";

// A15-fix regression probe: mounted alongside TripHeader under the same
// TripProvider so the test can observe trip.status directly (there's no
// dedicated "deleted" banner in the UI yet to assert against instead — the
// bug this guards against is TripProvider's own local state staying stale,
// which is exactly what this exposes).
function TripStatusProbe() {
  const { trip } = useTrip();
  return <span data-testid="tripStatus">{trip?.status ?? "none"}</span>;
}

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
  let editorState: ReturnType<typeof useEditor>["state"] | undefined;
  function EditorStateSpy() {
    editorState = useEditor().state;
    return null;
  }
  render(
    <TripProvider tripId="x">
      <EditorHost>
        <EditorStateSpy />
        <TripHeader tripId="x" />
      </EditorHost>
      <TripStatusProbe />
    </TripProvider>,
  );
  await waitFor(() => expect(screen.getByText("Japan")).toBeTruthy());
  return { getEditorState: () => editorState };
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

  it("shows the new name immediately, before the server confirms it (optimistic)", async () => {
    // A deferred promise: sendTripCommand won't resolve until we say so, so
    // we can assert the heading already updated while the request is still
    // in flight — this is what "optimistic" actually means, not just "no
    // full-page reload". Regression coverage for TripHeader having read
    // `trip` (confirmed-only) instead of `activeTrip` (optimistic-aware).
    let resolveCommand: (value: { ok: true; value: unknown }) => void;
    sendTripCommandMock.mockReturnValue(
      new Promise((resolve) => {
        resolveCommand = resolve;
      }),
    );

    await renderHeader();

    await userEvent.click(screen.getByRole("button", { name: /rename trip/i }));
    const input = screen.getByRole("textbox", { name: /trip name/i });
    await userEvent.clear(input);
    await userEvent.type(input, "Japan 2027{Enter}");

    // Still in flight — sendTripCommandMock's promise hasn't resolved yet —
    // but the heading should already read the new name.
    await waitFor(() => expect(screen.getByText("Japan 2027")).toBeTruthy());
    expect(screen.queryByText("Japan")).toBeNull();

    resolveCommand!({
      ok: true,
      value: { detail: tripDetailFixture({ tripId: "x", name: "Japan 2027" }), history: historyFixture("x") },
    });
    await waitFor(() => expect(screen.getByText("Japan 2027")).toBeTruthy());
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
    const toast = await screen.findByTestId("toast");
    expect(toast.textContent).toMatch(/deleted "japan"/i);
  });

  it("undo dispatches RestoreTrip and dismisses the toast", async () => {
    await renderHeader();
    await deleteViaSettings();

    const toast = await screen.findByTestId("toast");
    // Scoped to the toast: TripHeader's own UndoRedoControls also has a
    // button named "Undo" for history undo, unrelated to this toast's action.
    await userEvent.click(within(toast).getByRole("button", { name: /undo/i }));

    await waitFor(() =>
      expect(sendTripCommandMock).toHaveBeenCalledWith({ type: "RestoreTrip", tripId: "x" }),
    );
    await waitFor(() => expect(screen.queryByTestId("toast")).toBeNull());
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("dismissing without undo navigates back to the trip list", async () => {
    await renderHeader();
    await deleteViaSettings();

    const toast = await screen.findByTestId("toast");
    await userEvent.click(within(toast).getByRole("button", { name: /dismiss/i }));

    expect(pushMock).toHaveBeenCalledWith("/");
  });

  // A15-fix: SettingsSheet.handleDelete() only forwarded {tripId, name} to
  // onDeleted, never the DeleteTrip CommandOutcome — TripHeader never called
  // applyOutcome for the delete itself (only for RestoreTrip/undo above), so
  // TripProvider's trip.status stayed "active" in local state for the whole
  // toast window even though the trip was already deleted server-side, and
  // the board (rename, undo/redo, day/activity edits, Settings) stayed fully
  // interactive against that stale state. Confirming this reconciles
  // immediately — not deferred until the toast closes — is the point of this
  // test.
  it("reconciles trip.status to \"deleted\" immediately after a confirmed delete, before the toast closes", async () => {
    sendTripCommandMock.mockImplementation((command: { type: string }) => {
      if (command.type === "DeleteTrip") {
        return Promise.resolve({
          ok: true,
          value: {
            detail: tripDetailFixture({ tripId: "x", name: "Japan", status: "deleted" }),
            history: historyFixture("x"),
          },
        });
      }
      return Promise.resolve({
        ok: true,
        value: {
          detail: tripDetailFixture({ tripId: "x", name: "Japan 2027" }),
          history: historyFixture("x"),
        },
      });
    });

    await renderHeader();
    expect(screen.getByTestId("tripStatus").textContent).toBe("active");

    await deleteViaSettings();

    await waitFor(() =>
      expect(sendTripCommandMock).toHaveBeenCalledWith({ type: "DeleteTrip", tripId: "x" }),
    );
    // The undo toast is still up (its 8s auto-dismiss hasn't fired, and this
    // test never advances any timers) — but trip.status already reflects the
    // delete, proving the reconciliation isn't waiting on the toast to close.
    expect(await screen.findByTestId("toast")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("tripStatus").textContent).toBe("deleted"));
  });
});

// Task 9: restyled header adds a neutral state Badge next to the trip name
// and a real "Add stop" trigger alongside the Task 18 Share/Add-a-saved-day
// placeholder slots. This only covers the new markup/wiring — every
// pre-existing behavior above (rename, sync, undo/redo, history, delete/
// undo-delete) is untouched by the restyle and stays covered by the
// describe blocks above.
describe("TripHeader restyle (Task 9)", () => {
  it("renders a neutral status Badge with the trip's status", async () => {
    await renderHeader();

    const badge = screen.getByText("Active");
    expect(badge.className).toMatch(/bg-moss/);
  });

  it("Add stop opens the portable editor with no dayId prefill", async () => {
    const { getEditorState } = await renderHeader();

    await userEvent.click(screen.getByRole("button", { name: "Add stop" }));

    expect(getEditorState()).toEqual({ mode: "create", prefill: undefined });
  });

  // Share and Add a saved day are Task 18's Preview seams — Task 9 only
  // reserves their slot in the layout. They must render but do nothing:
  // no dispatch, no navigation, no editor state change.
  it("Share and Add a saved day are inert placeholders", async () => {
    const { getEditorState } = await renderHeader();

    await userEvent.click(screen.getByRole("button", { name: "Share" }));
    await userEvent.click(screen.getByRole("button", { name: "Add a saved day" }));

    expect(sendTripCommandMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
    expect(getEditorState()).toEqual({ mode: null });
  });
});
