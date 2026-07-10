import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AnchorEditor } from "./AnchorEditor";

describe("AnchorEditor", () => {
  it("adds and removes an anchor", async () => {
    const onChange = vi.fn();
    const { rerender } = render(<AnchorEditor value={[]} onChange={onChange} />);
    await userEvent.selectOptions(screen.getByLabelText(/anchor kind/i), "dayOfWeek");
    await userEvent.click(screen.getByRole("button", { name: /add anchor/i }));
    expect(onChange).toHaveBeenCalledWith([{ kind: "dayOfWeek", days: ["mon", "tue", "wed", "thu", "fri"] }]);
    rerender(<AnchorEditor value={[{ kind: "dayOfWeek", days: ["mon"] }]} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: /remove/i }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});
