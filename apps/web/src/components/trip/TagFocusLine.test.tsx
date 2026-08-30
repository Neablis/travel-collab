import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { FocusProvider, useFocus } from "./context/FocusProvider";
import { TagFocusLine } from "./TagFocusLine";

/** Drives the real provider, so this exercises the wiring and not a mock. */
function Harness({ tag }: { tag: "meal" | "lodging" | null }) {
  const { focusedTag, toggleFocusedTag } = useFocus();
  return (
    <div>
      <button onClick={() => tag && toggleFocusedTag(tag)}>set</button>
      <output data-testid="state">{String(focusedTag)}</output>
      <TagFocusLine />
    </div>
  );
}

function renderLine(tag: "meal" | "lodging" | null) {
  return render(
    <FocusProvider>
      <Harness tag={tag} />
    </FocusProvider>,
  );
}

describe("TagFocusLine", () => {
  // The difference between this and the header filter row it replaced
  // (KI-47): the filter row was permanent chrome asking a question nobody had
  // asked. This appears only once you have asked it.
  it("renders nothing while no tag is focused", () => {
    renderLine(null);
    expect(screen.queryByTestId("tag-focus-line")).toBeNull();
  });

  it("names the focused tag once one is set", async () => {
    renderLine("meal");
    await userEvent.click(screen.getByRole("button", { name: "set" }));
    const line = screen.getByTestId("tag-focus-line");
    expect(within(line).getByText("Meal")).toBeTruthy();
  });

  it("clears the focus, and takes itself away with it", async () => {
    renderLine("lodging");
    await userEvent.click(screen.getByRole("button", { name: "set" }));
    expect(screen.getByTestId("state").textContent).toBe("lodging");

    await userEvent.click(screen.getByRole("button", { name: "Stop focusing on lodging" }));
    expect(screen.getByTestId("state").textContent).toBe("null");
    expect(screen.queryByTestId("tag-focus-line")).toBeNull();
  });

  // "No filter row, no 'Show everything' control, and no multi-select
  // anywhere" — M18b's sixth exit-gate box, asserted where the only piece of
  // focus chrome on the page lives.
  it("offers no way to pick a tag and no 'Show everything'", async () => {
    renderLine("meal");
    await userEvent.click(screen.getByRole("button", { name: "set" }));
    const line = screen.getByTestId("tag-focus-line");
    // Exactly one control: Clear. No tag picker, no per-tag toggles.
    expect(within(line).getAllByRole("button")).toHaveLength(1);
    expect(screen.queryByText(/show everything/i)).toBeNull();
    // The other three tags are not offered here — the only way IN is a stop's
    // own chip.
    for (const label of ["Lodging", "Ticketed", "Outdoors"]) {
      expect(within(line).queryByText(label)).toBeNull();
    }
  });
});
