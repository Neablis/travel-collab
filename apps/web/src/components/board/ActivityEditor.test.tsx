import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ActivityView, Anchor } from "@tc/contracts";
import { ActivityEditor } from "./ActivityEditor";

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
    ...overrides,
  };
}

function renderEditor(initial: ActivityView | null, mode: "create" | "edit", onSave = vi.fn()) {
  render(<ActivityEditor initial={initial} mode={mode} days={[]} onSave={onSave} onCancel={vi.fn()} />);
  return onSave;
}

describe("ActivityEditor kind picker", () => {
  it("offers all five kinds", () => {
    renderEditor(null, "create");
    // eslint-disable-next-line testing-library/no-node-access -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    const options = Array.from(screen.getByLabelText("Kind").querySelectorAll("option")).map((o) => o.value);
    expect(options).toEqual(["planned", "idea", "hold", "booked", "transit"]);
  });

  // Mitchell, 2026-08-29: a stop being CREATED defaults to "hold", not the
  // contract's "planned" zero value — more likely to need booking than not.
  // Editing keeps its own kind; see the next test.
  it("defaults to hold when adding, with no prefill", () => {
    renderEditor(null, "create");
    expect((screen.getByLabelText("Kind") as HTMLSelectElement).value).toBe("hold");
  });

  it("defaults to the stop's own kind when editing", () => {
    renderEditor(existingStop({ kind: "transit" }), "edit");
    expect((screen.getByLabelText("Kind") as HTMLSelectElement).value).toBe("transit");
  });

  // A stated kind always wins over the create-mode default — the default only
  // fills in for "nothing was stated", the same rule the assistant's write
  // tool applies (writeTools.ts's withDefaultKind).
  it("keeps an explicitly-supplied initial kind in create mode, rather than overriding to hold", () => {
    renderEditor(existingStop({ activityId: "", kind: "idea" }), "create");
    expect((screen.getByLabelText("Kind") as HTMLSelectElement).value).toBe("idea");
  });

  it("sends the chosen kind on save", () => {
    const onSave = renderEditor(null, "create");
    fireEvent.change(screen.getByLabelText("What or where"), { target: { value: "Gora Kadan" } });
    fireEvent.change(screen.getByLabelText("Kind"), { target: { value: "hold" } });
    fireEvent.click(screen.getByRole("button", { name: "Add stop" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ kind: "hold" }));
  });

  it("round-trips the stop's kind through an untouched edit", () => {
    const onSave = renderEditor(existingStop({ kind: "booked" }), "edit");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ kind: "booked" }));
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
  const MEMBERS = [
    { userId: "alice", role: "owner" as const },
    { userId: "bob", role: "editor" as const },
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

  it("offers one toggle per member and sends who is going", () => {
    const onSave = mount(stop());
    fireEvent.click(screen.getByRole("button", { name: "bob" }));
    save();
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ participants: ["bob"] }));
  });

  it("sends who booked it, separately from who is going", () => {
    const onSave = mount(stop());
    fireEvent.click(screen.getByRole("button", { name: "bob" }));
    fireEvent.change(screen.getByLabelText("Booked by"), { target: { value: "alice" } });
    save();
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ bookedBy: "alice", participants: ["bob"] }),
    );
  });

  it("seeds both from the stop being edited", () => {
    mount(stop({ bookedBy: "alice", participants: ["bob"] }));
    expect(screen.getByRole("button", { name: "bob" }).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByLabelText("Booked by") as HTMLSelectElement).value).toBe("alice");
  });

  // The drop this milestone's preflight exists to prevent: an edit that never
  // touches attribution must not clear it.
  it("round-trips attribution through an unrelated edit", () => {
    const onSave = mount(stop({ bookedBy: "alice", participants: ["bob"] }));
    fireEvent.change(screen.getByLabelText("What or where"), { target: { value: "Colosseum tour" } });
    save();
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ bookedBy: "alice", participants: ["bob"] }),
    );
  });

  it("clears who booked it back to nobody", () => {
    const onSave = mount(stop({ bookedBy: "alice" }));
    fireEvent.change(screen.getByLabelText("Booked by"), { target: { value: "" } });
    save();
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ bookedBy: null }));
  });

  // A solo trip has nobody to attribute to, so the controls would be an empty
  // box that reads as broken.
  it("says why there is nothing to pick on a trip with no other members", () => {
    mount(stop(), []);
    expect(screen.getByText(/invite someone to the trip/i)).toBeTruthy();
    expect(screen.queryByLabelText("Booked by")).toBeNull();
  });
});
