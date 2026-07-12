import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Button } from "./button";
import { Popover } from "./popover";
import { Sheet } from "./sheet";

function SheetHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open sheet</Button>
      <Sheet open={open} onOpenChange={setOpen} title="Trip settings">
        <p>sheet body</p>
      </Sheet>
    </>
  );
}

function PopoverHarness() {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen} trigger={<Button onClick={() => setOpen(true)}>History</Button>}>
      <p>popover body</p>
    </Popover>
  );
}

describe("overlays open via fireEvent.click (owned state, no Radix trigger)", () => {
  it("Sheet opens on a plain-button click", () => {
    render(<SheetHarness />);
    expect(screen.queryByText("sheet body")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open sheet" }));
    expect(screen.getByRole("dialog", { name: "Trip settings" })).toBeTruthy();
    expect(screen.getByText("sheet body")).toBeTruthy();
  });

  it("Popover opens on a plain-button click", () => {
    render(<PopoverHarness />);
    expect(screen.queryByText("popover body")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    expect(screen.getByText("popover body")).toBeTruthy();
  });
});
