import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tripDetailFixture, historyFixture } from "@tc/factories";

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
    // M11 link 3: SettingsSheet withholds Delete unless the caller is the
    // OWNER, so the delete/undo tests below need a role read that says so.
    // Without this the spread above supplies the real `fetchTripAccess`, whose
    // fetch has no handler here — it resolves `ok:false`, `myRole` stays null,
    // and Delete is (correctly) not rendered at all.
    fetchTripAccess: vi.fn().mockResolvedValue({
      ok: true,
      value: { tripId: "x", myRole: "owner", members: [], invites: [] },
    }),
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

async function renderHeader(children?: React.ReactNode) {
  let editorState: ReturnType<typeof useEditor>["state"] | undefined;
  function EditorStateSpy() {
    editorState = useEditor().state;
    return null;
  }
  render(
    <TripProvider tripId="x">
      <EditorHost>
        <EditorStateSpy />
        <TripHeader tripId="x">{children}</TripHeader>
      </EditorHost>
      <TripStatusProbe />
    </TripProvider>,
  );
  await waitFor(() => expect(screen.getByText("Japan")).toBeTruthy());
  return { getEditorState: () => editorState };
}

// Renaming moved into the Trip settings sheet (PR #55 preview feedback: the
// pencil is gone and the title opens the sheet). The dispatch behaviour is
// covered where it now lives, in SettingsSheet.test.tsx — what belongs here
// is the door: that the title IS the way in, and that the controls it
// replaced are really gone rather than merely hidden.
describe("TripHeader trip settings entry point", () => {
  it("opens Trip settings from the trip title, and offers no pencil or cog", async () => {
    await renderHeader();

    expect(screen.queryByRole("button", { name: /rename trip/i })).toBeNull();
    // The cog carried this exact accessible name on its own; the title now
    // carries it alongside the trip's name, so an exact match finds nothing.
    expect(screen.queryByRole("button", { name: "Trip settings" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /trip settings/i }));
    expect(screen.getByRole("dialog", { name: /trip settings/i })).toBeTruthy();
  });

  it("keeps the trip name in the title's accessible name, not just the action", async () => {
    await renderHeader();
    // A bare aria-label="Trip settings" would have announced the control and
    // swallowed which trip it belongs to.
    expect(screen.getByRole("button", { name: /Japan/i })).toBeTruthy();
  });
});

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

  // Share (ShareButton, Task 18) is self-wrapped in its own <Preview> —
  // genuinely pointer-events shielded, not just an unwired Button, so a click
  // must actually fail to land (same assertion shape as preview.test.tsx/
  // KeepDayDialog.test.tsx's inert-control tests) and nothing downstream
  // fires: no dispatch, no navigation, no editor state change. Add a saved
  // day moved out of the header entirely (Task 1.4, M10 Wave 2 — the design
  // moved it into the plan flow; Phase 6 rebuilds it there), so it's no
  // longer part of this component to assert on.
  it("Share is genuinely inert: pointer-events shielded, never fires", async () => {
    const { getEditorState } = await renderHeader();

    await expect(userEvent.click(screen.getByRole("button", { name: "Share" }))).rejects.toThrow();

    expect(sendTripCommandMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
    expect(getEditorState()).toEqual({ mode: null });
  });

  it("keeps the view tabs and day chips inside the sticky header", async () => {
    await renderHeader(
      <>
        <div role="tablist" aria-label="Trip view" />
        <div role="group" aria-label="Days" />
      </>,
    );

    const header = screen.getByRole("banner", { name: "Trip" });
    expect(header.contains(screen.getByRole("tablist", { name: "Trip view" }))).toBe(true);
    expect(header.contains(screen.getByRole("group", { name: "Days" }))).toBe(true);
  });
});
