import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useExitPresence } from "./useExitPresence";

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
  it("unmounts at once when nothing animates the exit (reduced motion)", () => {
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
