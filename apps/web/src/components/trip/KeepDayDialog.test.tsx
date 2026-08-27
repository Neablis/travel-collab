import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SavedStop } from "@tc/contracts";

const createSavedDayMock = vi.fn();
vi.mock("@/lib/apiClient", () => ({
  createSavedDay: (...args: unknown[]) => createSavedDayMock(...args),
}));

import { KeepDayDialog } from "./KeepDayDialog";

const tripId = "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f";
const dayId = "11111111-1111-4111-8111-111111111111";

const stop = (title: string, start: string, end: string): SavedStop => ({
  title,
  timeWindow: { start, end },
  location: null,
  notes: null,
  anchors: [],
  kind: "planned",
  tags: [],
  cost: null,
});

const stops = [stop("Fushimi Inari", "09:00", "11:00"), stop("Nishiki", "13:00", "14:30")];

function renderDialog(overrides: { stops?: SavedStop[]; onSaved?: (name: string) => void } = {}) {
  const onOpenChange = vi.fn();
  const onSaved = overrides.onSaved ?? vi.fn();
  render(
    <KeepDayDialog
      open
      onOpenChange={onOpenChange}
      tripId={tripId}
      dayId={dayId}
      dayIndex={2}
      tripName="Kyoto"
      stops={overrides.stops ?? stops}
      onSaved={onSaved}
    />,
  );
  return { onOpenChange, onSaved };
}

afterEach(cleanup);
beforeEach(() => {
  createSavedDayMock.mockReset().mockResolvedValue({
    ok: true,
    value: { savedDayId: "s1", name: "Day 3 of Kyoto" },
  });
});

// Real as of M11 link 6 — this was <Preview id="keep-day-dialog">, three inert
// fields and a Confirm with no onClick.
describe("KeepDayDialog", () => {
  it("offers a name you can accept without thinking", () => {
    renderDialog();
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Day 3 of Kyoto");
  });

  // The shell had this as a text INPUT placeholdered "Stops, order, gaps and
  // notes — no dates" — a statement about what gets saved, dressed as a
  // question. It is a read-only summary of the real day now.
  it("describes what is actually included, and is not a field", () => {
    renderDialog();
    expect(screen.getByText("2 stops, 9 am–2:30 pm. Order and gaps kept, no dates.")).toBeTruthy();
    expect(screen.queryByPlaceholderText(/Stops, order, gaps/)).toBeNull();
  });

  it("copes with a day whose stops have no times", () => {
    renderDialog({ stops: [{ ...stop("Wander", "09:00", "10:00"), timeWindow: null }] });
    expect(screen.getByText("1 stop, in order. No dates.")).toBeTruthy();
  });

  // Visibility (Only me / Trip collaborators / Anyone with the link) is gone:
  // two of the three are surfaces this milestone does not build (ADR-029).
  it("says saved days are private instead of offering a visibility it cannot honour", () => {
    renderDialog();
    expect(screen.queryByLabelText("Visibility")).toBeNull();
    expect(screen.getByText(/Saved days are private to you/)).toBeTruthy();
  });

  it("saves the day under the name given, and reports it", async () => {
    const { onOpenChange, onSaved } = renderDialog();
    await userEvent.clear(screen.getByLabelText("Name"));
    await userEvent.type(screen.getByLabelText("Name"), "A day in Nakameguro");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(createSavedDayMock).toHaveBeenCalledWith({
        name: "A day in Nakameguro",
        tripId,
        dayId,
      }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSaved).toHaveBeenCalledWith("Day 3 of Kyoto");
  });

  it("refuses a blank name rather than saving something unfindable", async () => {
    renderDialog();
    await userEvent.clear(screen.getByLabelText("Name"));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Give it a name you'll recognise later.")).toBeTruthy();
    expect(createSavedDayMock).not.toHaveBeenCalled();
  });

  it("cannot save an empty day", () => {
    renderDialog({ stops: [] });
    expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Nothing yet — this day has no stops.")).toBeTruthy();
  });

  it("Cancel closes without saving", async () => {
    const { onOpenChange } = renderDialog();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(createSavedDayMock).not.toHaveBeenCalled();
  });

  it("surfaces a refused save rather than closing as if it worked", async () => {
    createSavedDayMock.mockResolvedValue({ ok: false, error: { status: 403, message: "forbidden" } });
    const { onOpenChange } = renderDialog();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("forbidden")).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
