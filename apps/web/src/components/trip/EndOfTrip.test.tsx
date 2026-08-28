import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PREVIEW_PLAYBOOK_CARDS } from "@/components/playbooks/preview-fixtures";
// M11 link 6 made "Add a saved day" real, and it reads TripProvider. These
// tests render the block bare; the button's own behaviour is
// AddSavedDayButton.test.tsx's subject.
vi.mock("@/components/trip/AddSavedDayButton", () => ({
  AddSavedDayButton: () => <button type="button">Add a saved day</button>,
}));

// EndOfTrip reads `readOnly` from TripProvider itself (M11 link 3 follow-up,
// review §5) rather than taking it as a prop, so these bare renders need the
// hook stubbed — the same one-value mock AddSavedDayButton.test.tsx uses.
const useTripMock = vi.fn();
vi.mock("@/components/trip/context/TripProvider", () => ({
  useTrip: () => useTripMock(),
}));

import { EndOfTrip } from "./EndOfTrip";

afterEach(cleanup);
beforeEach(() => {
  useTripMock.mockReset().mockReturnValue({ readOnly: false });
});

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
    // No click assertion here: this file mocks AddSavedDayButton, so a
    // resolved `userEvent.click` would prove only that clicking a button with
    // no handler does not throw — true of any button anywhere (CodeRabbit,
    // PR #71). What the click was meant to show, that the shield does not
    // swallow it, is exactly what `region.contains` already establishes; the
    // real button's behaviour is covered in AddSavedDayButton.test.tsx.
  });

  // Review §5: the whole block is affordance — "Add a day", "Add a saved day"
  // and the shelled Playbook shortcuts — so a viewer gets none of it rather
  // than a heading offering a day they cannot add. The server refuses AddDay
  // from a viewer regardless; this is what stops them finding that out by
  // clicking. Asserted against the owner case in the tests above, so this is a
  // statement about the role and not about a block that never rendered.
  it("renders nothing at all for a viewer", () => {
    useTripMock.mockReturnValue({ readOnly: true });
    const onAddDay = vi.fn();
    render(<EndOfTrip onAddDay={onAddDay} />);

    expect(screen.queryByTestId("end-of-trip")).toBeNull();
    expect(screen.queryByRole("button", { name: "Add a day" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add a saved day" })).toBeNull();
    expect(document.querySelector('[data-preview-id="insert-playbook"]')).toBeNull();
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
