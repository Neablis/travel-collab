import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Preview } from "@/components/ui/preview";
import { PlaybooksStrip, type PlaybookCard } from "./PlaybooksStrip";

afterEach(cleanup);

const playbooks: PlaybookCard[] = [
  {
    id: "p1",
    city: "Kyoto",
    name: "Higashiyama at dawn",
    span: "1 day · 5 stops",
    window: "6:30 am – 2:15 pm",
    shape: [46, 72, 100, 58, 88],
  },
  {
    id: "p2",
    city: "New Orleans",
    name: "Tremé food day",
    span: "1 day · 4 stops",
    window: "9 am – 11:45 pm",
    shape: [46, 72, 100, 58],
  },
];

function renderStrip() {
  return render(
    <Preview id="home-playbooks-strip" size="container">
      <PlaybooksStrip playbooks={playbooks} />
    </Preview>,
  );
}

describe("PlaybooksStrip", () => {
  it("renders entirely inside the home-playbooks-strip preview region", () => {
    const { container } = renderStrip();
    const region = container.querySelector('[data-preview-id="home-playbooks-strip"]');
    expect(region).not.toBeNull();
    expect(region?.textContent).toContain("Higashiyama at dawn");
  });

  it("renders a card per fixture entry, with city pill, name, span and window", () => {
    renderStrip();
    for (const pb of playbooks) {
      expect(screen.getByText(pb.city)).not.toBeNull();
      expect(screen.getByText(pb.name)).not.toBeNull();
      expect(screen.getByText(pb.span)).not.toBeNull();
      expect(screen.getByText(pb.window)).not.toBeNull();
    }
  });

  it("renders one shape-strip bar per shape value, per card", () => {
    renderStrip();
    for (const pb of playbooks) {
      const card = screen.getByText(pb.name).closest('[data-testid="playbook-card"]');
      expect(card).not.toBeNull();
      expect(card?.querySelectorAll('[data-testid="playbook-bar"]')).toHaveLength(pb.shape.length);
    }
  });

  it("renders exactly one card per fixture item", () => {
    const { container } = renderStrip();
    expect(container.querySelectorAll('[data-testid="playbook-card"]')).toHaveLength(playbooks.length);
  });
});
