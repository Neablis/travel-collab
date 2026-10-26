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
});
