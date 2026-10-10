import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { NearbyStop, type ActivityView, type Anchor } from "@tc/contracts";
import { locationFactory } from "@tc/factories";
import { accessibleNames } from "@/test-support/accessibleNames";
import { ActivityEditor, type NamedMember } from "./ActivityEditor";

describe("ActivityEditor", () => {
  it("offers no anchor affordance", () => {
    const props = {
      initial: null,
      mode: "create" as const,
      days: [],
      onSave: vi.fn(),
      onCancel: vi.fn(),
    };
    render(<ActivityEditor {...props} />);
    expect(screen.queryByText(/anchor/i)).toBeNull();
  });

  it("round-trips existing anchors unchanged through an edit-and-save", () => {
    const anchors: Anchor[] = [{ kind: "dayOfWeek", days: ["mon"] }];
    const initial: ActivityView = {
      activityId: "11111111-1111-1111-1111-111111111111",
      title: "Colosseum tour",
      timeWindow: null,
      location: null,
      notes: null,
      anchors,
      kind: "planned" as const,
      tags: [],
      cost: null,
      bookedBy: null,
      participants: [],
      mode: null,
      endLocation: null,
      pendingReason: null,
    };
    const onSave = vi.fn();
    const props = { initial, mode: "edit" as const, days: [], onSave, onCancel: vi.fn() };
    render(<ActivityEditor {...props} />);

    fireEvent.change(screen.getByLabelText("What or where"), {
      target: { value: "Colosseum night tour" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ anchors }));
  });

  it("reads a length drawn to midnight, stored ending 23:59, as the two hours it is", () => {
    const initial = { ...existingStop({ timeWindow: { start: "22:00", end: "23:59" } }), kind: "pending" as const };
    render(<ActivityEditor initial={initial} mode="create" days={[]} onSave={vi.fn()} onCancel={vi.fn()} />);

    const howLong = screen.getByLabelText("How long") as HTMLSelectElement;
    expect(howLong.selectedOptions[0]?.textContent).toBe("2 hours");
  });
});

const EXISTING = "22222222-2222-4222-8222-222222222222";

function existingStop(overrides: Partial<ActivityView> = {}): ActivityView {
  return {
    activityId: EXISTING,
    title: "Shinkansen to Kyoto",
    timeWindow: null,
    location: null,
    notes: null,
    anchors: [],
    kind: "planned",
    tags: [],
    cost: null,
    bookedBy: null,
    participants: [],
    mode: null,
    endLocation: null,
    pendingReason: null,
    ...overrides,
  };
}

function renderEditor(initial: ActivityView | null, mode: "create" | "edit", onSave = vi.fn()) {
  render(<ActivityEditor initial={initial} mode={mode} days={[]} onSave={onSave} onCancel={vi.fn()} />);
  return onSave;
}

// The Kind control is a segmented radio group (SPEC §36.9), so a kind is
// chosen by its visible name and read back from `aria-checked`.
const KIND_NAME = { planned: "Planned", pending: "Pending", transit: "Travel" } as const;
function pickKind(kind: keyof typeof KIND_NAME) {
  fireEvent.click(within(screen.getByRole("radiogroup", { name: "Kind" })).getByRole("radio", { name: KIND_NAME[kind] }));
}
function checkedKind(): string | null {
  const on = within(screen.getByRole("radiogroup", { name: "Kind" }))
    .getAllByRole("radio")
    .filter((r) => r.getAttribute("aria-checked") === "true");
  return on.length === 1 ? on[0]!.textContent : null;
}

