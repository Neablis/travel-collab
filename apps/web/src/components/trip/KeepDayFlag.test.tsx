import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { KeepDayFlag } from "./KeepDayFlag";

afterEach(cleanup);

describe("KeepDayFlag", () => {
  it("renders an accessible icon-only button labeled with the 1-based day number", () => {
    render(<KeepDayFlag dayIndex={2} accent="brand" />);
    expect(screen.getByRole("button", { name: "Keep day 3" })).not.toBeNull();
  });

  it("does not render the Keep this day dialog before the flag is clicked", () => {
    render(<KeepDayFlag dayIndex={0} accent="brand" />);
    expect(screen.queryByText("Keep this day")).toBeNull();
  });

  it("opens the Keep this day dialog when the flag is clicked (rendered unwrapped, no outer Preview shield)", async () => {
    render(<KeepDayFlag dayIndex={0} accent="brand" />);
    await userEvent.click(screen.getByRole("button", { name: "Keep day 1" }));
    expect(screen.getByText("Keep this day")).not.toBeNull();
    expect(document.querySelector('[data-preview-id="keep-day-dialog"]')).not.toBeNull();
  });
});
