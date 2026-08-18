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