describe("ActivityEditor kind picker", () => {
  it("offers the three kinds", () => {
    renderEditor(null, "create");
    const options = within(screen.getByRole("radiogroup", { name: "Kind" })).getAllByRole("radio").map((r) => r.textContent);
    expect(options).toEqual(["Planned", "Pending", "Travel"]);
  });

  // Mitchell, 2026-08-29: a stop being CREATED defaults to "pending" ("hold"
  // until M28), not the contract's "planned" zero value — more likely to need
  // booking than not. Editing keeps its own kind; see the next test.
  it("defaults to pending when adding, with no prefill", () => {
    renderEditor(null, "create");
    expect(checkedKind()).toBe("Pending");
  });

  // Mitchell's preview comment, 2026-10-04: "Drop Kind, and leave just the
  // description". The control keeps its name for assistive tech.
  it("says what the chosen kind means, with no visible Kind label", () => {
    renderEditor(null, "create");
    expect(screen.queryByText("Kind", { exact: true })).toBeNull();
    expect(screen.getByRole("radiogroup", { name: "Kind" })).toBeTruthy();
    expect(screen.getByText("Not locked in yet")).toBeTruthy();
  });

  it("defaults to the stop's own kind when editing", () => {
    renderEditor(existingStop({ kind: "transit" }), "edit");
    expect(checkedKind()).toBe("Travel");
  });

  // A stated kind always wins over the create-mode default — the default only
  // fills in for "nothing was stated", the same rule the assistant's write
  // tool applies (writeTools.ts's withDefaultKind).
  it("keeps an explicitly-supplied initial kind in create mode, rather than overriding to pending", () => {
    renderEditor(existingStop({ activityId: "", kind: "planned" }), "create");
    expect(checkedKind()).toBe("Planned");
  });

  it("sends the chosen kind on save", () => {
    const onSave = renderEditor(null, "create");
    fireEvent.change(screen.getByLabelText("What or where"), { target: { value: "Gora Kadan" } });
    // `planned`, not the create default, so the choice is what is asserted.
    pickKind("planned");
    fireEvent.click(screen.getByRole("button", { name: "Add stop" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ kind: "planned" }));
  });

  it("round-trips the stop's kind through an untouched edit", () => {
    const onSave = renderEditor(existingStop({ kind: "pending" }), "edit");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ kind: "pending" }));
  });
});

