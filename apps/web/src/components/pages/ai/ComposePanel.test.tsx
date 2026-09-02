import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const composeAiPageMock = vi.fn();

vi.mock("@/lib/apiClient", async (orig) => {
  const actual = await orig<typeof import("@/lib/apiClient")>();
  return {
    ...actual,
    composeAiPage: (...args: unknown[]) => composeAiPageMock(...args),
  };
});

import { ComposePanel } from "./ComposePanel";

const PAGE_CONTEXT = { tripId: "x" };

afterEach(cleanup);

beforeEach(() => {
  composeAiPageMock.mockReset();
  composeAiPageMock.mockResolvedValue({
    ok: true,
    value: {
      content: { type: "doc", content: [] },
      // Untyped mock (vi.fn()), so tsc doesn't require this — kept for
      // realism/consistency with what composeAiPage really resolves to, not
      // correctness.
      simulated: false,
    },
  });
});

// The keyboard contract, on the one surface this panel still has (ADR-033
// Decision 4 retired board/combined). These used to render `surface="board"`
// and mock `composeAiPlan`, so they were testing a surface with no production
// caller; the behaviour under test — Enter submits, Shift+Enter does not — is
// the same either way and is what the Notebook depends on.
describe("ComposePanel", () => {
  it("submits on Enter", async () => {
    const onApply = vi.fn();
    render(<ComposePanel tripId="x" surface="page" pageContext={PAGE_CONTEXT} onApply={onApply} />);

    await userEvent.type(screen.getByLabelText(/ask ai to draft this page/i), "Add a packing list{Enter}");

    expect(composeAiPageMock).toHaveBeenCalledWith("x", "Add a packing list", PAGE_CONTEXT);
  });

  it("does not submit on Shift+Enter, and inserts a newline instead", async () => {
    const onApply = vi.fn();
    render(<ComposePanel tripId="x" surface="page" pageContext={PAGE_CONTEXT} onApply={onApply} />);

    const textarea = screen.getByLabelText(/ask ai to draft this page/i) as HTMLTextAreaElement;
    await userEvent.type(textarea, "Add a packing list{Shift>}{Enter}{/Shift}and the itinerary");

    expect(composeAiPageMock).not.toHaveBeenCalled();
    expect(textarea.value).toBe("Add a packing list\nand the itinerary");
  });

  it("does not submit on Enter when the prompt is empty", async () => {
    render(<ComposePanel tripId="x" surface="page" pageContext={PAGE_CONTEXT} onApply={vi.fn()} />);

    const textarea = screen.getByLabelText(/ask ai to draft this page/i);
    textarea.focus();
    await userEvent.keyboard("{Enter}");

    expect(composeAiPageMock).not.toHaveBeenCalled();
  });
});
