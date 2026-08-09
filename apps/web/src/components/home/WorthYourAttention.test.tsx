import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Preview } from "@/components/ui/preview";
import { WorthYourAttention, type AttentionRow } from "./WorthYourAttention";

afterEach(cleanup);

const items: AttentionRow[] = [
  {
    id: "a1",
    title: "You haven't set a budget",
    body: "Add one so your trip stats can show what's left, not just what's spent.",
    cta: "Set budget",
  },
  {
    id: "a2",
    title: "3 activities still need times",
    body: "Untimed stops don't show up on the calendar view until they have one.",
    cta: "Review",
  },
];

function renderPanel() {
  return render(
    <Preview id="home-worth-attention">
      <WorthYourAttention items={items} />
    </Preview>,
  );
}

describe("WorthYourAttention", () => {
  it("renders entirely inside the home-worth-attention preview region", () => {
    const { container } = renderPanel();
    const region = container.querySelector('[data-preview-id="home-worth-attention"]');
    expect(region).not.toBeNull();
    expect(region?.textContent).toContain("Worth your attention");
  });

  it("renders the panel title as a heading", () => {
    renderPanel();
    expect(screen.getByRole("heading", { name: "Worth your attention" })).not.toBeNull();
  });

  it("renders a row per fixture entry, with title, body and ghost CTA", () => {
    renderPanel();
    for (const item of items) {
      expect(screen.getByText(item.title)).not.toBeNull();
      expect(screen.getByText(item.body)).not.toBeNull();
      expect(screen.getByRole("button", { name: item.cta })).not.toBeNull();
    }
  });

  it("renders exactly one row per fixture item", () => {
    const { container } = renderPanel();
    expect(container.querySelectorAll('[data-testid="attention-row"]')).toHaveLength(items.length);
  });
});
