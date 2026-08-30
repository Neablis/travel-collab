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
