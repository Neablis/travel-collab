import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AppHeader } from "./AppHeader";

afterEach(cleanup);

describe("AppHeader", () => {
  it("links to both routes so every page has a way back", () => {
    render(<AppHeader />);

    expect(screen.getByRole("link", { name: "Trips" }).getAttribute("href")).toBe("/");
    expect(screen.getByRole("link", { name: "Playbooks" }).getAttribute("href")).toBe("/playbooks");
  });

  it("names the product", () => {
    render(<AppHeader />);
    expect(screen.getByText("Trip Planner")).toBeTruthy();
  });

  it("is a banner landmark", () => {
    render(<AppHeader />);
    expect(screen.getByRole("banner")).toBeTruthy();
  });
});
