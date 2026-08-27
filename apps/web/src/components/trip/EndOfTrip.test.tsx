import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PREVIEW_PLAYBOOK_CARDS } from "@/components/playbooks/preview-fixtures";
// M11 link 6 made "Add a saved day" real, and it reads TripProvider. These
// tests render the block bare; the button's own behaviour is
// AddSavedDayButton.test.tsx's subject.
vi.mock("@/components/trip/AddSavedDayButton", () => ({
  AddSavedDayButton: () => <button type="button">Add a saved day</button>,
}));

import { EndOfTrip } from "./EndOfTrip";

afterEach(cleanup);

describe("EndOfTrip", () => {
  // The phase file's own Step 1 test, verbatim in intent: the title, the body
  // (em dash included — this string is copy-table verbatim, never paraphrased)
  // and a real "Add a day" that actually calls back.
  it("offers a real Add a day, and a real Add a saved day beside it", async () => {
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

  // M11 link 6: "Add a saved day" is real, so it must sit OUTSIDE the
  // <Preview id="insert-playbook"> that still shells the Playbook shortcuts —
  // the shield swallows every click below it, and a real control inside one
  // would be dead on arrival.
  it("mounts the real Add a saved day outside the insert-playbook shell", async () => {
    render(<EndOfTrip onAddDay={vi.fn()} />);
    const region = document.querySelector('[data-preview-id="insert-playbook"]') as HTMLElement;
    expect(region).not.toBeNull();
    const button = screen.getByRole("button", { name: "Add a saved day" });
    expect(region.contains(button)).toBe(false);
    // …and it is genuinely clickable, unlike everything inside that region.
    await expect(userEvent.click(button)).resolves.not.toThrow();
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
