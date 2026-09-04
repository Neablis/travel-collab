import { describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach } from "vitest";
import type { TripDetail, TripGlobals } from "@tc/contracts";
import { WidgetChrome } from "./WidgetChrome";

afterEach(cleanup);

const detail = {
  tripId: "11111111-1111-1111-1111-111111111111",
  name: "Japan", status: "active", startDate: "2026-08-01", currency: "USD", budget: null,
  members: [{ userId: "u1", role: "owner" }], forkedFrom: null,
  days: [
    { dayId: "22222222-2222-2222-2222-222222222222", activityIds: [], date: "2026-08-01", costSubtotal: 0 },
    { dayId: "33333333-3333-3333-3333-333333333333", activityIds: [], date: "2026-08-02", costSubtotal: 0 },
  ],
  backlog: [], activities: {}, conflicts: [], dismissedConflictIds: [],
  createdAt: "2026-07-20T00:00:00.000Z",
  unscheduledCostSubtotal: 0, tripCostTotal: 0, budgetRemaining: null,
} as unknown as TripDetail;

const globals = {
  days: [], cities: [],
  tags: [{ tag: "meal", activityCount: 2 }, { tag: "outdoors", activityCount: 1 }],
  bookedCount: 0,
} as unknown as TripGlobals;

const chrome = (params: Record<string, unknown>, onChange = vi.fn(), g: TripGlobals | null = globals) => {
  render(<WidgetChrome name="stop.line" params={params} detail={detail} globals={g} onChange={onChange} />);
  return onChange;
};

describe("WidgetChrome with a two-input widget", () => {
  it("renders one control per declared input", () => {
    chrome({});
    expect(screen.getByRole("combobox", { name: /a line for every stop: day/i })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: /a line for every stop: tags/i })).toBeTruthy();
  });

  // THE reason this component changed. The old `onChange` replaced the whole
  // params object, so choosing a tag would have silently unbound the day — and
  // the widget would then say "no day set" while the day control still showed a
  // choice, a control contradicting the document it describes.
  it("setting one input preserves the other", async () => {
    const onChange = chrome({ dayRef: { kind: "index", index: 1 } });
    await userEvent.selectOptions(screen.getByRole("combobox", { name: /tags/i }), "meal");
    expect(onChange).toHaveBeenCalledWith({ dayRef: { kind: "index", index: 1 }, tag: "meal" });
  });

  it("clearing one input preserves the other, and clears by removing the key", async () => {
    const onChange = chrome({ dayRef: { kind: "index", index: 1 }, tag: "meal" });
    await userEvent.selectOptions(screen.getByRole("combobox", { name: /tags/i }), "");
    // `{}` is the one spelling of "not set up" (ADR-037 decision 6), so the key
    // is deleted rather than set to null or "".
    expect(onChange).toHaveBeenCalledWith({ dayRef: { kind: "index", index: 1 } });
  });

  it("shows each input's current value, so the controls agree with the document", () => {
    chrome({ dayRef: { kind: "index", index: 1 }, tag: "outdoors" });
    expect((screen.getByRole("combobox", { name: /day/i }) as HTMLSelectElement).value).toBe("1");
    expect((screen.getByRole("combobox", { name: /tags/i }) as HTMLSelectElement).value).toBe("outdoors");
  });

  // §18's table: a tag input reads "every stop, or one", so unset is a real
  // answer with its own meaning rather than an unfilled blank.
  it("words an unset tag as the answer it is, not as 'Not set up'", () => {
    chrome({});
    const tags = screen.getByRole("combobox", { name: /tags/i });
    expect(within(tags).getByRole("option", { name: "Every stop" })).toBeTruthy();
    expect((tags as HTMLSelectElement).value).toBe("");
  });

  it("offers the trip's tags in use, not every tag the enum has", () => {
    chrome({});
    const tags = screen.getByRole("combobox", { name: /tags/i });
    const options = within(tags).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Every stop", "meal", "outdoors"]);
    // "lodging" and "ticketed" are real ActivityTag members this trip does not
    // use. Offering them is a filter whose only outcome is an empty widget.
    expect(options).not.toContain("lodging");
  });

  it("still offers 'every stop' when the globals projection did not load", () => {
    chrome({}, vi.fn(), null);
    const tags = screen.getByRole("combobox", { name: /tags/i });
    expect(within(tags).getAllByRole("option").map((o) => o.textContent)).toEqual(["Every stop"]);
  });
});

// Both of these are the same failure from two directions: a control that
// disagrees with the document it describes. The reader believes the control, so
// this is worse than either state alone. Found by Copilot on PR 139.
describe("WidgetChrome shows what the document actually holds", () => {
  it("resolves a dayId binding to its day, rather than reading it as unset", () => {
    chrome({ dayRef: { kind: "dayId", dayId: "33333333-3333-3333-3333-333333333333" } });
    expect((screen.getByRole("combobox", { name: /day/i }) as HTMLSelectElement).value).toBe("1");
  });

  // A stale binding is silently no binding, never a guessed one — the same
  // answer `resolveDayIndex` gives, so the control and the widget agree.
  it("reads a dayId for a day that no longer exists as unset", () => {
    chrome({ dayRef: { kind: "dayId", dayId: "99999999-9999-9999-9999-999999999999" } });
    expect((screen.getByRole("combobox", { name: /day/i }) as HTMLSelectElement).value).toBe("");
  });

  it("reads an index past the end of the trip as unset", () => {
    chrome({ dayRef: { kind: "index", index: 99 } });
    expect((screen.getByRole("combobox", { name: /day/i }) as HTMLSelectElement).value).toBe("");
  });

  // Globals still loading, failed, or the last stop with that tag removed. The
  // native select would otherwise fall back to displaying "Every stop" while the
  // widget is still filtering by the saved tag.
  it("keeps a bound tag in the list when globals do not carry it", () => {
    chrome({ tag: "lodging" });
    const tags = screen.getByRole("combobox", { name: /tags/i });
    expect((tags as HTMLSelectElement).value).toBe("lodging");
    expect(within(tags).getAllByRole("option").map((o) => o.textContent)).toContain("lodging");
  });

  it("keeps a bound tag visible even with no globals at all", () => {
    chrome({ tag: "meal" }, vi.fn(), null);
    const tags = screen.getByRole("combobox", { name: /tags/i });
    expect((tags as HTMLSelectElement).value).toBe("meal");
  });
});

describe("WidgetChrome with other widgets", () => {
  it("renders nothing for a widget that binds nothing", () => {
    const { container } = render(
      <WidgetChrome name="trip.name" params={{}} detail={detail} globals={globals} onChange={vi.fn()} />,
    );
    expect(container.textContent).toBe("");
  });

  it("renders a single control for a one-input widget", () => {
    render(<WidgetChrome name="cost.day" params={{}} detail={detail} globals={globals} onChange={vi.fn()} />);
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
  });
});
