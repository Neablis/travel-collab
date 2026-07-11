import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MoneyInput } from "./MoneyInput";

afterEach(cleanup);

describe("MoneyInput", () => {
  it("emits integer minor units from a decimal entry, on blur", async () => {
    const onChange = vi.fn();
    render(<MoneyInput value={null} currency="USD" onChange={onChange} />);
    await userEvent.type(screen.getByLabelText(/cost/i), "42.50");
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.tab();
    expect(onChange).toHaveBeenLastCalledWith({ amountMinor: 4250, currency: "USD" });
  });

  it("clears to null when emptied, on blur", async () => {
    const onChange = vi.fn();
    render(<MoneyInput value={{ amountMinor: 4250, currency: "USD" }} currency="USD" onChange={onChange} />);
    await userEvent.clear(screen.getByLabelText(/cost/i));
    await userEvent.tab();
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("debounces rapid keystrokes into a single commit, rather than one per digit", () => {
    vi.useFakeTimers();
    try {
      const onChange = vi.fn();
      render(<MoneyInput value={null} currency="USD" onChange={onChange} />);
      const input = screen.getByLabelText(/cost/i);
      // Simulate typing "10000" one digit at a time, as the browser would
      // fire a change event per keystroke.
      for (const raw of ["1", "10", "100", "1000", "10000"]) {
        fireEvent.change(input, { target: { value: raw } });
      }
      // Mid-typing: no commit has fired yet, so a slow-resolving early
      // keystroke's server round-trip can't race ahead of the final value.
      expect(onChange).not.toHaveBeenCalled();
      vi.advanceTimersByTime(500);
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenLastCalledWith({ amountMinor: 1000000, currency: "USD" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-syncs the displayed value when the value prop changes externally (e.g. undo)", () => {
    const onChange = vi.fn();
    const { rerender } = render(<MoneyInput value={{ amountMinor: 100000, currency: "EUR" }} currency="EUR" onChange={onChange} />);
    expect((screen.getByLabelText(/cost/i) as HTMLInputElement).value).toBe("1000.00");
    rerender(<MoneyInput value={{ amountMinor: 10000, currency: "EUR" }} currency="EUR" onChange={onChange} />);
    expect((screen.getByLabelText(/cost/i) as HTMLInputElement).value).toBe("100.00");
  });

  it("does not clobber in-progress typing on a re-render with an unchanged value", async () => {
    const onChange = vi.fn();
    const { rerender } = render(<MoneyInput value={null} currency="USD" onChange={onChange} />);
    await userEvent.type(screen.getByLabelText(/cost/i), "7");
    // Same value as before this keystroke's onChange resolves (e.g. a parent
    // re-render triggered by something unrelated) — must not reset display.
    rerender(<MoneyInput value={null} currency="USD" onChange={onChange} />);
    expect((screen.getByLabelText(/cost/i) as HTMLInputElement).value).toBe("7");
  });
});
