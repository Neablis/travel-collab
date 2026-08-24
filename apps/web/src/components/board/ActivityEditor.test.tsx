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
