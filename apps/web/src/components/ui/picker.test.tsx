import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Picker, type PickerAnswer, type PickerOther } from "./picker";

// The picker is the only way New trip (M56 part 2) and the assistant's
// `ask_user` (part 5) take an answer, and neither has a text box behind it to
// fall back on. So what it reports is pinned here: the answer a press makes,
// that "none" is an answer and not the absence of one, the keyboard, and that
// a number never leaves its bounds.
//
// Focus is proven by where the NEXT key lands, never by reading
// `document.activeElement` (the test-quality wall bans it), as in
// `roving-radio.test.tsx`.
const user = userEvent.setup({ delay: null });

const OPTIONS = [
  { id: "slow", label: "Slow", detail: "Two things a day" },
  { id: "steady", label: "Steady" },
  { id: "packed", label: "Packed" },
];

function Harness({
  onChange,
  multi,
  allowNone,
  other,
  options = OPTIONS,
}: {
  onChange: (next: PickerAnswer | null) => void;
  multi?: boolean;
  allowNone?: boolean;
  other?: PickerOther;
  options?: typeof OPTIONS;
}) {
  const [value, setValue] = useState<PickerAnswer | null>(null);
  return (
    <>
      <button type="button">before</button>
      <Picker
        question="What pace?"
        options={options}
        multi={multi}
        allowNone={allowNone}
        other={other}
        value={value}
        onChange={(next) => {
          setValue(next);
          onChange(next);
        }}
      />
      <button type="button" onClick={() => onChange(null)}>
        after
      </button>
    </>
  );
}

describe("Picker", () => {
  it("answers one option at a time when single", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    screen.getByRole("radiogroup", { name: "What pace?" });
    await user.click(screen.getByRole("radio", { name: "Slow" }));
    expect(onChange).toHaveBeenLastCalledWith({ optionIds: ["slow"], other: null });
    await user.click(screen.getByRole("radio", { name: "Packed" }));
    expect(onChange).toHaveBeenLastCalledWith({ optionIds: ["packed"], other: null });
    expect(screen.getByRole("radio", { name: "Slow" }).getAttribute("aria-checked")).toBe("false");
    // The detail is said as a description, not folded into the name.
    screen.getByRole("radio", { name: "Slow", description: "Two things a day" });
  });

  it("collects several when multi, and is unanswered again once all are dropped", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} multi />);
    await user.click(screen.getByRole("checkbox", { name: "Packed" }));
    await user.click(screen.getByRole("checkbox", { name: "Slow" }));
    // In the options' order, not the order they were pressed.
    expect(onChange).toHaveBeenLastCalledWith({ optionIds: ["slow", "packed"], other: null });
    await user.click(screen.getByRole("checkbox", { name: "Slow" }));
    await user.click(screen.getByRole("checkbox", { name: "Packed" }));
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(screen.queryByRole("checkbox", { name: "None of these" })).toBeNull();
  });

  it("makes none an answer of its own with allowNone, clearing what was picked", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} multi allowNone />);
    await user.click(screen.getByRole("checkbox", { name: "Steady" }));
    await user.click(screen.getByRole("checkbox", { name: "None of these" }));
    expect(onChange).toHaveBeenLastCalledWith({ optionIds: [], other: null });
    expect(screen.getByRole("checkbox", { name: "Steady" }).getAttribute("aria-checked")).toBe("false");
    expect(screen.getByRole("checkbox", { name: "None of these" }).getAttribute("aria-checked")).toBe("true");
    // Picking again leaves "none".
    await user.click(screen.getByRole("checkbox", { name: "Packed" }));
    expect(onChange).toHaveBeenLastCalledWith({ optionIds: ["packed"], other: null });
    expect(screen.getByRole("checkbox", { name: "None of these" }).getAttribute("aria-checked")).toBe("false");
  });

  it("is one tab stop whose arrows pick, wrapping, when single", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.tab();
    await user.tab();
    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith({ optionIds: ["steady"], other: null });
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(onChange).toHaveBeenLastCalledWith({ optionIds: ["packed"], other: null });
    // One more Tab leaves the group: Enter now presses "after", not an option.
    await user.tab();
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("moves without picking when multi, and Space picks", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} multi />);
    await user.tab();
    await user.tab();
    await user.keyboard("{ArrowRight}");
    expect(onChange).not.toHaveBeenCalled();
    await user.keyboard(" ");
    expect(onChange).toHaveBeenLastCalledWith({ optionIds: ["steady"], other: null });
    await user.keyboard("{ArrowRight}{Enter}");
    expect(onChange).toHaveBeenLastCalledWith({ optionIds: ["steady", "packed"], other: null });
    await user.tab();
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("keeps a number other inside its bounds", async () => {
    const onChange = vi.fn();
    render(
      <Harness
        onChange={onChange}
        other={{ kind: "number", label: "Another length", min: 1, max: 3, initial: 2, unit: { one: "day", many: "days" } }}
      />,
    );
    await user.click(screen.getByRole("radio", { name: "Another length" }));
    expect(onChange).toHaveBeenLastCalledWith({ optionIds: [], other: { kind: "number", value: 2 } });
    const more = screen.getByRole<HTMLButtonElement>("button", { name: "More days" });
    const fewer = screen.getByRole<HTMLButtonElement>("button", { name: "Fewer days" });
    await user.click(more);
    expect(onChange).toHaveBeenLastCalledWith({ optionIds: [], other: { kind: "number", value: 3 } });
    expect(more.disabled).toBe(true);
    await user.click(fewer);
    await user.click(fewer);
    expect(onChange).toHaveBeenLastCalledWith({ optionIds: [], other: { kind: "number", value: 1 } });
    expect(fewer.disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toBe("1 day");
  });

  it("answers with tags from the tiles when the tags other is all there is", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} options={[]} multi allowNone other={{ kind: "tags", label: "What it is about" }} />);
    await user.click(screen.getByRole("checkbox", { name: "Beach" }));
    await user.click(screen.getByRole("checkbox", { name: "Food" }));
    // Contract order, so the same picks never make two different arrays.
    expect(onChange).toHaveBeenLastCalledWith({ optionIds: [], other: { kind: "tags", value: ["meal", "beach"] } });
  });
});
