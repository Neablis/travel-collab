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
  dayIndex: 0,
});

const stops = [stop("Fushimi Inari", "09:00", "11:00"), stop("Nishiki", "13:00", "14:30")];

// A three-day trip, anchored on its THIRD day — so "Day 3 of Kyoto" still means
// what it meant before M23, and the picker has other days to offer. The first
// day is deliberately EMPTY: a rest day is selectable and the summary names it.
const DAY_1 = "22222222-2222-4222-8222-222222222222";
const DAY_2 = "33333333-3333-4333-8333-333333333333";
const tripDays = [
  { dayId: DAY_1, date: null, stops: [] },
  { dayId: DAY_2, date: null, stops: [stop("Arashiyama", "10:00", "12:00")] },
  { dayId, date: null, stops },
];

function renderDialog(
  overrides: {
    stops?: SavedStop[];
    days?: { dayId: string; date: string | null; stops: SavedStop[] }[];
    onSaved?: (name: string) => void;
  } = {},
) {
  const onOpenChange = vi.fn();
  const onSaved = overrides.onSaved ?? vi.fn();
  render(
    <KeepDayDialog
      open
      onOpenChange={onOpenChange}
      tripId={tripId}
      dayId={dayId}
      tripName="Kyoto"
      days={
        overrides.days ??
        (overrides.stops === undefined
          ? tripDays
          : [{ dayId, date: null, stops: overrides.stops }])
      }
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
    expect(screen.getByText("2 stops, 9 am – 2:30 pm. Order and gaps kept, no dates.")).toBeTruthy();
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
        dayIds: [dayId],
      }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSaved).toHaveBeenCalledWith("Day 3 of Kyoto");
  });

  // M23 link 4. The pennant still opens on one day; the picker adds others, and
  // they need not be adjacent — Mitchell, 2026-09-19: "you aren't selecting a
  // range".
  it("opens with only the clicked day selected, and offers the rest of the trip", () => {
    renderDialog();
    expect(screen.getByRole("button", { name: /Day 3/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /Day 1/ }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: /Day 2/ }).getAttribute("aria-pressed")).toBe("false");
  });

  it("keeps non-adjacent days, in trip order rather than click order", async () => {
    renderDialog();
    // Clicked LAST, but it is the trip's first day — so it must lead the
    // sequence, or a Playbook would depend on the order somebody happened to
    // tap two chips a calendar cannot show the order of.
    await userEvent.click(screen.getByRole("button", { name: /Day 1/ }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(createSavedDayMock).toHaveBeenCalledWith({
        name: "2 days of Kyoto",
        tripId,
        dayIds: [DAY_1, dayId],
      }),
    );
  });

  it("states the day count, and names an empty day as a rest day", async () => {
    renderDialog();
    await userEvent.click(screen.getByRole("button", { name: /Day 1/ }));
    expect(
      screen.getByText(/2 days, 2 stops, in order\. Order and gaps kept, no dates\. One day has no stops — kept as a rest day\./),
    ).toBeTruthy();
  });

  it("stops renaming once you have typed", async () => {
    renderDialog();
    await userEvent.clear(screen.getByLabelText("Name"));
    await userEvent.type(screen.getByLabelText("Name"), "Kansai in three");
    await userEvent.click(screen.getByRole("button", { name: /Day 1/ }));
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Kansai in three");
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
