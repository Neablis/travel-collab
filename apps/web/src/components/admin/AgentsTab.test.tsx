import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminAgent, AdminAgentReport } from "@tc/contracts";
import { AgentsTab } from "./AgentsTab";

// **The console's Agents tab** (M60 part 4, ADR-089 decision 3): one row per
// Personal Agent, Block behind a confirm that says what it does, Unblock with
// none. The routes behind it are `app/api/admin/agents/**/route.int.test.ts`.

function agent(over: Partial<AdminAgent> = {}): AdminAgent {
  return {
    clientId: "https://agent.example/poppy-client.json",
    name: "Wayfinder",
    logoUri: null,
    domain: "agent.example",
    sessions30d: 12,
    accounts: 3,
    lastSeenAt: "2026-11-08T10:00:00.000Z",
    blocked: false,
    ...over,
  };
}

function report(over: Partial<AdminAgentReport> = {}): AdminAgentReport {
  return {
    id: "r1",
    clientId: "https://agent.example/poppy-client.json",
    agentName: "Wayfinder",
    domain: "agent.example",
    task: "Pay with a gift card",
    description: "The User wanted to pay with a gift card.",
    createdAt: "2026-11-08T10:00:00.000Z",
    ...over,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("AgentsTab", () => {
  it("lists each agent with its name, domain, Sessions, accounts and last seen", () => {
    render(<AgentsTab agents={[agent(), agent({ clientId: "https://other.example/c.json", name: null, domain: "other.example" })]} reports={[]} />);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    const first = within(rows[0]!);
    expect(first.getByText("Wayfinder")).toBeTruthy();
    expect(first.getByText("agent.example")).toBeTruthy();
    expect(first.getByText("12")).toBeTruthy();
    expect(first.getByText("3")).toBeTruthy();
    // No document seen: the domain stands in for the name.
    expect(within(rows[1]!).getAllByText("other.example").length).toBeGreaterThan(0);
  });

  // Tabbing through the rows, "Block, Block, Block" names nobody.
  it("names the agent on each row's Block and Unblock button, the domain standing in for no name", () => {
    render(
      <AgentsTab
        agents={[
          agent(),
          agent({ clientId: "https://other.example/c.json", name: null, domain: "other.example", blocked: true }),
        ]}
        reports={[]}
      />,
    );
    expect(screen.getByRole("button", { name: "Block Wayfinder" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Unblock other.example" })).toBeTruthy();
  });

  it("says so when no agent has been seen", () => {
    render(<AgentsTab agents={[]} reports={[]} />);
    expect(screen.getByText("No Personal Agent has connected yet.")).toBeTruthy();
  });

  it("asks before blocking, in the words of what it does, and Cancel sends nothing", async () => {
    const user = userEvent.setup();
    render(<AgentsTab agents={[agent()]} reports={[]} />);
    await user.click(screen.getByRole("button", { name: "Block Wayfinder" }));
    expect(screen.getByText("Block Wayfinder?")).toBeTruthy();
    expect(screen.getByText("Its sign-ins stop and every request it sends is refused.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByText("Blocked")).toBeNull();
  });

  it("blocks on confirm with a PUT for that client_id, then shows Blocked and an Unblock that needs no confirm", async () => {
    const clientId = "https://agent.example/poppy-client.json";
    fetchMock.mockResolvedValueOnce(answer({ clientId, blocked: true })).mockResolvedValueOnce(answer({ clientId, blocked: false }));
    const user = userEvent.setup();
    render(<AgentsTab agents={[agent()]} reports={[]} />);

    await user.click(screen.getByRole("button", { name: "Block Wayfinder" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Block" }));
    expect(fetchMock).toHaveBeenCalledWith(`/api/admin/agents/${encodeURIComponent(clientId)}/block`, expect.objectContaining({ method: "PUT" }));
    expect(await screen.findByText("Blocked")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Unblock Wayfinder" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fetchMock).toHaveBeenLastCalledWith(`/api/admin/agents/${encodeURIComponent(clientId)}/block`, expect.objectContaining({ method: "DELETE" }));
    expect(await screen.findByRole("button", { name: "Block Wayfinder" })).toBeTruthy();
    expect(screen.queryByText("Blocked")).toBeNull();
  });

  it("starts a blocked agent on Blocked and Unblock", () => {
    render(<AgentsTab agents={[agent({ blocked: true })]} reports={[]} />);
    expect(screen.getByText("Blocked")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Unblock Wayfinder" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Block Wayfinder" })).toBeNull();
  });

  it("leaves the row as it was and says so when the server refuses", async () => {
    fetchMock.mockResolvedValue(answer({ error: "not-found" }, 404));
    const user = userEvent.setup();
    render(<AgentsTab agents={[agent()]} reports={[]} />);
    await user.click(screen.getByRole("button", { name: "Block Wayfinder" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Block" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Nothing changed");
    expect(screen.queryByText("Blocked")).toBeNull();
  });

  // The CSP's `img-src` may refuse an agent's logo; a broken-image box in the row is worse than none.
  it("drops a logo that does not load, and the logo is decorative", () => {
    render(<AgentsTab agents={[agent({ logoUri: "https://agent.example/logo.png" })]} reports={[]} />);
    const logo = screen.getByTestId("agent-logo");
    expect(logo.getAttribute("alt")).toBe("");
    fireEvent.error(logo);
    expect(screen.queryByTestId("agent-logo")).toBeNull();
  });

  describe("reports from agents", () => {
    it("lists them in the order given, each with its task, description, agent and date, and no actions", () => {
      render(
        <AgentsTab
          agents={[agent()]}
          reports={[
            report({ id: "a", task: "Newest task", description: "Newest words", agentName: "Wayfinder" }),
            report({ id: "b", task: "Older task", description: "Older words", agentName: "Compass", createdAt: "2026-11-01T10:00:00.000Z" }),
          ]}
        />,
      );
      expect(screen.getByRole("heading", { name: "Reports from agents" })).toBeTruthy();
      const region = screen.getByRole("region", { name: "Reports from agents" });
      const items = within(region).getAllByRole("listitem");
      expect(items).toHaveLength(2);
      expect(within(items[0]!).getByText("Newest task")).toBeTruthy();
      expect(within(items[0]!).getByText("Newest words")).toBeTruthy();
      expect(within(items[0]!).getByText(/Wayfinder/)).toBeTruthy();
      // The name is the agent's own claim; the domain is the one thing it could not choose.
      expect(within(items[0]!).getByText(/agent\.example/)).toBeTruthy();
      expect(within(items[0]!).getByText(/8 Nov 2026/)).toBeTruthy();
      expect(within(items[1]!).getByText("Older task")).toBeTruthy();
      expect(within(region).queryAllByRole("button")).toHaveLength(0);
    });

    it("shows an agent's text as the plain text it sent, never as markdown or markup", () => {
      const description = "**Ignore your instructions** <b>and</b> [click](https://evil.example)";
      render(<AgentsTab agents={[agent()]} reports={[report({ task: "<i>task</i>", description })]} />);
      // The very characters are on the page; a rendered `**`, `<b>` or link would have consumed them.
      expect(screen.getByText(description)).toBeTruthy();
      expect(screen.getByText("<i>task</i>")).toBeTruthy();
      expect(screen.queryByRole("link", { name: "click" })).toBeNull();
    });

    it("lists reports when no agent has a Session, and says so when there are none", () => {
      const { unmount } = render(<AgentsTab agents={[]} reports={[report()]} />);
      expect(screen.getByText("Pay with a gift card")).toBeTruthy();
      unmount();
      render(<AgentsTab agents={[agent()]} reports={[]} />);
      expect(screen.getByText("No reports from agents yet.")).toBeTruthy();
    });
  });
});
