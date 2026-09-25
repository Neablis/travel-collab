import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SavedStop } from "@tc/contracts";

const createSavedDayMock = vi.fn();
vi.mock("@/lib/apiClient", () => ({
  createSavedDay: (...args: unknown[]) => createSavedDayMock(...args),
}));

import { KeepDayDialog, type KeepDayCandidate } from "./KeepDayDialog";

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
  mode: null,
  endLocation: null,
});

const stops = [stop("Fushimi Inari", "09:00", "11:00"), stop("Nishiki", "13:00", "14:30")];

// A three-day trip, anchored on its THIRD day — so "Day 3 of Kyoto" still means
// what it meant before M23, and the picker has other days to offer. The first
// day is deliberately EMPTY: a rest day is selectable and the summary names it.
const DAY_1 = "22222222-2222-4222-8222-222222222222";
const DAY_2 = "33333333-3333-4333-8333-333333333333";
// Day 1 names no city — it has no stops for `cityFor` to read one from.
const tripDays: KeepDayCandidate[] = [
  { dayId: DAY_1, date: null, city: null, stops: [] },
  { dayId: DAY_2, date: null, city: "Arashiyama", stops: [stop("Bamboo grove", "10:00", "12:00")] },
  { dayId, date: null, city: "Kyoto", stops },
];

function renderDialog(
  overrides: {
    stops?: SavedStop[];
    days?: KeepDayCandidate[];
    onSaved?: (dayCount: number) => void;
  } = {},
) {
  const onOpenChange = vi.fn();
  const onSaved = overrides.onSaved ?? vi.fn();
  const element = (open: boolean) => (
    <KeepDayDialog
      open={open}
      onOpenChange={onOpenChange}
      tripId={tripId}
      dayId={dayId}
      tripName="Kyoto"
      days={
        overrides.days ??
        (overrides.stops === undefined
          ? tripDays
          : [{ dayId, date: null, city: "Kyoto", stops: overrides.stops }])
      }
      onSaved={onSaved}
    />
  );
  const { rerender } = render(element(true));
  // Closing and reopening the SAME mounted dialog — which is what the pennant
  // does, one dialog per board reused for every day.
  return { onOpenChange, onSaved, setOpen: (open: boolean) => rerender(element(open)) };
}

/**
 * Reveal the day picker — it is opt-in as of Mitchell's #192 feedback, so every
 * test that touches a day chip goes through this first.
 */
