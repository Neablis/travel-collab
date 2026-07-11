import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MoneyInput } from "./MoneyInput";

afterEach(cleanup);

describe("MoneyInput", () => {
  it("emits integer minor units from a decimal entry", async () => {
    const onChange = vi.fn();
    render(<MoneyInput value={null} currency="USD" onChange={onChange} />);
    await userEvent.type(screen.getByLabelText(/cost/i), "42.50");
    expect(onChange).toHaveBeenLastCalledWith({ amountMinor: 4250, currency: "USD" });
  });

  it("clears to null when emptied", async () => {
    const onChange = vi.fn();
    render(<MoneyInput value={{ amountMinor: 4250, currency: "USD" }} currency="USD" onChange={onChange} />);
    await userEvent.clear(screen.getByLabelText(/cost/i));
    expect(onChange).toHaveBeenLastCalledWith(null);
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
