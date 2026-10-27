import { fireEvent, render, screen } from "@testing-library/react";
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

  it("leaves notebook writes unticked until the person opts in", () => {
    render(<ConsentScreen {...props()} />);
    expect((screen.getByRole("checkbox", { name: /Read trips/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: /Write the Notebook/ }) as HTMLInputElement).checked).toBe(false);
  });

  it("disables Allow for a free account, and offers the plans", () => {
    render(<ConsentScreen {...props({ entitled: false })} />);
    expect((screen.getByRole("button", { name: "Allow" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("link", { name: "See plans" }).getAttribute("href")).toBe("/plans");
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
    });
  });
});
