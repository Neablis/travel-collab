import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MapLegend } from "./MapLegend";

afterEach(cleanup);

describe("MapLegend", () => {
  it("shows the real 'Rest of trip' key outside any Preview wrap", () => {
    const { container } = render(<MapLegend />);
    expect(screen.getByText("Rest of trip")).toBeTruthy();
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    expect(container.querySelector('[data-preview-id="map-legend-modes"]')).not.toBeNull();
  });

  it("keeps the unbacked transport-mode keys inside the map-legend-modes Preview", () => {
    const { container } = render(<MapLegend />);
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    const region = container.querySelector('[data-preview-id="map-legend-modes"]');
    expect(region).not.toBeNull();
    expect(region!.textContent).toContain("On foot");
    expect(region!.textContent).toContain("By train or taxi");
  });
});

// The map draws city-level stops as a disc rather than a teardrop, and nothing
// on screen says why one marker is a different shape. This key is that
// explanation — real behaviour, so it belongs outside the transport-mode
// Preview, which is the half a careless edit gets wrong (a key inside it reads
// as "coming later" and is pointer-dead).
describe("MapLegend — the city disc key", () => {
  it("explains the disc, outside the Preview wrap", () => {
    render(<MapLegend />);
    expect(screen.getByText("Somewhere in this city")).toBeTruthy();
    // The Preview renders `role="group"`; anything inside it is an unbacked
    // claim, and this one is backed.
    expect(screen.getByRole("group").textContent).not.toContain("Somewhere in this city");
  });
});
