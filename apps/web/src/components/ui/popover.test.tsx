import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Button } from "./button";
import { Popover } from "./popover";

afterEach(cleanup);

// axe `aria-dialog-name` on the desktop Notebooks menu: Radix gives the
// content `role="dialog"` and no name. The primitive names it after its
// trigger unless the caller says otherwise, so no caller can ship one unnamed.
describe("Popover", () => {
  it("names its open panel after the trigger", () => {
    render(
      <Popover open onOpenChange={() => {}} trigger={<Button aria-label="Notebooks">Notebooks</Button>}>
        <p>Rows</p>
      </Popover>,
    );
    expect(screen.getByRole("dialog", { name: "Notebooks" })).toBeTruthy();
  });

  it("takes an explicit name when the caller gives one", () => {
    render(
      <Popover open onOpenChange={() => {}} label="Trip history" trigger={<Button>History</Button>}>
        <p>Rows</p>
      </Popover>,
    );
    expect(screen.getByRole("dialog", { name: "Trip history" })).toBeTruthy();
  });
});
