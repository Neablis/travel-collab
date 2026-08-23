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

  it("does not commit per keystroke, only once on blur", () => {
    const onChange = vi.fn();
    render(<MoneyInput value={null} currency="USD" onChange={onChange} />);
    const input = screen.getByLabelText(/cost/i);
    // Simulate typing "10000" one digit at a time, as the browser would
    // fire a change event per keystroke — none of these should commit, so a
    // slow-resolving early keystroke's server round-trip can't race ahead
    // of the final value.
    for (const raw of ["1", "10", "100", "1000", "10000"]) {
      fireEvent.change(input, { target: { value: raw } });
    }
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith({ amountMinor: 1000000, currency: "USD" });
  });

  it("commits on Enter (and blurs) without falling through to a surrounding form's submit", async () => {
    const onChange = vi.fn();
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <MoneyInput value={null} currency="USD" onChange={onChange} />
      </form>,
    );
    const input = screen.getByLabelText(/cost/i);
    await userEvent.type(input, "99");
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.keyboard("{Enter}");
    expect(onChange).toHaveBeenLastCalledWith({ amountMinor: 9900, currency: "USD" });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(input);
  });

  it("reverts to the last external value on Escape, without committing", async () => {
    const onChange = vi.fn();
    render(<MoneyInput value={{ amountMinor: 5000, currency: "USD" }} currency="USD" onChange={onChange} />);
    const input = screen.getByLabelText(/cost/i) as HTMLInputElement;
    await userEvent.clear(input);
    await userEvent.type(input, "999");
    expect(input.value).toBe("999");
    await userEvent.keyboard("{Escape}");
    // A type="number" input normalizes a trailing "50.00" to "50" once real
    // typing has touched it, so compare numerically rather than by string.
    expect(Number(input.value)).toBe(50);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("flushes a pending, uncommitted edit if unmounted before it blurs", () => {
    const onChange = vi.fn();
    const { unmount } = render(<MoneyInput value={null} currency="USD" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/cost/i), { target: { value: "15" } });
    expect(onChange).not.toHaveBeenCalled();
    unmount();
    expect(onChange).toHaveBeenCalledWith({ amountMinor: 1500, currency: "USD" });
  });

  it("does not re-fire onChange on unmount if there is no pending edit", () => {
    const onChange = vi.fn();
    const { unmount } = render(<MoneyInput value={{ amountMinor: 4250, currency: "USD" }} currency="USD" onChange={onChange} />);
    unmount();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("re-syncs the displayed value when the value prop changes externally (e.g. undo)", () => {
    const onChange = vi.fn();
    const { rerender } = render(<MoneyInput value={{ amountMinor: 100000, currency: "EUR" }} currency="EUR" onChange={onChange} />);
    expect((screen.getByLabelText(/cost/i) as HTMLInputElement).value).toBe("1,000.00");
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

  it("shows a grouped amount when not focused (#22)", () => {
    render(<MoneyInput value={{ amountMinor: 111110600, currency: "USD" }} currency="USD" onChange={vi.fn()} />);
    expect((screen.getByLabelText("cost (USD)") as HTMLInputElement).value).toBe("1,111,106.00");
  });

  it("commits parsed minor units from a comma-grouped entry on blur", () => {
    const onChange = vi.fn();
    render(<MoneyInput value={null} currency="USD" onChange={onChange} />);
    const input = screen.getByLabelText("cost (USD)");
    fireEvent.change(input, { target: { value: "4,332,212" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith({ amountMinor: 433221200, currency: "USD" });
  });

  it("defers to an external associated label instead of the generic aria-label, when an id is passed", () => {
    render(
      <div>
        <label htmlFor="trip-budget">Total for the trip</label>
        <MoneyInput id="trip-budget" value={null} currency="USD" onChange={vi.fn()} />
      </div>,
    );
    // The real external label is the accessible name...
    expect(screen.getByLabelText("Total for the trip")).toBeTruthy();
    // ...and the generic "cost (USD)" label no longer wins/overrides it.
    expect(screen.queryByLabelText("cost (USD)")).toBeNull();
  });
});
