import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MapLegend } from "./MapLegend";

afterEach(cleanup);

// Every key here is behaviour the map has. A Preview renders `role="group"`
// and reads as "coming later", pointer-dead — the two route keys sat in one
// until M24 gave a transit stop a mode, and a key put back inside one would be
// the legend un-claiming something the map now draws.
describe("MapLegend", () => {
  it("names both route styles and the other days, with nothing behind a Preview", () => {
    render(<MapLegend />);
    expect(screen.getByText("On foot or by bike")).toBeTruthy();
    expect(screen.getByText("By vehicle")).toBeTruthy();
    expect(screen.getByText("Rest of trip")).toBeTruthy();
    expect(screen.queryByRole("group")).toBeNull();
  });

  // The map draws city-level stops as a disc rather than a teardrop, and
  // nothing else on screen says why one marker is a different shape.
  it("explains the city disc", () => {
    render(<MapLegend />);
    expect(screen.getByText("Somewhere in this city")).toBeTruthy();
  });
});