// M24. The decider refuses a travel leg on any kind but `transit`, so a stop
// that leaves transit has to take its leg with it — cleared by the form on
// save, never by the domain behind the user's back.
describe("ActivityEditor travel leg", () => {
  const leg = { kind: "transit" as const, mode: "train" as const, endLocation: { name: "Kyoto Station" } };

  it("edits the mode and destination only while the stop is transit", () => {
    renderEditor(existingStop(leg), "edit");
    expect(screen.getByRole("radio", { name: "Train" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByLabelText("Going to")).toBeTruthy();
    pickKind("pending");
    expect(screen.queryByRole("radiogroup", { name: "Travelling by" })).toBeNull();
    expect(screen.queryByLabelText("Going to")).toBeNull();
  });

  it("clears the leg on save when the kind moves away from transit, and keeps it otherwise", () => {
    const onSave = renderEditor(existingStop(leg), "edit");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining(leg));

    pickKind("pending");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "pending", mode: null, endLocation: null }));
  });

  // Preview feedback on #230: icon buttons, no visible header — so the group's
  // name and each mode's name exist only for assistive tech, and are asserted.
  it("offers every mode as a named radio in a group named Travelling by, none chosen on a new transit stop", () => {
    renderEditor(null, "create");
    pickKind("transit");
    const radios = within(screen.getByRole("radiogroup", { name: "Travelling by" })).getAllByRole("radio");
    expect(radios.map((r) => r.getAttribute("aria-label"))).toEqual(["On foot", "Bus", "Train", "Flight", "Ferry", "Car", "Bike"]);
    expect(radios.filter((r) => r.getAttribute("aria-checked") === "true")).toHaveLength(0);
  });

  it("chooses a mode on click and clears it when the chosen one is clicked again", () => {
    const onSave = renderEditor(existingStop({ kind: "transit" }), "edit");
    const train = screen.getByRole("radio", { name: "Train" });
    fireEvent.click(train);
    expect(train.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ mode: "train" }));

    fireEvent.click(train);
    expect(train.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ mode: null }));
  });

  // Focus is proven by where the NEXT keypress lands, not by reading
  // `document.activeElement` (the test-quality wall bans it): each arrow only
  // reaches the radio it is meant to if the previous one moved focus there.
  it("moves the choice and focus with the arrow keys, wrapping at the ends", async () => {
    renderEditor(existingStop(leg), "edit");
    screen.getByRole("radio", { name: "Train" }).focus();
    await userEvent.keyboard("{ArrowRight}{ArrowRight}");
    expect(screen.getByRole("radio", { name: "Ferry" }).getAttribute("aria-checked")).toBe("true");
    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}");
    expect(screen.getByRole("radio", { name: "Bike" }).getAttribute("aria-checked")).toBe("true");
  });

  // Two place pickers on one form: a screen reader listing the buttons must be
  // able to tell the origin's Search/Clear from the destination's.
  it("names the destination's Search and Clear apart from the origin's", () => {
    renderEditor(existingStop({ ...leg, location: { name: "Tokyo Station" } }), "edit");
    expect(screen.getAllByRole("button", { name: "Search" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Clear" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Search Going to" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Clear Going to" })).toBeTruthy();
  });
});

// ADR-055. Why a pending stop is pending, as the same icon-radio row a
// transit stop's mode uses — and cleared on save off `pending`, because the
// decider refuses a reason left on any other kind.
describe("ActivityEditor pending reason", () => {
  const reasonGroup = () => screen.getByRole("radiogroup", { name: "Why it is pending" });

  it("offers To book and Maybe, and a new stop starts on To book", () => {
    const onSave = renderEditor(null, "create");
    const radios = within(reasonGroup()).getAllByRole("radio");
    expect(radios.map((r) => r.getAttribute("aria-label"))).toEqual(["To book", "Maybe"]);
    fireEvent.change(screen.getByLabelText("What or where"), { target: { value: "Kikunoi Roan" } });
    fireEvent.click(screen.getByRole("button", { name: "Add stop" }));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "pending", pendingReason: "book" }));
  });

  it("keeps an edited stop's missing reason missing, rather than inventing one", () => {
    const onSave = renderEditor(existingStop({ kind: "pending" }), "edit");
    expect(within(reasonGroup()).getAllByRole("radio").filter((r) => r.getAttribute("aria-checked") === "true")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ pendingReason: null }));
  });

  it("chooses a reason on click and clears it when the chosen one is clicked again", () => {
    const onSave = renderEditor(existingStop({ kind: "pending", pendingReason: "book" }), "edit");
    const maybe = screen.getByRole("radio", { name: "Maybe" });
    fireEvent.click(maybe);
    expect(maybe.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "To book" }).getAttribute("aria-checked")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ pendingReason: "maybe" }));

    fireEvent.click(maybe);
    expect(maybe.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ pendingReason: null }));
  });

  it("shows only while the stop is pending, and saves no reason once it is not", () => {
    const onSave = renderEditor(existingStop({ kind: "pending", pendingReason: "maybe" }), "edit");
    pickKind("planned");
    expect(screen.queryByRole("radiogroup", { name: "Why it is pending" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "planned", pendingReason: null }));
  });

  // Only what is SAVED is cleared off-kind; the choice itself survives a trip
  // through another kind, so a mis-click on Planned does not lose it.
  it("keeps the reason chosen in this session when the kind goes to planned and back", () => {
    const onSave = renderEditor(existingStop({ kind: "pending", pendingReason: "book" }), "edit");
    fireEvent.click(screen.getByRole("radio", { name: "Maybe" }));
    pickKind("planned");
    pickKind("pending");
    expect(screen.getByRole("radio", { name: "Maybe" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "pending", pendingReason: "maybe" }));
  });
});

