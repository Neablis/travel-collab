import { render, screen, fireEvent, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
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

function ActionSheetHarness({ onSave, onCancel }: { onSave: () => void; onCancel?: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <Sheet open={open} onOpenChange={setOpen} title="Add a stop" actions={{ onSave, onCancel }}>
      <p>sheet body</p>
    </Sheet>
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
    // eslint-disable-next-line testing-library/no-node-access -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
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
    // eslint-disable-next-line testing-library/no-node-access -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    const body = screen.getByText("body").parentElement!;
    expect(body.className).toContain("-mx-1");
    expect(body.className).toContain("px-1");
  });
});

// SPEC §13.6 — "Sheets, not pages ... The sheet carries its own Cancel / title /
// Save header, because mobile has no top bar to hang actions on." The header is
// opt-in, so the first thing to hold is that a caller which does not ask for it
// still gets the desktop header it has always had.
describe("the Sheet's optional Cancel / Save header", () => {
  it("leaves the header alone when no actions are passed", () => {
    render(
      <Sheet title="Trip settings" open onOpenChange={() => {}}>
        <p>body</p>
      </Sheet>,
    );
    // The exact inventory, not merely "Close is present": the regression this
    // guards is the actions branch leaking into the default, and a Cancel
    // appearing beside the ✕ would satisfy a looser assertion.
    const dialog = screen.getByRole("dialog", { name: "Trip settings" });
    expect(within(dialog).getAllByRole("button")).toHaveLength(1);
    expect(within(dialog).getByRole("button", { name: "Close" })).toBeTruthy();
  });

  it("swaps the ✕ for Cancel and Save when actions are passed, and still names the dialog", () => {
    render(
      <Sheet title="Add a stop" open onOpenChange={() => {}} actions={{ onSave: () => {} }}>
        <p>body</p>
      </Sheet>,
    );
    // Naming the dialog is `Dialog.Title` still wrapping the heading — the a11y
    // wiring the second header must not drop.
    const dialog = screen.getByRole("dialog", { name: "Add a stop" });
    expect(within(dialog).getAllByRole("button")).toHaveLength(2);
    expect(within(dialog).queryByRole("button", { name: "Close" })).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeTruthy();
    // The 44px floor comes from the shared `touch` size, not from a hand-written
    // override here (SPEC §13.1).
    expect(within(dialog).getByRole("button", { name: "Save" }).className).toContain("min-h-11");
  });

  it("takes both labels and the disabled state from the caller", () => {
    render(
      <Sheet
        title="Add to a trip"
        open
        onOpenChange={() => {}}
        actions={{ onSave: () => {}, saveLabel: "Add", cancelLabel: "Back", saveDisabled: true }}
      >
        <p>body</p>
      </Sheet>,
    );
    expect(screen.getByRole("button", { name: "Back" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Add" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("closes on Cancel, and deliberately does not close on Save", () => {
    // Save leaving the sheet open is the half worth pinning: a save that fails
    // validation has to be able to report into a sheet that is still on screen,
    // and wrapping Save in a `Dialog.Close` — the obvious symmetry — throws that
    // away.
    const onSave = vi.fn();
    const onCancel = vi.fn();
    render(<ActionSheetHarness onSave={onSave} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("still closes on Escape once the ✕ is gone", () => {
    render(<ActionSheetHarness onSave={() => {}} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the actions out of the scrolling body, which is the point of §13.6", () => {
    render(
      <Sheet title="Add a stop" open onOpenChange={() => {}} actions={{ onSave: () => {} }}>
        <p>body</p>
      </Sheet>,
    );
    // A Save rendered inside this element sits below the fold at some scroll
    // position on a 390px screen — which is the bottom-of-the-body placement
    // every caller uses today and that §13.6 exists to replace.
    const scrollport = screen.getByTestId("sheet-scrollport");
    expect(scrollport.className).toContain("overflow-y-auto");
    expect(within(scrollport).queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
  });
});
