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
});
