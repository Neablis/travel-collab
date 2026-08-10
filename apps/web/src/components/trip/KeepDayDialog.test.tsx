import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KeepDayDialog } from "./KeepDayDialog";

afterEach(cleanup);

// KeepDayDialog wraps its own fields+footer in <Preview id="keep-day-dialog">
// internally (see the comment in KeepDayDialog.tsx on why: Dialog portals
// its content to document.body, so an externally-applied Preview would
// never actually contain the rendered markup). So every test below renders
// `<KeepDayDialog>` directly — no outer `<Preview>` needed to get the
// "Preview · M11" chip, the `data-preview-id` region, or the pointer-events
// shield.
describe("KeepDayDialog", () => {
  it("renders name, what's-included and visibility fields inside the keep-day-dialog Preview region", () => {
    render(<KeepDayDialog open onOpenChange={vi.fn()} />);
    const region = document.querySelector('[data-preview-id="keep-day-dialog"]');
    expect(region).not.toBeNull();
    const scoped = within(region as HTMLElement);
    expect(scoped.getByLabelText(/^name$/i)).not.toBeNull();
    expect(scoped.getByLabelText(/what.?s included/i)).not.toBeNull();
    expect(scoped.getByLabelText(/visibility/i)).not.toBeNull();
  });

  it("shows the Preview · M11 chip on the dialog content", () => {
    render(<KeepDayDialog open onOpenChange={vi.fn()} />);
    expect(screen.getByText(/Preview/).textContent).toMatch(/M11/);
  });

  it("renders a Confirm control that is genuinely inert: pointer-events shielded, never fires, no toast", async () => {
    const onOpenChange = vi.fn();
    render(<KeepDayDialog open onOpenChange={onOpenChange} />);
    const confirmButton = screen.getByRole("button", { name: /confirm/i });
    await expect(userEvent.click(confirmButton)).rejects.toThrow();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toMatch(/kept in your playbooks/i);
    expect(document.body.textContent).not.toMatch(/link copied/i);
  });
});
