import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InsertPlaybookDialog } from "./InsertPlaybookDialog";

afterEach(cleanup);

// InsertPlaybookDialog wraps its own fields+footer in
// <Preview id="insert-playbook"> internally (same Task 17 lesson
// KeepDayDialog.tsx documents: Dialog portals its content to document.body,
// so an externally-applied Preview would never actually contain the
// rendered markup). So every test below renders `<InsertPlaybookDialog>`
// directly — no outer `<Preview>` needed.
describe("InsertPlaybookDialog", () => {
  it("renders the trip/day/start-time fields inside the insert-playbook Preview region", () => {
    render(<InsertPlaybookDialog open onOpenChange={vi.fn()} />);
    const region = document.querySelector('[data-preview-id="insert-playbook"]');
    expect(region).not.toBeNull();
    expect(screen.getByLabelText(/which playbook/i)).not.toBeNull();
    expect(screen.getByLabelText(/which trip/i)).not.toBeNull();
    expect(screen.getByLabelText(/which day/i)).not.toBeNull();
    expect(screen.getByLabelText(/start it at/i)).not.toBeNull();
  });

  it("shows the Preview · M11 chip", () => {
    render(<InsertPlaybookDialog open onOpenChange={vi.fn()} />);
    expect(screen.getByText(/Preview/).textContent).toMatch(/M11/);
  });

  it("previews the selected Playbook's stops reflowed to the default 09:00 start", () => {
    render(<InsertPlaybookDialog open onOpenChange={vi.fn()} />);
    // Default selection is the first fixture Playbook (Higashiyama at dawn,
    // rawTimes 06:30/09:00/10:30) with the dialog's own default start time
    // (09:00) — a +2:30 shift, so 06:30 -> 09:00, 09:00 -> 11:30, 10:30 -> 13:00.
    expect(screen.getByText("After shifting")).not.toBeNull();
    expect(screen.getByText("11:30")).not.toBeNull();
    expect(screen.getByText("13:00")).not.toBeNull();
  });

  it("renders Cancel/Insert day controls that are genuinely inert: pointer-events shielded, never fire", async () => {
    const onOpenChange = vi.fn();
    render(<InsertPlaybookDialog open onOpenChange={onOpenChange} />);
    const insertButton = screen.getByRole("button", { name: /insert day/i });
    await expect(userEvent.click(insertButton)).rejects.toThrow();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