async function openPicker() {
  await userEvent.click(screen.getByRole("button", { name: "Do you want to add more days?" }));
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
    expect(screen.getByText("2 stops, 9 am – 2:30 pm.")).toBeTruthy();
    expect(screen.queryByPlaceholderText(/Stops, order, gaps/)).toBeNull();
  });

  // Mitchell, preview feedback on #192: "Drop the Order and gaps kept, no
  // dates". It described the storage model, not this day, so it read the same
  // on every keep anybody could make.
  it("does not restate what every Playbook does", async () => {
    renderDialog();
    await openPicker();
    await userEvent.click(screen.getByRole("button", { name: /Day 1/ }));
    expect(screen.queryByText(/Order and gaps kept/)).toBeNull();
    expect(screen.queryByText(/no dates/i)).toBeNull();
  });

  it("copes with a day whose stops have no times", () => {
    renderDialog({ stops: [{ ...stop("Wander", "09:00", "10:00"), timeWindow: null }] });
    expect(screen.getByText("1 stop, in order.")).toBeTruthy();
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
    await userEvent.click(screen.getByRole("button", { name: "Keep this day" }));

    await waitFor(() =>
      expect(createSavedDayMock).toHaveBeenCalledWith({
        name: "A day in Nakameguro",
        tripId,
        dayIds: [dayId],
      }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSaved).toHaveBeenCalledWith(1);
  });

  // KI-2026-09-19-d: the promised interaction is "accept the name and press
  // Enter". Radix focuses the first tabbable node in the dialog unless
  // something inside it already has focus — that was the header's Close button,
  // so a bare Enter on open closed the dialog and saved nothing. The keypress
  // goes to whatever has focus, with no click first, which is the whole point —
  // so where focus IS is asserted through what that keypress reaches, not by
  // reading `document.activeElement` (the test-quality wall bans it).
  it("opens with the name field focused, so a bare Enter keeps the day", async () => {
    const { onOpenChange, onSaved } = renderDialog();
    await userEvent.keyboard("{Enter}");

    await waitFor(() =>
      expect(createSavedDayMock).toHaveBeenCalledWith({
        name: "Day 3 of Kyoto",
        tripId,
        dayIds: [dayId],
      }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSaved).toHaveBeenCalledWith(1);
  });

  // §35.7: the button says what it keeps, not "Save" — and counts once there
  // is more than one day, so the number is on the control that acts on it.
  it("names the button for what it keeps", async () => {
    renderDialog();
    expect(screen.getByRole("button", { name: "Keep this day" })).toBeTruthy();
    await openPicker();
    await userEvent.click(screen.getByRole("button", { name: /Day 1/ }));
    await userEvent.click(screen.getByRole("button", { name: /Day 2/ }));
    expect(screen.getByRole("button", { name: "Keep 3 days" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Save$/ })).toBeNull();
  });

  // §35.7: `Day N · City`, the same city the day's chip names — and `Day N`
  // alone when the day has none, never a dangling separator.
  it("labels each day with its city, when it has one", async () => {
    renderDialog();
    await openPicker();
    const group = screen.getByRole("group", { name: "Days to keep" });
    expect(within(group).getByText("Day 2 · Arashiyama")).toBeTruthy();
    expect(within(group).getByText("Day 3 · Kyoto")).toBeTruthy();
    expect(within(group).getByText("Day 1")).toBeTruthy();
    expect(screen.getByText("Days — any, not just ones in a row")).toBeTruthy();
  });

  // §35.7: the Playbook renumbers from one, and a sequence that does not start
  // on the trip's first day says which day becomes its first.
  it("says which day becomes day 1 when the sequence starts later in the trip", async () => {
    renderDialog();
    await openPicker();
    await userEvent.click(screen.getByRole("button", { name: /Day 2/ }));
    expect(screen.getByText("2 days, 3 stops, in order. Day 2 becomes day 1.")).toBeTruthy();
  });

  describe("the preview", () => {
    // One day: its stops, with no header — nothing is renumbered, so a
    // "Day 1 · from Day 3" line would be noise.
    it("lists one day's stops with their start times and no day header", () => {
      renderDialog();
      const preview = screen.getByTestId("keep-day-preview");
      expect(within(preview).getByText("Fushimi Inari")).toBeTruthy();
      expect(within(preview).getByText("9 am")).toBeTruthy();
      expect(within(preview).getByText("1 pm")).toBeTruthy();
      expect(within(preview).queryByText(/from Day/)).toBeNull();
    });

    // Several days: a header per day carrying the renumbering, in trip order,
    // and a blank day says so rather than rendering as a gap.
    it("heads each of several days with where it came from, and names a rest day", async () => {
      renderDialog();
      await openPicker();
      await userEvent.click(screen.getByRole("button", { name: /Day 1/ }));
      await userEvent.click(screen.getByRole("button", { name: /Day 2/ }));
      const preview = screen.getByTestId("keep-day-preview");
      expect(within(preview).getAllByText(/from Day/).map((h) => h.textContent)).toEqual([
        "Day 1 · from Day 1",
        "Day 2 · from Day 2 · Arashiyama",
        "Day 3 · from Day 3 · Kyoto",
      ]);
      expect(within(preview).getByText("Rest day — no stops")).toBeTruthy();
      expect(within(preview).getByText("Bamboo grove")).toBeTruthy();
    });

    it("is not drawn when nothing is selected", async () => {
      renderDialog();
      await openPicker();
      await userEvent.click(screen.getByRole("button", { name: /Day 3/ }));
      expect(screen.queryByTestId("keep-day-preview")).toBeNull();
    });
  });

  // KI-2026-09-24-c: the server drops a calendar-date anchor on the way in, so
  // the dialog says which stops lose one before the button acts — and says
  // nothing about a weekday anchor, which is kept.
  it("names the stops whose calendar-date anchor will not be kept, and only those", async () => {
    const dated = (title: string): SavedStop => ({
      ...stop(title, "10:00", "11:00"),
      anchors: [{ kind: "dateRange", from: "2027-05-03", to: "2027-05-05" }],
    });
    const weekly: SavedStop = { ...stop("Temple", "12:00", "13:00"), anchors: [{ kind: "dayOfWeek", days: ["sun"] }] };
    renderDialog({ stops: [dated("Flea market"), weekly] });
    expect(screen.getByTestId("keep-day-dropped-dates").textContent).toBe(
      'A Playbook has no dates, so the date anchor on "Flea market" won\'t be kept.',
    );
    cleanup();
    renderDialog({ stops: [dated("Flea market"), weekly, dated("Night market")] });
    expect(screen.getByTestId("keep-day-dropped-dates").textContent).toBe(
      'A Playbook has no dates, so the date anchors on 2 stops won\'t be kept: "Flea market", "Night market".',
    );
    cleanup();
    renderDialog({ stops: [weekly] });
    expect(screen.queryByTestId("keep-day-dropped-dates")).toBeNull();
  });

  // M23 link 4. The pennant still opens on one day; the picker adds others, and
  // they need not be adjacent — Mitchell, 2026-09-19: "you aren't selecting a
  // range".
  it("opens with only the clicked day selected, and offers the rest of the trip", async () => {
    renderDialog();
    await openPicker();
    expect(screen.getByRole("button", { name: /Day 3/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /Day 1/ }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: /Day 2/ }).getAttribute("aria-pressed")).toBe("false");
  });

  it("keeps non-adjacent days, in trip order rather than click order", async () => {
    renderDialog();
    await openPicker();
    // Clicked LAST, but it is the trip's first day — so it must lead the
    // sequence, or a Playbook would depend on the order somebody happened to
    // tap two chips a calendar cannot show the order of.
    await userEvent.click(screen.getByRole("button", { name: /Day 1/ }));
    await userEvent.click(screen.getByRole("button", { name: "Keep 2 days" }));
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
    await openPicker();
    await userEvent.click(screen.getByRole("button", { name: /Day 1/ }));
    expect(
      screen.getByText(/2 days, 2 stops, in order\. One day has no stops — kept as a rest day\./),
    ).toBeTruthy();
  });

  // Mitchell, preview feedback on #192: "can we make selecting more days the
  // extra experience? Meaning, theres a button saying 'Do you want to add more
  // days?' and clicking it adds the calendar".
  it("keeps the day picker behind a button, and reveals it on one click", async () => {
    renderDialog();
    expect(screen.queryByRole("group", { name: "Days to keep" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Day 1/ })).toBeNull();
    await openPicker();
    expect(screen.getByRole("group", { name: "Days to keep" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Day 1/ })).toBeTruthy();
  });

  // The dialog is mounted once and reused for every pennant on the board, so
  // "opt-in" has to mean opt-in each time — otherwise expanding it on day 3
  // leaves day 4's dialog showing a strip nobody asked that dialog for.
  it("forgets an expanded picker when it reopens", async () => {
    const { setOpen } = renderDialog();
    await openPicker();
    expect(screen.getByRole("group", { name: "Days to keep" })).toBeTruthy();
    setOpen(false);
    setOpen(true);
    expect(screen.queryByRole("group", { name: "Days to keep" })).toBeNull();
  });

  // A one-day trip has no other day to add, so the question would be a dead
  // end — and the dialog is then exactly the one M11 shipped.
  it("does not offer to add days on a trip that has only one", () => {
    renderDialog({ stops });
    expect(screen.queryByRole("button", { name: /add more days/i })).toBeNull();
  });

  it("stops renaming once you have typed", async () => {
    renderDialog();
    await userEvent.clear(screen.getByLabelText("Name"));
    await userEvent.type(screen.getByLabelText("Name"), "Kansai in three");
    await openPicker();
    await userEvent.click(screen.getByRole("button", { name: /Day 1/ }));
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Kansai in three");
  });

  it("refuses a blank name rather than saving something unfindable", async () => {
    renderDialog();
    await userEvent.clear(screen.getByLabelText("Name"));
    await userEvent.click(screen.getByRole("button", { name: "Keep this day" }));
    expect(await screen.findByText("Give it a name you'll recognise later.")).toBeTruthy();
    expect(createSavedDayMock).not.toHaveBeenCalled();
  });

  it("cannot save an empty day", () => {
    renderDialog({ stops: [] });
    expect(screen.getByRole("button", { name: "Keep this day" }).hasAttribute("disabled")).toBe(true);
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
    await userEvent.click(screen.getByRole("button", { name: "Keep this day" }));
    expect(await screen.findByText("forbidden")).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
