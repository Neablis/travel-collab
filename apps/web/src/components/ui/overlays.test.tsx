import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Button } from "./button";
import { Dialog } from "./dialog";
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

describe("overlays stack above the fixed assistant rail", () => {
  it("stacks sheet surfaces above the fixed assistant rail", () => {
    render(
      <Sheet title="Add a stop" open onOpenChange={() => {}}>
        <p>body</p>
      </Sheet>,
    );

    // The rail is a fixed z-50 sibling rendered OUTSIDE the Radix portal, so the
    // portal content must carry its own stacking class or it loses by DOM order.
    expect(screen.getByRole("dialog").className).toContain("overlay-layer");
  });

  it("stacks dialog surfaces above the fixed assistant rail", () => {
    render(
      <Dialog title="Delete trip" open onOpenChange={() => {}}>
        <p>body</p>
      </Dialog>,
    );

    expect(screen.getByRole("dialog").className).toContain("overlay-layer");
  });
});

// A dialog taller than the viewport must SCROLL, not overflow.
//
// jsdom has no layout, so this cannot measure a height — it pins the two
// decisions that produce the behaviour, which is the honest amount a unit test
// can claim here. The behaviour itself is covered where layout exists:
// `m11-saved-days.spec.ts` clicks the first row of a saved-day list long enough
// to overflow, and that click is exactly what hung before this existed.
//
// The failure mode is worth stating because it is not the obvious one. A
// centred `top-1/2 -translate-y-1/2` box with no cap spills off the TOP of a
// short viewport as well as the bottom, and the part above the top edge cannot
// be scrolled to, because the content is `fixed`. So it is the START of a long
// dialog that becomes unreachable — by mouse, by keyboard and by Playwright,
// with nothing on screen to say so.
describe("a dialog longer than the viewport", () => {
  it("caps its height and scrolls its body, rather than overflowing off both edges", () => {
    render(
      <Dialog title="Add a saved day" open onOpenChange={() => {}}>
        <p>body</p>
      </Dialog>,
    );
    // An inline style, not a `max-h-[…]` class: a viewport-relative cap is not
    // a design constant and has no token, and an arbitrary Tailwind value in a
    // className is what `check-color-wall.mjs` rejects. Same escape hatch
    // Board and Sparkline take for computed geometry.
    const content = screen.getByRole("dialog");
    expect(content.style.maxHeight).toBe("85vh");

    // `min-h-0` is load-bearing beside `flex-1`: a flex item's default
    // `min-height: auto` refuses to shrink below its content, so the body would
    // grow the capped box instead of scrolling inside it.
    const body = screen.getByText("body").parentElement!;
    expect(body.className).toContain("overflow-y-auto");
    expect(body.className).toContain("min-h-0");
  });

  it("keeps the Sheet's focus-ring clearance rather than a bare scrollport", () => {
    render(
      <Dialog title="Trip settings" open onOpenChange={() => {}}>
        <p>body</p>
      </Dialog>,
    );
    // Overflow on one axis forces the other to a non-visible value, which
    // slices the left edge off a `w-full` control's focus ring (Mitchell,
    // preview feedback on PR #55 — reported twice). `-mx-1 px-1` gives the ring
    // room and cancels the shift.
    const body = screen.getByText("body").parentElement!;
    expect(body.className).toContain("-mx-1");
    expect(body.className).toContain("px-1");
  });
});
