import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { AddSavedDayButton } from "./AddSavedDayButton";

afterEach(cleanup);

// AddSavedDayButton wraps itself in <Preview id="add-saved-day"> internally,
// so every test below renders `<AddSavedDayButton>` directly — same
// contract as ShareButton.test.tsx / KeepDayDialog.test.tsx.
describe("AddSavedDayButton", () => {
  it("renders an Add a saved day button inside the add-saved-day Preview region", () => {
    render(<AddSavedDayButton />);
    const region = document.querySelector('[data-preview-id="add-saved-day"]');
    expect(region).not.toBeNull();
    expect(region?.textContent).toContain("Add a saved day");
  });

  it("shows the M11 milestone via tooltip (compact icon badge, not a text chip)", () => {
    render(<AddSavedDayButton />);
    const region = document.querySelector('[data-preview-id="add-saved-day"]');
    expect(region?.getAttribute("title")).toMatch(/M11/);
  });

  it("is genuinely inert: pointer-events shielded, never fires", async () => {
    render(<AddSavedDayButton />);
    const button = screen.getByRole("button", { name: "Add a saved day" });
    await expect(userEvent.click(button)).rejects.toThrow();
  });
});
