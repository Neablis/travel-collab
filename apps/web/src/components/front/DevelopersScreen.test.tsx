import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { API_SCOPES, SCOPE_CATALOGUE } from "@tc/contracts";
import { DevelopersScreen, type McpToolRow } from "./DevelopersScreen";

// Rows as `mcpToolScopes()` returns them (its own test pins the join); the
// second is one no page edit knows about.
const TOOLS: readonly McpToolRow[] = [
  { name: "fixture_read", description: "Does fixture_read.", scope: "trips:read" },
  { name: "fixture_brand_new", description: "Does fixture_brand_new.", scope: "library:write" },
];

afterEach(cleanup);

describe("DevelopersScreen", () => {
  // The page renders `SCOPE_CATALOGUE` rather than a copy of it, so a scope
  // added to the contract appears here without anyone remembering this page.
  // A hand-written table is the regression this catches.
  it("lists every scope the API has, each with its catalogue sentence", () => {
    render(<DevelopersScreen tools={TOOLS} />);
    const table = within(screen.getByRole("region", { name: "Scopes" })).getByRole("table");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(API_SCOPES.length);
    for (const scope of API_SCOPES) {
      const row = within(table).getByRole("row", { name: new RegExp(`^${scope} `) });
      expect(within(row).getByText(SCOPE_CATALOGUE[scope].description)).toBeDefined();
    }
  });

  it("names the path to a token in the app's own words", () => {
    render(<DevelopersScreen tools={TOOLS} />);
    expect(screen.getByText("Account → Security → API tokens → New token.")).toBeDefined();
    expect(screen.getByRole("heading", { name: "Create your account" })).toBeDefined();
    expect(screen.getByRole("link", { name: "Create an account" }).getAttribute("href")).toBe("/signup");
  });

  // M50: the steps are read by a person setting up an agent, often pasted
  // into one, and a sentence spliced with an em dash reads as two half-thoughts.
  it("writes the getting-started steps without em dashes", () => {
    render(<DevelopersScreen tools={TOOLS} />);
    expect(screen.getByRole("region", { name: "From nothing to a first call" }).textContent).not.toContain("—");
  });

  // `public-api/route.ts` adds `details` only to an error that has some.
  it("shows the error envelope with details on some errors only", () => {
    render(<DevelopersScreen tools={TOOLS} />);
    const steps = screen.getByRole("region", { name: "From nothing to a first call" }).textContent ?? "";
    expect(steps).toContain('{ "error": { "code", "message" } }, with details on some errors');
  });

  // ConsentScreen ticks every read scope and no write scope, Notebook's included.
  it("says reading starts ticked and anything that changes your data, Notebook included, starts unticked", () => {
    render(<DevelopersScreen tools={TOOLS} />);
    const claude = screen.getByRole("region", { name: "Connect Claude" }).textContent ?? "";
    expect(claude).toContain("Reading starts ticked; anything that changes your data, Notebook included, starts unticked");
  });

  it("links the AI page for a reader who came to see what an AI can do", () => {
    render(<DevelopersScreen tools={TOOLS} />);
    expect(screen.getByRole("link", { name: "What your AI can do in Caesura" }).getAttribute("href")).toBe("/ai");
    expect(screen.getByRole("link", { name: "how access is protected" }).getAttribute("href")).toBe("/security");
  });

  it("links the reference, the OpenAPI document, the api-catalog and llms.txt", () => {
    render(<DevelopersScreen tools={TOOLS} />);
    const reference = within(screen.getByRole("region", { name: "The reference" }));
    expect(reference.getByRole("link", { name: "API reference" }).getAttribute("href")).toBe("/developers/reference");
    expect(reference.getByRole("link", { name: "/api/v1/openapi" }).getAttribute("href")).toBe("/api/v1/openapi");
    expect(reference.getByRole("link", { name: "/.well-known/api-catalog" }).getAttribute("href")).toBe(
      "/.well-known/api-catalog",
    );
    expect(reference.getByRole("link", { name: "/llms.txt" }).getAttribute("href")).toBe("/llms.txt");
  });

  // M55: a person adding Caesura to Claude needs the connector URL to paste,
  // that it is Premium, what it will ask for, and where to disconnect it.
  it("names the connector: its URL, the plan, the scopes and where to disconnect", () => {
    render(<DevelopersScreen tools={TOOLS} />);
    const connect = screen.getByRole("region", { name: "Connect Claude" });
    expect(within(connect).getByText("https://caesura.today/api/mcp")).toBeDefined();
    expect(connect.textContent).toContain("Premium plan");
    expect(within(connect).getByRole("link", { name: "the scopes below" }).getAttribute("href")).toBe("#scopes");
    expect(connect.textContent).toContain("Account → Security → Connected apps");
  });

  it("has a way back home", () => {
    render(<DevelopersScreen tools={TOOLS} />);
    const footer = within(screen.getByRole("contentinfo"));
    expect(footer.getByRole("link", { name: /Caesura home/ }).getAttribute("href")).toBe("/");
  });

  // M63: one anchored section per tool, short enough to follow without
  // scrolling. The anchor ids are linked from /ai and /agents.md.
  it.each([
    ["connect-claude", "Connect Claude"],
    ["connect-mcp", "Connect an MCP client"],
    ["connect-chatgpt", "Connect ChatGPT"],
    ["connect-gemini", "Connect Gemini"],
    ["connect-poppy", "Connect Poppy agents"],
    ["connect-script", "Connect a script"],
  ])("has #%s (%s) with three steps or fewer", (id, name) => {
    render(<DevelopersScreen tools={TOOLS} />);
    const section = screen.getByRole("region", { name });
    expect(section.getAttribute("id")).toBe(id);
    const steps = within(section).getAllByRole("listitem");
    expect(steps.length).toBeGreaterThanOrEqual(1);
    expect(steps.length).toBeLessThanOrEqual(3);
  });

  // A step sits under its section's heading, not beside it.
  it("puts each connect step's heading one level below its section's", () => {
    render(<DevelopersScreen tools={TOOLS} />);
    const section = within(screen.getByRole("region", { name: "Connect ChatGPT" }));
    expect(section.getAllByRole("heading", { level: 3 })).toHaveLength(1);
    expect(section.getAllByRole("heading", { level: 4 })).toHaveLength(3);
  });

  it("tells a ChatGPT reader the import needs the document URL, and the token needs Premium", () => {
    render(<DevelopersScreen tools={TOOLS} />);
    const section = within(screen.getByRole("region", { name: "Connect ChatGPT" }));
    expect(section.getByText(/needs the document.s URL/)).toBeDefined();
    expect(section.getByText(/Premium plan/)).toBeDefined();
  });

  it("points the script and Poppy sections at their real endpoints", () => {
    render(<DevelopersScreen tools={TOOLS} />);
    expect(within(screen.getByRole("region", { name: "Connect Poppy agents" })).getByText("/.well-known/poppy.json")).toBeDefined();
    expect(screen.getByRole("region", { name: "Connect a script" }).textContent).toContain("trips:read");
  });

  // The table is generated from `mcpToolScopes()`: a tool the fixture adds
  // shows up with its scope and no edit here. A typed-out table fails this.
  it("lists every MCP tool with its scope, from the list it is given", () => {
    render(<DevelopersScreen tools={TOOLS} />);
    const table = within(screen.getByRole("region", { name: "MCP tools" })).getByRole("table");
    expect(within(table).getAllByRole("row").slice(1)).toHaveLength(TOOLS.length);
    for (const tool of TOOLS) {
      const row = within(table).getByRole("row", { name: new RegExp(`^${tool.name} `) });
      expect(row.textContent).toContain(tool.description);
      expect(row.textContent).toContain(tool.scope);
    }
  });

  // On a phone the tables are restyled with display:block/flex, which Safari
  // and older Chromium answer by dropping the table semantics. An explicit
  // role on every element keeps each cell tied to its column header.
  it("names its table roles outright, so the phone layout cannot drop them", () => {
    render(<DevelopersScreen tools={TOOLS} />);
    for (const name of ["MCP tools", "Scopes"]) {
      const table = within(screen.getByRole("region", { name })).getByRole("table");
      expect(table.getAttribute("role")).toBe("table");
      for (const role of ["rowgroup", "row", "columnheader", "cell"]) {
        for (const el of within(table).getAllByRole(role)) expect(el.getAttribute("role")).toBe(role);
      }
    }
  });
});
