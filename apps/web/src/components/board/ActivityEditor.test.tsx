import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ActivityEditor } from "./ActivityEditor";

describe("ActivityEditor", () => {
  it("offers no anchor affordance", () => {
    const props = {
      initial: null,
      onSave: vi.fn(),
      onCancel: vi.fn(),
    };
    render(<ActivityEditor {...props} />);
    expect(screen.queryByText(/anchor/i)).toBeNull();
  });
});
