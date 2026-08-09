import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Preview } from "@/components/ui/preview";
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

function renderRail() {
  return render(
    <Preview id="assistant-rail">
      <AssistantRail
        contextLine="Looking at Day 2 · Kyoto"
        suggestions={suggestions}
        quickAsks={["Where am I overbooked?", "Find a rainy-day swap"]}
        onAsk={vi.fn()}
        onKeepGhost={vi.fn()}
        onDismiss={vi.fn()}
        onHide={vi.fn()}
      />
    </Preview>,
  );
}

describe("AssistantRail", () => {
  it("renders entirely inside the assistant-rail preview region", () => {
    const { container } = renderRail();
    const region = container.querySelector('[data-preview-id="assistant-rail"]');
    expect(region).not.toBeNull();
    expect(region?.textContent).toContain("Looking at Day 2 · Kyoto");
  });

  it("renders the context line", () => {
    renderRail();
    expect(screen.getByText("Looking at Day 2 · Kyoto")).not.toBeNull();
  });

  it("renders a suggestion card per fixture entry, with location, title, body and CTA", () => {
    renderRail();
    for (const s of suggestions) {
      expect(screen.getByText(s.location)).not.toBeNull();
      expect(screen.getByText(s.title)).not.toBeNull();
      expect(screen.getByText(s.body)).not.toBeNull();
      expect(screen.getByRole("button", { name: s.cta })).not.toBeNull();
    }
    expect(screen.getAllByRole("button", { name: "Dismiss" })).toHaveLength(suggestions.length);
  });

  it("renders quick-ask chips", () => {
    renderRail();
    expect(screen.getByRole("button", { name: "Where am I overbooked?" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Find a rainy-day swap" })).not.toBeNull();
  });

  it("renders an Ask input and submit control", () => {
    renderRail();
    expect(screen.getByPlaceholderText(/ask/i)).not.toBeNull();
    expect(screen.getByRole("button", { name: "Ask" })).not.toBeNull();
  });

  it("renders a Hide control", () => {
    renderRail();
    expect(screen.getByRole("button", { name: "Hide" })).not.toBeNull();
  });
});
