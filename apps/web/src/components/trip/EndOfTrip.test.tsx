import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
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
    expect(screen.getByRole("button", { name: "Add a saved day" })).toBeTruthy();
  });

  // M11b: the three fabricated Playbook shortcut cards and the
  // `<Preview id="insert-playbook">` around them are DELETED, not re-pointed.
  // This is the assertion that keeps them gone — the shell used to be the thing
  // this block was mostly made of, and re-adding it is the easy mistake.
  it("carries no Preview shell and no fabricated Playbook cards", () => {
    render(<EndOfTrip onAddDay={vi.fn()} />);
    // eslint-disable-next-line testing-library/no-node-access -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    expect(document.querySelector("[data-preview-id]")).toBeNull();
    // eslint-disable-next-line testing-library/no-node-access -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    expect(document.querySelector('[data-testid^="playbook-shortcut-"]')).toBeNull();
  });

  // What replaced them: a link to the real library, which is a page's job to
  // fetch rather than a footer's.
  it("points at the real library instead", () => {
    render(<EndOfTrip onAddDay={vi.fn()} />);
    expect(screen.getByRole("link", { name: "other people's days" }).getAttribute("href")).toBe(
      "/playbooks",
    );
  });
});
