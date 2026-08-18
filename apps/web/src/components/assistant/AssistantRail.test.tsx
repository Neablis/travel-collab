import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssistantRail, type Suggestion } from "./AssistantRail";

afterEach(cleanup);

const suggestions: Suggestion[] = [
  {
    id: "s1",
    location: "Day 2 · Kyoto",
    title: "Sunday has no dinner",
    body: "Three stops and nothing after 4 pm — the only night in Kyoto like that.",
    cta: "Propose dinner",
  },
  {
    id: "s2",
    location: "Day 4 · Nikkō",
    title: "Nikkō is four hours of train",
    body: "Swapping it with Day 5 gives you two calm Tokyo days first, same total travel.",
    cta: "Preview swap",
  },
];

function renderRail(overrides: Partial<React.ComponentProps<typeof AssistantRail>> = {}) {
  return render(
    <AssistantRail
      contextLine="Looking at Day 2 · Kyoto"
      suggestions={suggestions}
      quickAsks={["Where am I overbooked?", "Find a rainy-day swap"]}
      onAsk={vi.fn()}
      onKeepGhost={vi.fn()}
      onDismiss={vi.fn()}
      onHide={vi.fn()}
      {...overrides}
    />,
  );
}

// M10 redesign-feedback follow-up: the rail is no longer wrapped in a single
// outer <Preview id="assistant-rail"> — its header/context line/ask box are
// real (the same composeAiPlan feature the old standalone ComposePanel used
// to expose directly), while "What I noticed" suggestions and the quick-ask
// chips stay behind their own, narrower <Preview> wraps internally (still
// M9, nothing generates a real suggestion yet).
describe("AssistantRail", () => {
  it("renders the context line", () => {
    renderRail();
    expect(screen.getByText("Looking at Day 2 · Kyoto")).not.toBeNull();
  });

  it("renders a suggestion card per fixture entry, inert inside its own Preview region", () => {
    const { container } = renderRail();
    const region = container.querySelector('[data-preview-id="assistant-suggestions"]');
    expect(region).not.toBeNull();
    for (const s of suggestions) {
      expect(screen.getByText(s.location)).not.toBeNull();
      expect(screen.getByText(s.title)).not.toBeNull();
      expect(screen.getByText(s.body)).not.toBeNull();
      expect(screen.getByRole("button", { name: s.cta })).not.toBeNull();
    }
    expect(screen.getAllByRole("button", { name: "Dismiss" })).toHaveLength(suggestions.length);
  });

  it("does not call onKeepGhost when a suggestion's CTA is clicked — the shield swallows it", async () => {
    const onKeepGhost = vi.fn();
    renderRail({ onKeepGhost });
    await userEvent.click(screen.getByRole("button", { name: suggestions[0]!.cta })).catch(() => {});
    expect(onKeepGhost).not.toHaveBeenCalled();
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
});
