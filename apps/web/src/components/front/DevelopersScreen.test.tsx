import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { API_SCOPES, SCOPE_CATALOGUE } from "@tc/contracts";
import { DevelopersScreen } from "./DevelopersScreen";

afterEach(cleanup);

describe("DevelopersScreen", () => {
  // The page renders `SCOPE_CATALOGUE` rather than a copy of it, so a scope
  // added to the contract appears here without anyone remembering this page.
  // A hand-written table is the regression this catches.
  it("lists every scope the API has, each with its catalogue sentence", () => {
    render(<DevelopersScreen />);
    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(API_SCOPES.length);
    for (const scope of API_SCOPES) {
      const row = within(table).getByRole("row", { name: new RegExp(`^${scope} `) });
      expect(within(row).getByText(SCOPE_CATALOGUE[scope].description)).toBeDefined();
    }
  });

  it("names the path to a token in the app's own words", () => {
    render(<DevelopersScreen />);
    expect(screen.getByText("Account → Profile → API tokens → New token.")).toBeDefined();
    expect(screen.getByRole("heading", { name: "Get invited" })).toBeDefined();
    expect(screen.getByRole("link", { name: "Create an account" }).getAttribute("href")).toBe("/signup");
  });

  it("links the reference, the OpenAPI document, the api-catalog and llms.txt", () => {
    render(<DevelopersScreen />);
    const reference = within(screen.getByRole("region", { name: "The reference" }));
    expect(reference.getByRole("link", { name: "API reference" }).getAttribute("href")).toBe("/developers/reference");
    expect(reference.getByRole("link", { name: "/api/v1/openapi" }).getAttribute("href")).toBe("/api/v1/openapi");
    expect(reference.getByRole("link", { name: "/.well-known/api-catalog" }).getAttribute("href")).toBe(
      "/.well-known/api-catalog",
    );
    expect(reference.getByRole("link", { name: "/llms.txt" }).getAttribute("href")).toBe("/llms.txt");
  });

  it("has a way back home", () => {
    render(<DevelopersScreen />);
    const footer = within(screen.getByRole("contentinfo"));
    expect(footer.getByRole("link", { name: /Caesura home/ }).getAttribute("href")).toBe("/welcome");
  });
});
