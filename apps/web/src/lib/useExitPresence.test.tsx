import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useExitPresence, useLetGoOfFocusOnClose } from "./useExitPresence";

// ADR-082 §2: a surface Radix does not manage (the toast) stays mounted for
// its exit animation, and is inert from the moment it starts to leave, so a
// leaving toast never takes the click meant for what is under it. jsdom runs
// no animation, so "has an exit animation" is an inline `animation-name`,
// which is what `getComputedStyle` reads in a browser from globals.css.
function Harness({ onGone, animated }: { onGone: () => void; animated: boolean }) {
  const { ref, exit } = useExitPresence<HTMLDivElement>();
  return (
    <>
      <div ref={ref} role="status" data-state="open" style={animated ? { animationName: "tc-sink-out" } : undefined}>
        Saved
        <button type="button">Undo</button>
      </div>
      <button type="button" onClick={() => exit(onGone)}>
        Dismiss
      </button>
    </>
  );
}

describe("useExitPresence", () => {
  // What reduced motion gives in a browser is proved in m54-motion.spec.ts;
  // jsdom loads no stylesheet, so this covers only the hook's own branch.
  it("unmounts at once when no exit animation applies", () => {
    const onGone = vi.fn();
    render(<Harness onGone={onGone} animated={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onGone).toHaveBeenCalledTimes(1);
  });

  it("holds the node for its exit, inert from the first frame, and lets go on its own animationend", () => {
    const onGone = vi.fn();
    render(<Harness onGone={onGone} animated />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    const status = screen.getByRole("status");
    expect(onGone).not.toHaveBeenCalled();
    expect(status.hasAttribute("inert")).toBe(true);
    expect(status.getAttribute("data-state")).toBe("closed");

    // A child's animation bubbling up is not the exit ending.
    fireEvent.animationEnd(screen.getByRole("button", { name: "Undo" }));
    expect(onGone).not.toHaveBeenCalled();

    fireEvent.animationEnd(status);
    expect(onGone).toHaveBeenCalledTimes(1);
  });

  it("does not finish an exit twice when asked to leave again mid-exit", () => {
    const onGone = vi.fn();
    render(<Harness onGone={onGone} animated />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    fireEvent.animationEnd(screen.getByRole("status"));
    expect(onGone).toHaveBeenCalledTimes(1);
  });
});

// A modal Radix overlay hides the page with `aria-hidden` (marked
// `data-aria-hidden`) until it unmounts, so at close its opener is always
// under it. `pageHidden` stands in for that; `data-state` for Radix's.
function ModalHarness({ open, pageHidden }: { open: boolean; pageHidden: boolean }) {
  useLetGoOfFocusOnClose(open);
  return (
    <>
      <div data-aria-hidden={pageHidden ? "true" : undefined} aria-hidden={pageHidden ? "true" : undefined}>
        <button type="button">Open</button>
      </div>
      <div data-motion="rise" data-state={open ? "open" : "closed"}>
        <button type="button">Inside</button>
      </div>
    </>
  );
}

describe("useLetGoOfFocusOnClose", () => {
  // Spec §3: focus is on the opener the moment the overlay closes, not after
  // its exit, and exposed: a role query skips an `aria-hidden` subtree.
  it("gives focus to a modal's opener at once, lifting the page's aria-hidden off it", () => {
    const { rerender } = render(<ModalHarness open={false} pageHidden={false} />);
    screen.getByRole("button", { name: "Open" }).focus();
    rerender(<ModalHarness open pageHidden={false} />);
    rerender(<ModalHarness open pageHidden />);
    screen.getByRole("button", { name: "Inside" }).focus();

    rerender(<ModalHarness open={false} pageHidden />);
    expect(screen.getByRole("button", { name: "Open" }).matches(":focus")).toBe(true);
  });

  // Reopened within its exit, Radix keeps the content mounted and hides the
  // page only on mount, so nothing else would hide again what the close lifted.
  it("hides the page again when the modal reopens during its exit", () => {
    const { rerender } = render(<ModalHarness open={false} pageHidden={false} />);
    screen.getByRole("button", { name: "Open" }).focus();
    rerender(<ModalHarness open pageHidden={false} />);
    rerender(<ModalHarness open pageHidden />);
    screen.getByRole("button", { name: "Inside" }).focus();
    rerender(<ModalHarness open={false} pageHidden />);

    rerender(<ModalHarness open pageHidden />);
    expect(screen.queryByRole("button", { name: "Open" })).toBeNull();
  });

  // Radix's FocusScope autofocuses only on mount, so after a reopen within
  // the exit nothing else takes focus off the opener, now hidden again, and
  // what is typed goes to it rather than to the overlay.
  it("puts focus back inside a modal reopened during its exit", () => {
    const { rerender } = render(<ModalHarness open={false} pageHidden={false} />);
    screen.getByRole("button", { name: "Open" }).focus();
    rerender(<ModalHarness open pageHidden={false} />);
    rerender(<ModalHarness open pageHidden />);
    screen.getByRole("button", { name: "Inside" }).focus();
    rerender(<ModalHarness open={false} pageHidden />);

    rerender(<ModalHarness open pageHidden />);
    expect(screen.getByRole("button", { name: "Inside" }).matches(":focus")).toBe(true);
  });

  // Once the exit has ended the page is no longer marked, and a fresh open
  // must leave hiding it to Radix: an `aria-hidden` put back first would be
  // one Radix counts as not its own, and never removes.
  it("does not hide the page again on an open after the exit has ended", () => {
    const { rerender } = render(<ModalHarness open={false} pageHidden={false} />);
    screen.getByRole("button", { name: "Open" }).focus();
    rerender(<ModalHarness open pageHidden={false} />);
    rerender(<ModalHarness open pageHidden />);
    screen.getByRole("button", { name: "Inside" }).focus();
    rerender(<ModalHarness open={false} pageHidden />);
    rerender(<ModalHarness open={false} pageHidden={false} />);

    rerender(<ModalHarness open pageHidden={false} />);
    expect(screen.getByRole("button", { name: "Open" })).toBeDefined();
  });
});

type CloseHandler = { current: ((event: Event) => void) | null };

// What an overlay's `onCloseAutoFocus` becomes: the caller's handler (here
// one like the palette's, which focuses its opener), wrapped by the hook.
function ReturnHarness({ open, onClose }: { open: boolean; onClose: CloseHandler }) {
  const { keepFocusMovedOn } = useLetGoOfFocusOnClose(open);
  onClose.current = keepFocusMovedOn(() => screen.getByRole("button", { name: "Open" }).focus());
  return (
    <>
      <button type="button">Open</button>
      <button type="button">Next</button>
      <div data-motion="rise" data-state={open ? "open" : "closed"}>
        <button type="button">Inside</button>
      </div>
    </>
  );
}

describe("keepFocusMovedOn (KI-2026-10-26-t)", () => {
  const closeFromInside = () => {
    const onClose: CloseHandler = { current: null };
    const { rerender } = render(<ReturnHarness open={false} onClose={onClose} />);
    screen.getByRole("button", { name: "Open" }).focus();
    rerender(<ReturnHarness open onClose={onClose} />);
    screen.getByRole("button", { name: "Inside" }).focus();
    rerender(<ReturnHarness open={false} onClose={onClose} />);
    return onClose.current!;
  };

  // A Tab during the exit: the return at the unmount must not take it back.
  it("leaves focus where the person moved it during the exit, and cancels Radix's return", () => {
    const onCloseAutoFocus = closeFromInside();
    screen.getByRole("button", { name: "Next" }).focus();

    const event = new Event("focusScope.autoFocusOnUnmount", { cancelable: true });
    onCloseAutoFocus(event);
    expect(screen.getByRole("button", { name: "Next" }).matches(":focus")).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });

  // Still where the close put it: the return goes ahead as it always did.
  it("lets the return run when focus is still on the opener", () => {
    const onCloseAutoFocus = closeFromInside();
    expect(screen.getByRole("button", { name: "Open" }).matches(":focus")).toBe(true);

    const event = new Event("focusScope.autoFocusOnUnmount", { cancelable: true });
    onCloseAutoFocus(event);
    expect(screen.getByRole("button", { name: "Open" }).matches(":focus")).toBe(true);
    expect(event.defaultPrevented).toBe(false);
  });
});
