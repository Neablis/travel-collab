import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tripDetailFixture, historyFixture } from "@tc/factories";

const composeAiPlanMock = vi.fn();

vi.mock("@/lib/apiClient", async (orig) => {
  const actual = await orig<typeof import("@/lib/apiClient")>();
  return {
    ...actual,
    composeAiPlan: (...args: unknown[]) => composeAiPlanMock(...args),
  };
});

import { ComposePanel } from "./ComposePanel";

afterEach(cleanup);

beforeEach(() => {
  composeAiPlanMock.mockReset();
  composeAiPlanMock.mockResolvedValue({
    ok: true,
    value: {
      detail: tripDetailFixture({ tripId: "x" }),
      history: historyFixture("x"),
      message: "Done — added a day.",
      // Untyped mock (vi.fn()), so tsc doesn't require this — kept for
      // realism/consistency with the real PlanOutcome shape, not correctness.
      simulated: false,
    },
  });
});

describe("ComposePanel", () => {
  it("submits on Enter", async () => {
    const onApplied = vi.fn();
    render(<ComposePanel tripId="x" surface="board" onApplied={onApplied} />);

    await userEvent.type(screen.getByLabelText(/ask ai to plan/i), "Add a day{Enter}");

    expect(composeAiPlanMock).toHaveBeenCalledWith("x", "Add a day", "board");
  });

  it("does not submit on Shift+Enter, and inserts a newline instead", async () => {
    const onApplied = vi.fn();
    render(<ComposePanel tripId="x" surface="board" onApplied={onApplied} />);

    const textarea = screen.getByLabelText(/ask ai to plan/i) as HTMLTextAreaElement;
    await userEvent.type(textarea, "Add a day{Shift>}{Enter}{/Shift}and lunch");

    expect(composeAiPlanMock).not.toHaveBeenCalled();
    expect(textarea.value).toBe("Add a day\nand lunch");
  });

  it("does not submit on Enter when the prompt is empty", async () => {
    render(<ComposePanel tripId="x" surface="board" onApplied={vi.fn()} />);

    const textarea = screen.getByLabelText(/ask ai to plan/i);
    textarea.focus();
    await userEvent.keyboard("{Enter}");

    expect(composeAiPlanMock).not.toHaveBeenCalled();
  });
});
