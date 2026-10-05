import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./button";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "./menu";

function Harness({ onRemove = () => {} }: { onRemove?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Menu open={open} onOpenChange={setOpen}>
      <MenuTrigger>
        <Button variant="ghost" size="icon" aria-label="Actions for Alex">
          ⋯
        </Button>
      </MenuTrigger>
      <MenuContent>
        <MenuLabel>Alex R.</MenuLabel>
        <MenuItem>Mark as travelling</MenuItem>
        <MenuSeparator />
        <MenuItem variant="destructive" onSelect={onRemove}>
          Remove from trip…
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

describe("Menu", () => {
  // ADR-012 invariant 3: an overlay opens from owned state on a plain click.
  // Radix's own trigger listens for pointerdown, which fireEvent.click (and a
  // synthetic click from any other caller) never sends.
  it("opens on a plain click and closes on a second one", () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Actions for Alex" });
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(trigger);
    expect(screen.getByRole("menuitem", { name: "Mark as travelling" })).toBeTruthy();

    fireEvent.click(trigger);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens from the keyboard", () => {
    render(<Harness />);
    fireEvent.keyDown(screen.getByRole("button", { name: "Actions for Alex" }), { key: "Enter" });
    expect(screen.getByRole("menu")).toBeTruthy();
  });

  it("runs the chosen item and closes", () => {
    const onRemove = vi.fn();
    render(<Harness onRemove={onRemove} />);
    fireEvent.click(screen.getByRole("button", { name: "Actions for Alex" }));

    fireEvent.click(screen.getByRole("menuitem", { name: "Remove from trip…" }));
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
