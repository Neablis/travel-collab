import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { API_SCOPES, SCOPE_CATALOGUE } from "@tc/contracts";
import { DevelopersScreen, type McpToolRow } from "./DevelopersScreen";

// Rows as `mcpToolScopes()` returns them (its own test pins the join); the
// second is one no page edit knows about.
const TOOLS: readonly McpToolRow[] = [
  { name: "fixture_read", description: "Does fixture_read.", scope: "trips:read" },
  { name: "fixture_brand_new", description: "Does fixture_brand_new.", scope: "library:write" },
];

afterEach(() => {
  cleanup();
  window.location.hash = "";
});

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

  // Mitchell's walk (2026-11-21): the MCP section stands alone as the generic
  // way, then one tab list holds every specific tool, Poppy and the script too.
  it("puts the MCP section before one tab list that holds Muse and the script", () => {
    render(<DevelopersScreen tools={TOOLS} />);
    const mcp = screen.getByRole("region", { name: "Connect an MCP client" });
    const tablist = screen.getByRole("tablist", { name: "Pick your tool" });
    expect(Boolean(mcp.compareDocumentPosition(tablist) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    for (const name of ["Muse", "Script"]) expect(within(tablist).getByRole("tab", { name })).toBeDefined();
  });

  it("has a tab per tool, Claude selected by default, each tab owning its panel", () => {
    render(<DevelopersScreen tools={TOOLS} />);
    const tabs = within(screen.getByRole("tablist", { name: "Pick your tool" })).getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Claude", "Gemini CLI", "Muse", "Script"]);
    expect(tabs.map((t) => t.getAttribute("aria-selected"))).toEqual(["true", "false", "false", "false"]);
    expect(tabs.map((t) => t.getAttribute("tabindex"))).toEqual(["0", "-1", "-1", "-1"]);
    const panel = screen.getByRole("tabpanel", { name: "Claude" });
    expect(within(panel).getByRole("region", { name: "Connect Claude" })).toBeDefined();
    // Only the selected tab points at its panel; the others' panels are
    // hidden by a class jsdom does not style, so they cannot be told by role.
    expect(tabs.map((t) => t.getAttribute("aria-controls"))).toEqual(["connect-panel-claude", null, null, null]);
  });

  it("moves between clients with the arrow keys and on click", () => {
    render(<DevelopersScreen tools={TOOLS} />);
    const list = screen.getByRole("tablist", { name: "Pick your tool" });
    fireEvent.keyDown(list, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Gemini CLI" }).getAttribute("aria-selected")).toBe("true");
    expect(within(screen.getByRole("tabpanel", { name: "Gemini CLI" })).getByRole("region", { name: "Connect the Gemini CLI" })).toBeDefined();
    fireEvent.click(screen.getByRole("tab", { name: "Muse" }));
    expect(screen.getByRole("tabpanel", { name: "Muse" })).toBeDefined();
  });

  it.each([
    ["connect-gemini", "Gemini CLI"],
    ["connect-poppy", "Muse"],
    ["connect-script", "Script"],
  ])("opens the tab the hash #%s names", (hash, tab) => {
    window.location.hash = `#${hash}`;
    render(<DevelopersScreen tools={TOOLS} />);
    expect(screen.getByRole("tab", { name: tab }).getAttribute("aria-selected")).toBe("true");
  });

  // A link to the hash already in the URL fires no `hashchange`, so after
  // switching tabs by hand, following it again must still open its tab.
  it("opens a tab again when a link to the hash already in the URL is clicked", () => {
    window.location.hash = "#connect-gemini";
    render(<DevelopersScreen tools={TOOLS} />);
    fireEvent.click(screen.getByRole("tab", { name: "Muse" }));
    expect(screen.getByRole("tab", { name: "Muse" }).getAttribute("aria-selected")).toBe("true");
    const link = document.body.appendChild(document.createElement("a"));
    link.href = "#connect-gemini";
    fireEvent.click(link);
    link.remove();
    expect(screen.getByRole("tab", { name: "Gemini CLI" }).getAttribute("aria-selected")).toBe("true");
  });

  // With JavaScript off the tab buttons do nothing, so every client's steps
  // must be in the HTML the server sends. The other two panels are hidden
  // there (no flash for a JS visitor) and a noscript rule shows them again.
  it("sends every client's steps in the server HTML, the non-default ones hidden and un-hidden by noscript", () => {
    const html = renderToString(<DevelopersScreen tools={TOOLS} />);
    for (const id of ["connect-claude", "connect-gemini", "connect-poppy", "connect-script"]) expect(html).toContain(`id="${id}"`);
    expect(html).toContain("/mcp auth caesura");
    expect(html).toContain("trips:read");
    expect(html.match(/<div[^>]*role="tabpanel"[^>]*>/g)?.map((tag) => /class="[^"]*\bhidden\b/.test(tag))).toEqual([
      false,
      true,
      true,
      true,
    ]);
    expect(html).toMatch(/<noscript><style>[^<]*\{display:block!important\}<\/style><\/noscript>/);
  });

  // M63 D15 (Mitchell, 2026-11-22): ChatGPT's custom connectors need a Business
  // plan, so it could not be proven and was cut. The server HTML holds every
  // panel, hidden ones included, so a leftover tab, step or href shows here.
  it("names no ChatGPT anywhere, in text or in a link", () => {
    const html = renderToString(<DevelopersScreen tools={TOOLS} />);
    expect(html).toContain("connect-claude");
    expect(html).not.toMatch(/chatgpt/i);
  });

  it("connects the Gemini CLI over MCP, by its settings.json httpUrl", () => {
    render(<DevelopersScreen tools={TOOLS} />);
    const section = screen.getByRole("region", { name: "Connect the Gemini CLI", hidden: true });
    expect(section.getAttribute("id")).toBe("connect-gemini");
    expect(section.textContent).toContain("~/.gemini/settings.json");
    expect(section.textContent).toContain(`"httpUrl": "https://caesura.today/api/mcp"`);
    expect(section.textContent).toContain("/mcp auth caesura");
    expect(section.textContent).toContain("Premium plan");
  });

  // Mitchell, 2026-11-22: the Poppy tab names the agent people know, Meta's
  // Muse, while its anchor stays `connect-poppy` so links already out still land.
  it("names Meta's Muse on the Poppy tab, under the anchor it always had", () => {
    render(<DevelopersScreen tools={TOOLS} />);
    expect(within(screen.getByRole("tablist", { name: "Pick your tool" })).getByRole("tab", { name: "Muse" })).toBeDefined();
    const section = screen.getByRole("region", { name: "Connect Meta’s Muse", hidden: true });
    expect(section.getAttribute("id")).toBe("connect-poppy");
    expect(section.textContent).toContain("any agent that speaks the Poppy protocol");
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
    ["connect-gemini", "Connect the Gemini CLI"],
    ["connect-poppy", "Connect Meta’s Muse"],
    ["connect-script", "Connect a script"],
  ])("has #%s (%s) with three steps or fewer", (id, name) => {
    render(<DevelopersScreen tools={TOOLS} />);
    const section = screen.getByRole("region", { name, hidden: true });
    expect(section.getAttribute("id")).toBe(id);
    const steps = within(section).getAllByRole("listitem", { hidden: true });
    expect(steps.length).toBeGreaterThanOrEqual(1);
    expect(steps.length).toBeLessThanOrEqual(3);
  });

  // A step sits under its section's heading, not beside it.
  it("puts each connect step's heading one level below its section's", () => {
    render(<DevelopersScreen tools={TOOLS} />);
    const section = within(screen.getByRole("region", { name: "Connect the Gemini CLI", hidden: true }));
    expect(section.getAllByRole("heading", { level: 3, hidden: true })).toHaveLength(1);
    expect(section.getAllByRole("heading", { level: 4, hidden: true })).toHaveLength(3);
  });

  it("points the script and Muse sections at their real endpoints", () => {
    render(<DevelopersScreen tools={TOOLS} />);
    expect(within(screen.getByRole("region", { name: "Connect Meta’s Muse" })).getByText("/.well-known/poppy.json")).toBeDefined();
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