describe("ActivityEditor tag picker", () => {
  it("offers the four contract tags and never the handoff's six (KI-52)", () => {
    renderEditor(null, "create");
    const group = screen.getByRole("group", { name: "Tags" });
    // eslint-disable-next-line testing-library/no-node-access -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    const labels = Array.from(group.querySelectorAll("button")).map((b) => b.textContent);
    expect(labels).toEqual(["Meal", "Lodging", "Ticketed", "Outdoors"]);
    expect(screen.queryByRole("button", { name: /considering/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^travel$/i })).toBeNull();
  });

  it("starts with nothing selected when adding", () => {
    const onSave = renderEditor(null, "create");
    expect(screen.getByRole("button", { name: "Meal" }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.change(screen.getByLabelText("What or where"), { target: { value: "Gora Kadan" } });
    fireEvent.click(screen.getByRole("button", { name: "Add stop" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ tags: [] }));
  });

  it("shows the stop's existing tags as pressed when editing", () => {
    renderEditor(existingStop({ tags: ["lodging"] }), "edit");
    expect(screen.getByRole("button", { name: "Lodging" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Meal" }).getAttribute("aria-pressed")).toBe("false");
  });

  // UpdateActivity.tags is a whole-array replace (packages/contracts/src/
  // activity.ts), so the form always sends the complete set, never a delta.
  it("sends the whole array when a tag is added", () => {
    const onSave = renderEditor(existingStop({ tags: ["lodging"] }), "edit");
    fireEvent.click(screen.getByRole("button", { name: "Meal" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ tags: ["meal", "lodging"] }));
  });

  it("sends the whole array when a tag is removed", () => {
    const onSave = renderEditor(existingStop({ tags: ["meal", "outdoors"] }), "edit");
    fireEvent.click(screen.getByRole("button", { name: "Meal" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ tags: ["outdoors"] }));
  });
});

// M13 link 5 — "set through the UI", the gate box's own words. Two controls
// because they answer two questions: who is GOING (participants) and who
// BOOKED it (bookedBy). A single "who" would read fine and be wrong for every
// cost split M19 later derives from the participants.
describe("ActivityEditor attribution (M13 link 5)", () => {
  // Ids that are not the names, so a control labelled with the id is caught.
  const MEMBERS: NamedMember[] = [
    { userId: "u-alice", name: "Alice" },
    { userId: "u-bob", name: "Bob" },
  ];
  const stop = (over: Partial<ActivityView> = {}): ActivityView => ({
    activityId: "11111111-1111-1111-1111-111111111111",
    title: "Colosseum",
    timeWindow: null,
    location: null,
    notes: null,
    anchors: [],
    kind: "planned",
    tags: [],
    cost: null,
    bookedBy: null,
    participants: [],
    mode: null,
    endLocation: null,
    pendingReason: null,
    ...over,
  });

  const mount = (initial: ActivityView | null, members = MEMBERS) => {
    const onSave = vi.fn();
    render(
      <ActivityEditor
        initial={initial}
        mode={initial === null ? "create" : "edit"}
        days={[]}
        members={members}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );
    return onSave;
  };
  const save = () => fireEvent.click(screen.getByRole("button", { name: /save/i }));

  // ADR-060: the price typed here is for one person, and the line under it
  // multiplies by who is going — everyone when nobody is picked — live.
  it("labels Cost per person and shows the stop's total for its headcount", () => {
    mount(stop({ cost: { amountMinor: 30_00, currency: "USD" } }));
    expect(screen.getByLabelText("Cost per person")).toBeTruthy();
    expect(screen.getByTestId("activity-cost-total").textContent).toBe("× 2 people = $60.00");
    fireEvent.click(screen.getByRole("button", { name: "Bob" }));
    expect(screen.getByTestId("activity-cost-total").textContent).toBe("× 1 person = $30.00");
  });

  // The line's room is kept with no cost to show. MoneyInput commits on blur,
  // so the line used to APPEAR on the mousedown that blurs the field — on
  // "Add stop" — and push the buttons below it out from under the pointer: the
  // mouseup landed elsewhere and the first click saved nothing (found by
  // m4-money-and-lenses, 4 of 4 runs). jsdom has no layout, so what is pinned
  // is that the element is there, holding one line, and says nothing.
  it("shows no total for a stop with no cost, but keeps the line's room", () => {
    mount(stop());
    const line = screen.getByTestId("activity-cost-total");
    expect(line.textContent).toBe("\u00a0");
    expect(line.getAttribute("aria-hidden")).toBe("true");
  });

  it("offers one toggle per member and sends who is going", () => {
    const onSave = mount(stop());
    fireEvent.click(screen.getByRole("button", { name: "Bob" }));
    save();
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ participants: ["u-bob"] }));
  });

  // Booked by decides who is owed money (ADR-060 decision 6), so both
  // controls read as people. The id is the value, never the label.
  it("labels both controls with the members' names, not their ids", () => {
    mount(stop());
    const group = screen.getByRole("group", { name: "Who is going" });
    expect(accessibleNames(group, "button")).toEqual(["Alice", "Bob"]);
    const options = [...(screen.getByLabelText("Booked by") as HTMLSelectElement).options];
    expect(options.map((o) => [o.value, o.text])).toEqual([
      ["", "Nobody yet"],
      ["u-alice", "Alice"],
      ["u-bob", "Bob"],
    ]);
  });

  // M38: a pill leads with the person's chip, and Booked by — a native select,
  // whose options cannot hold an icon — draws the chosen person's beside it.
  it("draws each person's chip in their pill, and the booker's beside Booked by", () => {
    mount(stop(), [
      { userId: "u-alice", name: "Alice", avatar: "mountain", color: "plum" },
      { userId: "u-bob", name: "Bob", avatar: "camera", color: "ochre" },
    ]);
    expect(screen.getByRole("button", { name: "Alice" }).innerHTML).toContain("lucide-mountain");
    const booked = screen.getByTestId("booked-by");
    expect(booked.innerHTML).not.toContain("lucide-");

    fireEvent.change(screen.getByLabelText("Booked by"), { target: { value: "u-bob" } });
    expect(booked.innerHTML).toContain("lucide-camera");
  });

  it("sends who booked it, separately from who is going", () => {
    const onSave = mount(stop());
    fireEvent.click(screen.getByRole("button", { name: "Bob" }));
    fireEvent.change(screen.getByLabelText("Booked by"), { target: { value: "u-alice" } });
    save();
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ bookedBy: "u-alice", participants: ["u-bob"] }),
    );
  });

  it("seeds both from the stop being edited", () => {
    mount(stop({ bookedBy: "u-alice", participants: ["u-bob"] }));
    expect(screen.getByRole("button", { name: "Bob" }).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByLabelText("Booked by") as HTMLSelectElement).value).toBe("u-alice");
  });

  // The drop this milestone's preflight exists to prevent: an edit that never
  // touches attribution must not clear it.
  it("round-trips attribution through an unrelated edit", () => {
    const onSave = mount(stop({ bookedBy: "u-alice", participants: ["u-bob"] }));
    fireEvent.change(screen.getByLabelText("What or where"), { target: { value: "Colosseum tour" } });
    save();
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ bookedBy: "u-alice", participants: ["u-bob"] }),
    );
  });

  it("clears who booked it back to nobody", () => {
    const onSave = mount(stop({ bookedBy: "u-alice" }));
    fireEvent.change(screen.getByLabelText("Booked by"), { target: { value: "" } });
    save();
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ bookedBy: null }));
  });

  // Travellers spec D6/D7: nobody picked is the travellers; a non-traveller is
  // offered after them, counts once picked, and may still have booked it. Carol
  // is listed first, as an owner who is not going would be (D5).
  it("prices nobody picked for the travellers and offers a non-traveller apart, tagged once picked", () => {
    mount(stop({ cost: { amountMinor: 30_00, currency: "USD" } }), [
      { userId: "u-carol", name: "Carol", travelling: false },
      ...MEMBERS,
    ]);
    expect(screen.getByTestId("activity-cost-total").textContent).toBe("× 2 people = $60.00");
    const going = screen.getByRole("group", { name: "Who is going" });
    expect(accessibleNames(going, "button")).toEqual(["Alice", "Bob", "Carol"]);
    const apart = screen.getByRole("group", { name: "Not travelling" });
    const carol = within(apart).getByRole("button", { name: "Carol" });

    fireEvent.click(carol);
    expect(carol.getAttribute("aria-pressed")).toBe("true");
    expect(accessibleNames(apart, "button")).toEqual(["Carol (not travelling)"]);
    expect(screen.getByTestId("activity-cost-total").textContent).toBe("× 1 person = $30.00");
    const booked = [...(screen.getByLabelText("Booked by") as HTMLSelectElement).options].map((o) => o.value);
    expect(booked).toEqual(["", "u-carol", "u-alice", "u-bob"]);
  });

  // A participant who has since left the trip is still on the stop and still
  // priced (`stopHeadcount` counts every distinct id). Listing members only
  // hid them: nothing to untick, and the line charged for somebody unseen.
  describe("someone who has left the trip", () => {
    const DEPARTED = "carol-left";

    it("shows them picked, by a fallback name, and unticking them drops them from the save and the headcount", () => {
      const onSave = mount(stop({ cost: { amountMinor: 30_00, currency: "USD" }, participants: ["u-bob", DEPARTED] }));
      expect(screen.getByTestId("activity-cost-total").textContent).toBe("× 2 people = $60.00");
      const chip = screen.getByRole("button", { name: "Former member (left the trip)" });
      expect(chip.getAttribute("aria-pressed")).toBe("true");
      expect(screen.queryByText(DEPARTED)).toBeNull();

      fireEvent.click(chip);
      expect(screen.getByTestId("activity-cost-total").textContent).toBe("× 1 person = $30.00");
      // Removed for good: nothing offers them back.
      expect(screen.queryByRole("button", { name: /former member/i })).toBeNull();
      save();
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ participants: ["u-bob"] }));
    });

    it("numbers them when more than one has left", () => {
      mount(stop({ participants: [DEPARTED, "dave-left"] }));
      expect(screen.getByRole("button", { name: "Former member 1 (left the trip)" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Former member 2 (left the trip)" })).toBeTruthy();
    });

    it("shows who booked it as a former member, and lets it be replaced", () => {
      const onSave = mount(stop({ bookedBy: DEPARTED }));
      const select = screen.getByLabelText("Booked by") as HTMLSelectElement;
      expect(select.value).toBe(DEPARTED);
      expect(select.selectedOptions[0]?.textContent).toBe("Former member (left the trip)");

      fireEvent.change(select, { target: { value: "u-alice" } });
      expect(within(select).queryByText(/former member/i)).toBeNull();
      save();
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ bookedBy: "u-alice" }));
    });

    it("lets who booked it go back to nobody", () => {
      const onSave = mount(stop({ bookedBy: DEPARTED }));
      const select = screen.getByLabelText("Booked by") as HTMLSelectElement;
      expect(select.value).toBe(DEPARTED);
      fireEvent.change(select, { target: { value: "" } });
      save();
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ bookedBy: null }));
    });
  });

  // A solo trip has nobody to attribute to, so the controls would be an empty
  // box that reads as broken.
  it("says why there is nothing to pick on a trip with no other members", () => {
    mount(stop(), []);
    expect(screen.getByText(/invite someone to the trip/i)).toBeTruthy();
    expect(screen.queryByLabelText("Booked by")).toBeNull();
  });
});

