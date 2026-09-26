import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Circle, Square, Triangle } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { IconRadioGroup } from "./icon-radio-group";
import { SegmentedControl } from "./segmented-control";

// Both radio rows are one tab stop whose arrows move the choice and the focus
// together, wrapping at the ends (the ARIA radio group pattern). The Kind
// control lost this when it became a SegmentedControl (PR 242 review), so the
// behaviour is pinned once per component, through the same two questions.
//
// Focus is proven by where the NEXT key lands, never by reading
// `document.activeElement` (the test-quality wall bans it).
const user = userEvent.setup({ delay: null });

type Shape = "circle" | "square" | "triangle";
const LABELS: Record<Shape, string> = { circle: "Circle", square: "Square", triangle: "Triangle" };

function Segmented({ initial, onChange }: { initial: Shape; onChange: (v: Shape) => void }) {
  const [value, setValue] = useState<Shape>(initial);
  return (
    <SegmentedControl<Shape>
      aria-label="Shape"
      value={value}
      onValueChange={(v) => {
        setValue(v);
        onChange(v);
      }}
      options={(["circle", "square", "triangle"] as const).map((v) => ({ value: v, label: LABELS[v] }))}
    />
  );
}

function Icons({ initial, onChange }: { initial: Shape; onChange: (v: Shape) => void }) {
  const [value, setValue] = useState<Shape | null>(initial);
  return (
    <IconRadioGroup<Shape>
      aria-label="Shape"
      value={value}
      onValueChange={(v) => {
        setValue(v);
        if (v !== null) onChange(v);
      }}
      options={[
        { value: "circle", label: "Circle", Icon: Circle },
        { value: "square", label: "Square", Icon: Square },
        { value: "triangle", label: "Triangle", Icon: Triangle },
      ]}
    />
  );
}

const checked = () => screen.getAllByRole("radio").filter((r) => r.getAttribute("aria-checked") === "true").map((r) => r.getAttribute("aria-label") ?? r.textContent);

describe.each([
  ["SegmentedControl", Segmented],
  ["IconRadioGroup", Icons],
] as const)("%s keyboard", (_name, Group) => {
  it("is one tab stop, entered on the chosen option", async () => {
    const onChange = vi.fn();
    const after = vi.fn();
    render(
      <>
        <button type="button">before</button>
        <Group initial="square" onChange={onChange} />
        <button type="button" onClick={after}>
          after
        </button>
      </>,
    );
    await user.tab();
    await user.tab();
    // Landed on Square, not Circle: the arrow moves on from the chosen one.
    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith("triangle");
    // One more Tab leaves the group rather than visiting another option.
    await user.tab();
    await user.keyboard("{Enter}");
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("moves the choice and focus with the arrow keys, wrapping at both ends", async () => {
    const onChange = vi.fn();
    render(<Group initial="circle" onChange={onChange} />);
    await user.tab();
    await user.keyboard("{ArrowLeft}");
    expect(checked()).toEqual(["Triangle"]);
    await user.keyboard("{ArrowRight}");
    expect(checked()).toEqual(["Circle"]);
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(checked()).toEqual(["Triangle"]);
    await user.keyboard("{ArrowUp}");
    expect(checked()).toEqual(["Square"]);
  });
});
