import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Preview } from "@/components/ui/preview";
import { PlaybooksScreen } from "./PlaybooksScreen";
import { PREVIEW_PLAYBOOK_CARDS } from "./preview-fixtures";

afterEach(cleanup);

// PlaybooksScreen itself isn't self-wrapped (unlike KeepDayDialog) — its
// caller, app/playbooks/page.tsx, mounts it inside
// <Preview id="playbooks-route"> the same way home's WorthYourAttention/
// PlaybooksStrip are wrapped by app/page.tsx (Task 16's pattern). Every test
// below renders that same wrapper so it also proves the whole screen really
// does render inside the "playbooks-route" region, matching the route.
function renderScreen() {
  return render(
    <Preview id="playbooks-route" size="container">
      <PlaybooksScreen playbooks={PREVIEW_PLAYBOOK_CARDS} />
    </Preview>,
  );
}

describe("PlaybooksScreen", () => {
  it("renders entirely inside the playbooks-route preview region", () => {
    const { container } = renderScreen();
    const region = container.querySelector('[data-preview-id="playbooks-route"]');
    expect(region).not.toBeNull();
    expect(region?.textContent).toContain("Playbooks");
  });

  it("renders the info banner", () => {
    renderScreen();
    const banner = screen.getByRole("status");
    expect(banner.textContent).toMatch(/shifts to the day you chose/i);
  });

  it("renders the filter SegmentedControl and a city select", () => {
    const { container } = renderScreen();
    expect(screen.getByRole("radiogroup", { name: /filter/i })).not.toBeNull();
    const citySelect = container.querySelector("select");
    expect(citySelect).not.toBeNull();
    expect(within(citySelect as HTMLSelectElement).getByText("All cities")).not.toBeNull();
  });

  it("renders one card per fixture playbook, with city pill, name and footer actions", () => {
    const { container } = renderScreen();
    const cards = container.querySelectorAll('[data-testid="playbook-detail-card"]');
    expect(cards).toHaveLength(PREVIEW_PLAYBOOK_CARDS.length);
    for (const pb of PREVIEW_PLAYBOOK_CARDS) {
      const card = screen.getByText(pb.name).closest('[data-testid="playbook-detail-card"]');
      expect(card).not.toBeNull();
      const scoped = within(card as HTMLElement);
      expect(scoped.getByText(pb.city)).not.toBeNull();
      expect(scoped.getByRole("button", { name: "Share" })).not.toBeNull();
      expect(scoped.getByRole("button", { name: "Add to trip" })).not.toBeNull();
    }
  });

  it("closes the grid with a dashed Community Playbooks placeholder card", () => {
    renderScreen();
    expect(screen.getByText("Community Playbooks")).not.toBeNull();
    expect(screen.getByRole("button", { name: /notify me/i })).not.toBeNull();
  });
});
