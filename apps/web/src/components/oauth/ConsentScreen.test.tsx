import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { API_SCOPES } from "@tc/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
const checkWithCode = vi.fn<(kind: "otp" | "recovery", code: string) => Promise<"passed" | "refused">>();
vi.mock("@/lib/mfaClient", () => ({
  checkWithCode: (kind: "otp" | "recovery", code: string) => checkWithCode(kind, code),
  checkWithPasskey: async () => "refused",
}));
vi.mock("next-auth/react", () => ({ signIn: vi.fn() }));

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

/**
 * A probe `Image` whose fate is decided when its `src` is set, as a browser
 * decides it on fetch: a CSP refusal or an extension block fires `onerror`,
 * a fetchable logo fires `onload`. jsdom's own `Image` never fires either,
 * so a test that needs the probe to settle uses this.
 */
function stubImage(outcome: "load" | "error") {
  class ProbeImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    srcValue = "";
    set src(value: string) {
      this.srcValue = value;
      if (outcome === "load") this.onload?.();
      else this.onerror?.();
    }
    get src() {
      return this.srcValue;
    }
  }
  vi.stubGlobal("Image", ProbeImage);
}

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

  // Poppy 4.1: a Personal Agent is named by its own document, and its domain is
  // the part of that name that is proven (it holds the keys the document lists).
  it("names a Personal Agent with its domain and logo, and still marks the name unverified", () => {
    stubImage("load");
    render(<ConsentScreen {...props({ clientName: "Muse", cimdHost: "meta.ai", personalAgent: { logoUri: "https://meta.ai/logo.png" } })} />);
    expect(screen.getByRole("heading", { level: 1, name: "Muse (meta.ai) wants to act for you on Caesura" })).toBeTruthy();
    expect(screen.getByRole("presentation").getAttribute("src")).toBe("https://meta.ai/logo.png");
    expect(screen.getByText("Unverified")).toBeTruthy();
  });

  // A logo the CSP refuses (or an extension blocks) never reaches the page:
  // the consent card shows no broken image, only the name.
  it("leaves out a Personal Agent logo that does not load", () => {
    stubImage("error");
    render(<ConsentScreen {...props({ clientName: "Muse", cimdHost: "meta.ai", personalAgent: { logoUri: "https://meta.ai/logo.png" } })} />);
    expect(screen.getByRole("heading", { level: 1, name: "Muse (meta.ai) wants to act for you on Caesura" })).toBeTruthy();
    expect(screen.queryByRole("presentation")).toBeNull();
  });

  // Consent for a different agent reuses the component (same route, new
  // props), so a logo that failed for one agent must not hide the next one's.
  it("shows a later logo after an earlier one failed to render", () => {
    stubImage("load");
    const { rerender } = render(
      <ConsentScreen {...props({ clientName: "Muse", cimdHost: "meta.ai", personalAgent: { logoUri: "https://meta.ai/logo.png" } })} />,
    );
    const first = screen.getByRole("presentation");
    expect(first.getAttribute("src")).toBe("https://meta.ai/logo.png");
    // The rendered fetch fails after the probe loaded: the logo is left out.
    fireEvent.error(first);
    expect(screen.queryByRole("presentation")).toBeNull();
    rerender(
      <ConsentScreen {...props({ clientName: "Other", cimdHost: "other.example", personalAgent: { logoUri: "https://other.example/logo.png" } })} />,
    );
    expect(screen.getByRole("presentation").getAttribute("src")).toBe("https://other.example/logo.png");
  });

  it("shows no logo for an app that is not a Personal Agent, however its document asks", () => {
    render(<ConsentScreen {...props({ cimdHost: "app.example" })} />);
    expect(screen.queryByRole("img")).toBeNull();
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
    expect(ticks("Read").length).toBe(6);
    expect(ticks("Write").length).toBe(5);
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

  // M62 D8: with two-step sign-in on, Allow is refused without a recent second factor.
  it("opens the fresh check when Allow is refused with a 403, then allows once it passes", async () => {
    const decisions: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        if (String(url) === "/api/account/mfa/factors") {
          return Response.json({ enabled: true, factors: [], recoveryCodesLeft: 9 });
        }
        decisions.push((JSON.parse(String(init?.body)) as { decision: string }).decision);
        return decisions.length === 1
          ? Response.json({ error: "fresh-check-required" }, { status: 403 })
          : Response.json({ redirectTo: "https://evil.example/cb?code=tcc_x" });
      }),
    );
    checkWithCode.mockResolvedValue("passed");
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    render(<ConsentScreen {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));

    await userEvent.type(await screen.findByLabelText("Authenticator code"), "123456");
    await userEvent.click(screen.getByRole("button", { name: "Verify" }));

    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith("https://evil.example/cb?code=tcc_x"));
    expect(decisions).toEqual(["allow", "allow"]);
  });
});