// M34 — the add-stop sheet's nearby stops. Seven, ranked as the route would
// return them, so "the first 4" and "the first 6" are each a real cut.
const nearbyStop = (title: string, place: string, overrides: Partial<NearbyStop> = {}): NearbyStop =>
  NearbyStop.parse({
    title,
    location: locationFactory.build({ name: `${place}, Kyoto, Japan`, city: "Kyoto", countryCode: "JP" }),
    kind: "planned",
    tags: [],
    lengthMinutes: 60,
    savedDayId: "33333333-3333-4333-8333-333333333333",
    savedDayName: "Kyoto in a day",
    playbookCount: 1,
    distanceKm: null,
    ...overrides,
  });

const NEARBY: NearbyStop[] = [
  nearbyStop("Kiyomizu-dera", "Kiyomizu-dera", { playbookCount: 3, distanceKm: 2.4, lengthMinutes: 90 }),
  nearbyStop("Fushimi Inari", "Fushimi Inari Taisha"),
  nearbyStop("Nishiki Market", "Nishiki Market"),
  nearbyStop("Philosopher's Path", "Tetsugaku-no-michi"),
  nearbyStop("Ryōan-ji", "Ryōan-ji"),
  nearbyStop("Lunch near the river", "Pontochō"),
  nearbyStop("Gion at dusk", "Gion"),
];

