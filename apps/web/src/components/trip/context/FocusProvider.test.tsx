import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { FocusProvider, useFocus } from "./FocusProvider";

function Probe() {
  const { focusedDay, setFocusedDay } = useFocus();
  return <button onClick={() => setFocusedDay(2)}>focus:{String(focusedDay)}</button>;
}

describe("FocusProvider", () => {
  it("defaults to null and updates on set", async () => {
    render(<FocusProvider><Probe /></FocusProvider>);
    expect(screen.getByText("focus:null")).not.toBeNull();
    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByText("focus:2")).not.toBeNull();
  });
  it("throws when used outside the provider", () => {
    expect(() => render(<Probe />)).toThrow(/useFocus outside/);
  });
});

// M18b — SPEC §11's tag focus. Held here beside the day focus, above the lens
// switch, so it survives a lens change by construction.
function TagProbe() {
  const { focusedDay, setFocusedDay, focusedTag, toggleFocusedTag, clearFocusedTag } = useFocus();
  return (
    <div>
      <output>tag:{String(focusedTag)} day:{String(focusedDay)}</output>
      <button onClick={() => toggleFocusedTag("meal")}>meal</button>
      <button onClick={() => toggleFocusedTag("lodging")}>lodging</button>
      <button onClick={clearFocusedTag}>clear</button>
      <button onClick={() => setFocusedDay(3)}>day 3</button>
    </div>
  );
}

describe("FocusProvider tag focus", () => {
  it("starts with no tag focused", () => {
    render(<FocusProvider><TagProbe /></FocusProvider>);
    expect(screen.getByText(/tag:null/)).not.toBeNull();
  });

  it("focuses a tag, and clears it when the same tag is toggled again", async () => {
    render(<FocusProvider><TagProbe /></FocusProvider>);
    await userEvent.click(screen.getByRole("button", { name: "meal" }));
    expect(screen.getByText(/tag:meal/)).not.toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "meal" }));
    expect(screen.getByText(/tag:null/)).not.toBeNull();
  });

  // "Single focus, one tag at a time" (SPEC §11) — a second tag REPLACES the
  // first rather than joining it. Multi-select is explicitly out of scope.
  it("replaces the focused tag when a different one is toggled", async () => {
    render(<FocusProvider><TagProbe /></FocusProvider>);
    await userEvent.click(screen.getByRole("button", { name: "meal" }));
    await userEvent.click(screen.getByRole("button", { name: "lodging" }));
    expect(screen.getByText(/tag:lodging/)).not.toBeNull();
  });

  it("clears on demand — the Clear beside the view tabs", async () => {
    render(<FocusProvider><TagProbe /></FocusProvider>);
    await userEvent.click(screen.getByRole("button", { name: "meal" }));
    await userEvent.click(screen.getByRole("button", { name: "clear" }));
    expect(screen.getByText(/tag:null/)).not.toBeNull();
  });

  // The exit gate's "not confused with day focus" box, at the state layer:
  // picking a day must not silently drop a tag the viewer never cleared, and
  // vice versa.
  it("keeps day focus and tag focus independent of each other", async () => {
    render(<FocusProvider><TagProbe /></FocusProvider>);
    await userEvent.click(screen.getByRole("button", { name: "meal" }));
    await userEvent.click(screen.getByRole("button", { name: "day 3" }));
    expect(screen.getByText(/tag:meal day:3/)).not.toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "clear" }));
    expect(screen.getByText(/tag:null day:3/)).not.toBeNull();
  });
});
