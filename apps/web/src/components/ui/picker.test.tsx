import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { cn } from "@/lib/cn";
import { buttonVariants } from "./button";
import { ChoiceRow, dateAnswer, Picker, type PickerAnswer, type PickerOption, type PickerOther } from "./picker";

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
  initial = null,
}: {
  onChange: (next: PickerAnswer | null) => void;
  multi?: boolean;
  allowNone?: boolean;
  other?: PickerOther;
  options?: readonly PickerOption[];
  initial?: PickerAnswer | null;
}) {
  const [value, setValue] = useState<PickerAnswer | null>(initial);
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
    await user.keyboard("{ArrowLeft}");
    expect(onChange).toHaveBeenLastCalledWith({ optionIds: ["packed"], other: null });
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith({ optionIds: ["steady"], other: null });
    // Tab from a middle option leaves the group: Enter now presses "after".
    await user.tab();
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenLastCalledWith(null);
    // Coming back lands on the picked option, not the first or the last.
    await user.tab({ shift: true });
    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith({ optionIds: ["packed"], other: null });
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
    // Tab from the middle leaves; coming back is where the cursor was.
    await user.tab();
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenLastCalledWith(null);
    await user.tab({ shift: true });
    await user.keyboard("{ArrowRight}{Enter}");
    expect(onChange).toHaveBeenLastCalledWith({ optionIds: ["steady", "packed"], other: null });
  });

  const LENGTH: PickerOther = { kind: "number", label: "Another length", min: 1, max: 3, initial: 2, unit: { one: "day", many: "days" } };

  it("keeps a number other inside its bounds, and the keyboard on the stepper at them", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} other={LENGTH} />);
    await user.click(screen.getByRole("radio", { name: "Another length" }));
    expect(onChange).toHaveBeenLastCalledWith({ optionIds: [], other: { kind: "number", value: 2 } });
    const more = screen.getByRole<HTMLButtonElement>("button", { name: "More days" });
    await user.click(more);
    expect(onChange).toHaveBeenLastCalledWith({ optionIds: [], other: { kind: "number", value: 3 } });
    // Held, not disabled: jsdom keeps focus on a disabled button, so the
    // keyboard steps below cannot tell the two apart. A browser does not.
    expect(more.disabled).toBe(false);
    expect(more.getAttribute("aria-disabled")).toBe("true");
    // At the bound a press does nothing, and focus is still on More: the
    // next Shift+Tab reaches Fewer.
    onChange.mockClear();
    await user.keyboard("{Enter}");
    expect(onChange).not.toHaveBeenCalled();
    await user.tab({ shift: true });
    await user.keyboard("{Enter}{Enter}");
    expect(onChange).toHaveBeenLastCalledWith({ optionIds: [], other: { kind: "number", value: 1 } });
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("status").textContent).toBe("1 day");
  });

  it("shows and steps a prefilled number from inside its bounds", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} other={LENGTH} initial={{ optionIds: [], other: { kind: "number", value: 14 } }} />);
    expect(screen.getByRole("status").textContent).toBe("3 days");
    await user.click(screen.getByRole("button", { name: "Fewer days" }));
    expect(onChange).toHaveBeenLastCalledWith({ optionIds: [], other: { kind: "number", value: 2 } });
  });

  it("answers a date other only with a whole day on or after its min", async () => {
    const onChange = vi.fn();
    render(
      <Harness
        onChange={onChange}
        options={[{ id: "later", label: "Not yet" }]}
        other={{ kind: "date", label: "Pick a day", min: "2026-11-05" }}
      />,
    );
    await user.click(screen.getByRole("radio", { name: "Pick a day" }));
    expect(onChange).toHaveBeenLastCalledWith({ optionIds: [], other: { kind: "date", value: null } });
    const day = screen.getByLabelText("Pick a day", { selector: "input" });
    fireEvent.change(day, { target: { value: "2026-11-06" } });
    expect(onChange).toHaveBeenLastCalledWith({ optionIds: [], other: { kind: "date", value: "2026-11-06" } });
    // `min` is only a hint to the native picker: a typed earlier day is no answer.
    fireEvent.change(day, { target: { value: "2026-11-02" } });
    expect(onChange).toHaveBeenLastCalledWith({ optionIds: [], other: { kind: "date", value: null } });
  });

  it("keeps a typed day in the date input while it is not an answer yet", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} options={[]} other={{ kind: "date", label: "Pick a day", min: "2026-11-05" }} />);
    const day = screen.getByLabelText<HTMLInputElement>("Pick a day", { selector: "input" });
    // Chrome sends each digit of a typed year: 0002-11-05 is on the way to 2026-11-05.
    fireEvent.change(day, { target: { value: "0002-11-05" } });
    expect(onChange).toHaveBeenLastCalledWith({ optionIds: [], other: { kind: "date", value: null } });
    expect(day.value).toBe("0002-11-05");
    fireEvent.change(day, { target: { value: "2026-11-05" } });
    expect(onChange).toHaveBeenLastCalledWith({ optionIds: [], other: { kind: "date", value: "2026-11-05" } });
  });

  // jsdom empties a non-ISO value before `change` fires, so the shape half of
  // the guard is only reachable here.
  it("answers a date only from a whole YYYY-MM-DD", () => {
    expect(dateAnswer("2026-11-0", undefined)).toBeNull();
    expect(dateAnswer("2026-11-05", undefined)).toBe("2026-11-05");
  });

  it("answers a place other with the place its slot commits", async () => {
    const onChange = vi.fn();
    render(
      <Harness
        onChange={onChange}
        other={{
          kind: "place",
          label: "Somewhere else",
          slot: ({ commit, labelledBy }) => (
            <button type="button" aria-labelledby={labelledBy} onClick={() => commit({ id: "p-seville", label: "Seville" })}>
              search
            </button>
          ),
        }}
      />,
    );
    await user.click(screen.getByRole("radio", { name: "Somewhere else" }));
    // Open with nothing committed is told apart from a picked place by its null.
    expect(onChange).toHaveBeenLastCalledWith({ optionIds: [], other: { kind: "place", value: null } });
    // The slot is named by the question drawn above it.
    await user.click(screen.getByRole("button", { name: "What pace?" }));
    expect(onChange).toHaveBeenLastCalledWith({
      optionIds: [],
      other: { kind: "place", value: { id: "p-seville", label: "Seville" } },
    });
  });

  it("answers with tags from the tiles when the tags other is all there is", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} options={[]} multi allowNone other={{ kind: "tags", label: "What it is about" }} />);
    await user.click(screen.getByRole("checkbox", { name: "Beach" }));
    await user.click(screen.getByRole("checkbox", { name: "Food" }));
    // Contract order, so the same picks never make two different arrays.
    expect(onChange).toHaveBeenLastCalledWith({ optionIds: [], other: { kind: "tags", value: ["meal", "beach"] } });
    // The described tags only: lodging and the modifier are not what a trip is about.
    expect(screen.queryByRole("checkbox", { name: "Lodging" })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "Ticketed" })).toBeNull();
    // One group named by the question, not a second holding only "None of these".
    expect(screen.getAllByRole("group", { name: "What pace?" })).toHaveLength(1);
  });

  // Mitchell on production, 2026-10-30: equal squares in a grid, not chips
  // each as wide as its own label.
  it("lays the tag tiles out as a grid of equal squares", () => {
    render(<Harness onChange={vi.fn()} options={[]} multi other={{ kind: "tags", label: "What it is about" }} />);
    expect([...screen.getByRole("group", { name: "What pace?" }).classList]).toEqual(expect.arrayContaining(["grid", "grid-cols-3"]));
    const tiles = screen.getAllByRole("checkbox");
    expect(tiles).toHaveLength(12);
    for (const tile of tiles) expect([...tile.classList]).toContain("aspect-square");
  });
});

// Mitchell, 2026-10-30: in the docked assistant (~360px) a place offered with
// its whole LocationIQ address as a name squeezed Choose narrower than its own
// word, which spilled out of its border. The name wraps in its column; the
// button keeps its size and is the app's standard secondary one.
describe("ChoiceRow", () => {
  it("never squeezes Choose below its word, and draws it as the standard secondary button", () => {
    render(
      <ul>
        <ChoiceRow
          name="Cochon, 930, Tchoupitoulas Street, Warehouse District, New Orleans, Orleans Parish, Louisiana, 70130, USA"
          detail="Warehouse District, New Orleans"
          onChoose={() => {}}
        />
      </ul>,
    );
    const choose = screen.getByRole("button", { name: /^Choose Cochon/ });
    const classes = choose.className.split(" ");
    expect(classes).toEqual(expect.arrayContaining(["shrink-0", "whitespace-nowrap"]));
    // 44px at every width, the panel being docked on a desktop too. Merged as
    // `Button` merges, since `touch` overrides the base's mouse release.
    expect(classes).toEqual(expect.arrayContaining(cn(buttonVariants({ variant: "secondary", size: "touch" })).split(" ")));
  });
});