const nearbyList = () => screen.queryByRole("list", { name: "Nearby stops from the library" });
// The rows, in order, by their first line: each title must be a row's own
// whole line of text, which the detail line under it never is.
function expectNearby(titles: string[]) {
  const rows = within(screen.getByRole("list", { name: "Nearby stops from the library" })).getAllByRole("button");
  expect(rows).toHaveLength(titles.length);
  titles.forEach((title, i) => expect(within(rows[i]!).getByText(title)).toBeTruthy());
}

function renderWithNearby(initial: ActivityView | null, mode: "create" | "edit" = "create", nearbyStops = NEARBY) {
  const onSave = vi.fn();
  render(
    <ActivityEditor initial={initial} mode={mode} days={[]} nearbyStops={nearbyStops} onSave={onSave} onCancel={vi.fn()} />,
  );
  return onSave;
}

describe("ActivityEditor nearby stops (M34)", () => {
  it("renders nothing at all when there are none", () => {
    renderWithNearby(null, "create", []);
    expect(nearbyList()).toBeNull();
    // Not even an empty frame: the list and the Preview it replaced are both gone.
    expect(screen.queryByRole("group", { name: /preview/i })).toBeNull();
  });

  it("lists the closest four before anything is typed, each saying where it is from", () => {
    renderWithNearby(null);
    expectNearby(["Kiyomizu-dera", "Fushimi Inari", "Nishiki Market", "Philosopher's Path"]);
    const first = within(nearbyList()!).getAllByRole("button")[0]!;
    expect(first.textContent).toContain("Kiyomizu-dera, Kyoto, Japan · 1 h 30 m · from “Kyoto in a day” · in 3 playbooks · 2.4 km");
  });

  it("narrows by name or by place as you type, ignoring case and accents", () => {
    renderWithNearby(null);
    const field = screen.getByLabelText("What or where");

    fireEvent.change(field, { target: { value: "RYOAN" } });
    expectNearby(["Ryōan-ji"]);

    // "Tetsugaku" is only in the place, never the title.
    fireEvent.change(field, { target: { value: "tetsugaku" } });
    expectNearby(["Philosopher's Path"]);

    // "pontocho" matches "Pontochō" only once the macron is folded away.
    fireEvent.change(field, { target: { value: "pontocho" } });
    expectNearby(["Lunch near the river"]);

    fireEvent.change(field, { target: { value: "nothing like this" } });
    expect(nearbyList()).toBeNull();
  });

  it("shows six matches while typing, not four", () => {
    // Every stop's place carries "Kyoto", so all seven match and the cut is the cap.
    renderWithNearby(null);
    fireEvent.change(screen.getByLabelText("What or where"), { target: { value: "kyoto" } });
    expect(within(nearbyList()!).getAllByRole("button")).toHaveLength(6);
  });

  it("a pick fills name, place, kind, tags and length, leaves start and cost alone, and saves them", () => {
    const cost = { amountMinor: 12_00, currency: "USD" };
    const initial = existingStop({ activityId: "", title: "", kind: "pending", timeWindow: { start: "10:00", end: "11:00" }, cost });
    const picked = nearbyStop("Nishiki Market", "Nishiki Market", { tags: ["meal"], lengthMinutes: 90, kind: "planned" });
    const onSave = renderWithNearby(initial, "create", [picked]);

    fireEvent.click(within(nearbyList()!).getByRole("button"));

    expect((screen.getByLabelText("What or where") as HTMLInputElement).value).toBe("Nishiki Market");
    expect(checkedKind()).toBe("Planned");
    expect(screen.getByRole("button", { name: "Meal" }).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByLabelText("How long") as HTMLSelectElement).selectedOptions[0]?.textContent).toBe("1.5 hours");
    expect((screen.getByLabelText("Start") as HTMLInputElement).value).toBe("10:00");
    // Picked, so out of the way until the title is edited again.
    expect(nearbyList()).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Add stop" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Nishiki Market",
        location: picked.location,
        kind: "planned",
        tags: ["meal"],
        timeWindow: { start: "10:00", end: "11:30" },
        cost,
      }),
    );
  });

  it("comes back once the picked title is edited", () => {
    renderWithNearby(null);
    fireEvent.click(within(nearbyList()!).getAllByRole("button")[0]!);
    expect(nearbyList()).toBeNull();
    fireEvent.change(screen.getByLabelText("What or where"), { target: { value: "Kiyomizu" } });
    expectNearby(["Kiyomizu-dera"]);
  });

  // D11: a 100-minute temple visit rounded to "1.5 hours" would save a
  // different stop from the one picked, so it gets M29's extra option.
  it("keeps a picked length that is none of the five, as its own option, and saves it", () => {
    const initial = existingStop({ activityId: "", title: "", kind: "pending", timeWindow: { start: "09:00", end: "10:00" } });
    const onSave = renderWithNearby(initial, "create", [nearbyStop("Ginkaku-ji", "Ginkaku-ji", { lengthMinutes: 100 })]);

    fireEvent.click(within(nearbyList()!).getByRole("button"));
    expect((screen.getByLabelText("How long") as HTMLSelectElement).selectedOptions[0]?.textContent).toBe("1 h 40 m");

    fireEvent.click(screen.getByRole("button", { name: "Add stop" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ timeWindow: { start: "09:00", end: "10:40" } }));
  });

  // M29's regression guard: the extra option now lives in state, and a length
  // drawn on the river must still arrive as one.
  it("still offers a drawn length that is none of the five, chosen", () => {
    const initial = existingStop({ activityId: "", title: "", kind: "pending", timeWindow: { start: "11:00", end: "13:15" } });
    const onSave = renderWithNearby(initial, "create", []);

    expect((screen.getByLabelText("How long") as HTMLSelectElement).selectedOptions[0]?.textContent).toBe("2 h 15 m");
    fireEvent.change(screen.getByLabelText("What or where"), { target: { value: "Gelato" } });
    fireEvent.click(screen.getByRole("button", { name: "Add stop" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ timeWindow: { start: "11:00", end: "13:15" } }));
  });

  it("lists nothing while editing a stop (D12)", () => {
    renderWithNearby(existingStop({ title: "" }), "edit");
    expect(nearbyList()).toBeNull();
  });
});

// CodeRabbit on PR 392: another editor moves the stop while this one is open.
// The Day field follows the stop until this reader picks a day themselves, so
// a save of some other field does not drag the stop back where it was.
describe("ActivityEditor — the Day field while the stop moves elsewhere", () => {
  const days = [
    { dayId: "day-1", label: "Day 1", existing: [] },
    { dayId: "day-2", label: "Day 2", existing: [] },
  ];
  const props = { initial: existingStop(), mode: "edit" as const, days, onSave: vi.fn(), onCancel: vi.fn() };

  it("follows the stop's day until a day is picked here", async () => {
    const { rerender } = render(<ActivityEditor {...props} defaultDayId="day-1" />);
    rerender(<ActivityEditor {...props} defaultDayId="day-2" />);
    expect((screen.getByLabelText("Day") as HTMLSelectElement).value).toBe("day-2");

    await userEvent.selectOptions(screen.getByLabelText("Day"), "day-1");
    rerender(<ActivityEditor {...props} defaultDayId={undefined} />);
    expect((screen.getByLabelText("Day") as HTMLSelectElement).value).toBe("day-1");
  });
});
