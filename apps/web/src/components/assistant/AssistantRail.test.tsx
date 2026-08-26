import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssistantRail } from "./AssistantRail";

afterEach(cleanup);


// Required-prop fixture for tests that assert on a specific optional prop
// (e.g. `simulated`) without needing renderRail's override merging — mirrors
// the same values renderRail defaults to below.
const baseProps: React.ComponentProps<typeof AssistantRail> = {
  contextLine: "Looking at Day 2 · Kyoto",
  quickAsks: ["Where am I overbooked?", "Find a rainy-day swap"],
  onAsk: vi.fn(),
  onDismiss: vi.fn(),
  onHide: vi.fn(),
};

function renderRail(overrides: Partial<React.ComponentProps<typeof AssistantRail>> = {}) {
  return render(
    <AssistantRail
      contextLine="Looking at Day 2 · Kyoto"
      quickAsks={["Where am I overbooked?", "Find a rainy-day swap"]}
      onAsk={vi.fn()}
      onDismiss={vi.fn()}
      onHide={vi.fn()}
      {...overrides}
    />,
  );
}

// M10 redesign-feedback follow-up: the rail is no longer wrapped in a single
// outer <Preview id="assistant-rail"> — its header/context line/ask box are
// real (the same composeAiPlan feature the old standalone ComposePanel used
// to expose directly), while the quick-ask chips stay behind their own,
// narrower <Preview> wrap internally (still M9 — nothing generates a real
// nudge yet).
describe("AssistantRail", () => {
  it("renders the context line", () => {
    renderRail();
    expect(screen.getByText("Looking at Day 2 · Kyoto")).not.toBeNull();
  });

  // The "What I noticed" shelf is deliberately absent (Mitchell, preview
  // feedback on PR #55; the 2026-08-24 design's panel markup has no such
  // block either). Asserted, not merely deleted, so re-adding it is a
  // failing test rather than a silent regression.
  it("has no suggestions shelf, and holds the conversation space with the design's hint", () => {
    const { container } = renderRail();
    expect(container.querySelector('[data-preview-id="assistant-suggestions"]')).toBeNull();
    expect(screen.queryByText("What I noticed")).toBeNull();
    expect(screen.getByText("Ask about this trip and the conversation stays here.")).not.toBeNull();
  });

  it("renders quick-ask chips, inert inside their own Preview region", () => {
    const { container } = renderRail();
    const region = container.querySelector('[data-preview-id="assistant-quick-asks"]');
    expect(region).not.toBeNull();
    expect(screen.getByRole("button", { name: "Where am I overbooked?" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Find a rainy-day swap" })).not.toBeNull();
  });

  it("does not call onAsk when a quick-ask chip is clicked — the shield swallows it", async () => {
    const onAsk = vi.fn();
    renderRail({ onAsk });
    await userEvent.click(screen.getByRole("button", { name: "Where am I overbooked?" })).catch(() => {});
    expect(onAsk).not.toHaveBeenCalled();
  });

  it("the Ask box is real: typing and submitting calls onAsk with the typed text", () => {
    const onAsk = vi.fn();
    renderRail({ onAsk });
    const input = screen.getByPlaceholderText(/ask about this day/i);
    fireEvent.change(input, { target: { value: "Where am I overbooked?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(onAsk).toHaveBeenCalledWith("Where am I overbooked?");
    expect((input as HTMLInputElement).value).toBe("");
  });

  it("submits on Enter", () => {
    const onAsk = vi.fn();
    renderRail({ onAsk });
    const input = screen.getByPlaceholderText(/ask about this day/i);
    fireEvent.change(input, { target: { value: "Cheapest way between cities" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onAsk).toHaveBeenCalledWith("Cheapest way between cities");
  });

  it("disables the Ask input/button and shows a busy label while asking", () => {
    renderRail({ asking: true });
    expect((screen.getByPlaceholderText(/ask about this day/i) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Asking…" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows an inline error when the last ask failed", () => {
    renderRail({ askError: "The model is unavailable right now." });
    expect(screen.getByRole("alert").textContent).toBe("The model is unavailable right now.");
  });

  it("the Hide control is real: clicking it calls onHide", () => {
    const onHide = vi.fn();
    renderRail({ onHide });
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(onHide).toHaveBeenCalledOnce();
  });

  it("dismisses the rail when the scrim is clicked", async () => {
    const onHide = vi.fn();
    renderRail({ onHide });

    await userEvent.click(screen.getByRole("button", { name: "Close the assistant" }));

    expect(onHide).toHaveBeenCalledTimes(1);
  });

  it("does not leave an inert pointer-blocking layer over the page", () => {
    renderRail();

    const scrim = document.querySelector(".assistant-rail-scrim");
    expect(scrim).not.toBeNull();
    // A blocking layer must be a real control, not an aria-hidden div — otherwise
    // it swallows every click on the page behind it (the 1100px dead-page bug).
    expect(scrim?.tagName).toBe("BUTTON");
    expect(scrim?.getAttribute("aria-hidden")).toBeNull();
  });

  it("shows a Simulated badge when the last answer came from the server, not a model", () => {
    render(<AssistantRail {...baseProps} simulated />);
    expect(screen.getByText("Simulated")).not.toBeNull();
  });

  it("shows no badge for a real answer", () => {
    render(<AssistantRail {...baseProps} />);
    expect(screen.queryByText("Simulated")).toBeNull();
  });
});
