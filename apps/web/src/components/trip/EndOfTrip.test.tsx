import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PREVIEW_PLAYBOOK_CARDS } from "@/components/playbooks/preview-fixtures";
import { EndOfTrip } from "./EndOfTrip";

afterEach(cleanup);

describe("EndOfTrip", () => {
  // The phase file's own Step 1 test, verbatim in intent: the title, the body
  // (em dash included — this string is copy-table verbatim, never paraphrased)
  // and a real "Add a day" that actually calls back.
  it("offers a real Add a day and an inert Add a saved day", async () => {
    const onAddDay = vi.fn();
    render(<EndOfTrip onAddDay={onAddDay} />);

    expect(screen.getByText("End of the trip")).toBeTruthy();
    expect(
      screen.getByText(
        "Add another day, or drop in a day you have already planned — the times reflow to fit.",
      ),
    ).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Add a day" }));
    expect(onAddDay).toHaveBeenCalledTimes(1);
  });

  it("keeps Add a saved day inside the insert-playbook Preview region", () => {
    render(<EndOfTrip onAddDay={vi.fn()} />);
    const region = document.querySelector('[data-preview-id="insert-playbook"]');
    expect(region).not.toBeNull();
    expect(within(region as HTMLElement).getByRole("button", { name: "Add a saved day" })).toBeTruthy();
  });

  // The Preview shield swallows pointer events on everything below it, so the
  // saved-day half of the block cannot fire even though it renders as a real
  // button — the same guarantee AddSavedDayButton.test.tsx asserts for the
  // header's copy of this control.
  it("cannot actually be clicked through the Preview shield", async () => {
    const onAddDay = vi.fn();
    render(<EndOfTrip onAddDay={onAddDay} />);
    await expect(
      userEvent.click(screen.getByRole("button", { name: "Add a saved day" })),
    ).rejects.toThrow();
    expect(onAddDay).not.toHaveBeenCalled();
  });

  it("shows at most three Playbook shortcuts, from the existing preview fixture", () => {
    render(<EndOfTrip onAddDay={vi.fn()} />);
    const region = document.querySelector('[data-preview-id="insert-playbook"]') as HTMLElement;
    const shortcuts = region.querySelectorAll('[data-testid^="playbook-shortcut-"]');
    expect(shortcuts).toHaveLength(3);
    // Real fixture data, not invented card content.
    const first = PREVIEW_PLAYBOOK_CARDS[0]!;
    expect(within(region).getByText(first.name)).toBeTruthy();
    expect(within(region).getByText(first.span)).toBeTruthy();
    // The fourth fixture entry is deliberately not rendered.
    expect(within(region).queryByText(PREVIEW_PLAYBOOK_CARDS[3]!.name)).toBeNull();
  });
});
