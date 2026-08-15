import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MapLegend } from "./MapLegend";

afterEach(cleanup);

describe("MapLegend", () => {
  it("shows the real 'Rest of trip' key outside any Preview wrap", () => {
    const { container } = render(<MapLegend />);
    expect(screen.getByText("Rest of trip")).toBeTruthy();
    expect(container.querySelector('[data-preview-id="map-legend-modes"]')).not.toBeNull();
  });

  it("keeps the unbacked transport-mode keys inside the map-legend-modes Preview", () => {
    const { container } = render(<MapLegend />);
    const region = container.querySelector('[data-preview-id="map-legend-modes"]');
    expect(region).not.toBeNull();
    expect(region!.textContent).toContain("On foot");
    expect(region!.textContent).toContain("By train or taxi");
  });
});
