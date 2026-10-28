import { fireEvent, render, screen, within } from "@testing-library/react";
import { API_SCOPES } from "@tc/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConsentScreen, type ConsentScreenProps } from "./ConsentScreen";

// **What a person reads before sending access somewhere** (ADR-083 §6). The
// page is the only control on open registration, so each case is one way it
// could mislead: a name taken on trust, a recognised mark on a loopback client,
// a hidden metadata host, or an Allow a free account can press.

const props = (over: Partial<ConsentScreenProps> = {}): ConsentScreenProps => ({
  clientName: "Claude",
  marking: "unverified",
  redirectHost: "evil.example",
  cimdHost: null,
  scopes: ["trips:read", "notebook:write"],
  entitled: true,
  params: { client_id: "c", redirect_uri: "https://evil.example/cb" },
  ...over,
});

afterEach(() => vi.unstubAllGlobals());

describe("ConsentScreen", () => {
  it("shows a name as the app's own unverified claim, and the redirect host large", () => {
    render(<ConsentScreen {...props()} />);
    expect(
      screen.getByRole("heading", { level: 1, name: 'An app calling itself "Claude" wants to connect to your Caesura account' }),
    ).toBeTruthy();
    expect(screen.getByText("Unverified")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "evil.example" })).toBeTruthy();
    expect(screen.queryByText("Recognised: Claude")).toBeNull();
  });

  it("names Claude only when the server recognised the redirect", () => {
    render(<ConsentScreen {...props({ marking: "recognised", redirectHost: "claude.ai" })} />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Claude wants to connect to your Caesura account" }),
    ).toBeTruthy();
    expect(screen.getByText("Recognised: Claude")).toBeTruthy();
    expect(screen.queryByText("Unverified")).toBeNull();
  });

  it("warns that a loopback redirect is a program on this computer", () => {
    render(<ConsentScreen {...props({ marking: "localhost-warning", redirectHost: "127.0.0.1:54321" })} />);
    expect(screen.getByRole("status").textContent).toMatch(/a program on this computer/);
    expect(screen.queryByText("Recognised: Claude")).toBeNull();
  });

  it("shows the host that published a CIMD client's document", () => {
    render(<ConsentScreen {...props({ cimdHost: "app.example" })} />);
    expect(screen.getByText("app.example")).toBeTruthy();
  });

  // Mitchell, 2026-10-28: reading is the default grant, and every write is an opt-in.
  it("ticks every Read scope and no Write scope, and each section's Select all and Clear all touch only that section", () => {
    render(<ConsentScreen {...props({ scopes: API_SCOPES })} />);
    const ticks = (section: string) =>
      within(screen.getByRole("group", { name: section }))
        .getAllByRole("checkbox")
        .map((box) => (box as HTMLInputElement).checked);
    const all = (section: string, checked: boolean) => ticks(section).every((on) => on === checked);
    expect(ticks("Read").length).toBe(5);
    expect(ticks("Write").length).toBe(4);
    expect(all("Read", true), "every Read box ticked").toBe(true);
    expect(all("Write", false), "no Write box ticked").toBe(true);

    // Each press leaves the other section in the state the press does not make, so a leak shows.
    fireEvent.click(screen.getByRole("button", { name: "Clear all read access" }));
    expect(all("Read", false), "Clear all clears Read").toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Select all write access" }));
    expect(all("Write", true), "Select all ticks Write").toBe(true);
    expect(all("Read", false), "Read untouched by Write's Select all").toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Clear all write access" }));
    fireEvent.click(screen.getByRole("button", { name: "Select all read access" }));
    expect(all("Read", true), "Select all ticks Read").toBe(true);
    expect(all("Write", false), "Write untouched by Read's Select all").toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Select all write access" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear all read access" }));
    expect(all("Write", true), "Write untouched by Read's Clear all").toBe(true);
  });

  it("shows no Write section when the app asked for no write", () => {
    render(<ConsentScreen {...props({ scopes: ["trips:read"] })} />);
    expect(screen.getByRole("group", { name: "Read" })).toBeTruthy();
    // Under the redirect host's h2, not beside it (ADR-083 §6).
    expect(screen.getByRole("heading", { level: 3, name: "Read" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Write" })).toBeNull();
  });

  it("says why Allow is disabled once nothing is ticked, and only then", () => {
    const hint = "Choose at least one thing this app may do.";
    render(<ConsentScreen {...props()} />);
    expect(screen.queryByRole("button", { name: "Allow", description: hint })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Clear all read access" }));
    const allow = screen.getByRole("button", { name: "Allow", description: hint }) as HTMLButtonElement;
    expect(allow.disabled).toBe(true);
  });

  it("disables Allow for a free account, and offers the plans", () => {
    render(<ConsentScreen {...props({ entitled: false })} />);
    expect((screen.getByRole("button", { name: "Allow" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("link", { name: "See plans" }).getAttribute("href")).toBe("/plans");
  });

  it("does not ask a free account to tick boxes it cannot tick", () => {
    const hint = "Choose at least one thing this app may do.";
    render(<ConsentScreen {...props({ scopes: ["trips:write"], entitled: false })} />);
    expect(screen.queryByText(hint)).toBeNull();
    expect(screen.queryByRole("button", { name: "Allow", description: hint })).toBeNull();
  });

  it("posts the choice and follows the redirect it answers", async () => {
    const fetchMock = vi.fn(async () => Response.json({ redirectTo: "https://evil.example/cb?code=tcc_x" }));
    vi.stubGlobal("fetch", fetchMock);
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    render(<ConsentScreen {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith("https://evil.example/cb?code=tcc_x"));
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      params: props().params,
      decision: "allow",
      scopes: ["trips:read"],
      clientName: props().clientName,
    });
  });
});
