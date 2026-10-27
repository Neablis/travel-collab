import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConnectedApp } from "@tc/contracts";
import { ConnectedAppsSection } from "./ConnectedAppsSection";

// What a person reads and does on Account → Connected apps (M55 D10): which
// apps act as them, where each one's codes go, and Disconnect, confirmed.

const DAY = 24 * 60 * 60 * 1000;

function app(over: Partial<ConnectedApp> = {}): ConnectedApp {
  return {
    grantId: "3f1a5b6c-7d8e-4f90-a1b2-c3d4e5f60720",
    clientName: "Test app",
    redirectHost: "example.com",
    recognised: false,
    scopes: ["trips:read"],
    createdAt: new Date(Date.now() - 3 * DAY).toISOString(),
    lastUsedAt: null,
    expiresAt: new Date(Date.now() + 300 * DAY).toISOString(),
    revokedAt: null,
    revokedReason: null,
    ...over,
  };
}

/** Serve the list, and record every non-GET call. */
function serve(apps: ConnectedApp[], disconnectStatus = 204) {
  const calls: { url: string; method: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method !== "GET") {
        calls.push({ url: String(url), method });
        return new Response(null, { status: disconnectStatus });
      }
      return new Response(JSON.stringify({ apps }), { status: 200 });
    }),
  );
  return calls;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ConnectedAppsSection", () => {
  it("lists each app with where its codes go and what it may do", async () => {
    serve([app(), app({ grantId: "3f1a5b6c-7d8e-4f90-a1b2-c3d4e5f60721", clientName: "Claude", redirectHost: "claude.ai", recognised: true })]);
    render(<ConnectedAppsSection />);
    const row = await screen.findByRole("row", { name: /Test app/ });
    expect(row.textContent).toContain("example.com");
    expect(row.textContent).toContain("Read trips");
    // Registration is open, so a name is only the client's own claim, unless
    // the redirect is Claude's own callback.
    expect(row.textContent).toContain("name not verified");
    const claude = screen.getByRole("row", { name: /Claude/ });
    expect(claude.textContent).not.toContain("name not verified");
  });

  it("says so when nothing is connected", async () => {
    serve([]);
    render(<ConnectedAppsSection />);
    expect(await screen.findByText("No apps are connected.")).toBeTruthy();
  });

  it("disconnects only after a confirm, and the row then reads Disconnected", async () => {
    const calls = serve([app()]);
    render(<ConnectedAppsSection />);
    await userEvent.click(await screen.findByRole("button", { name: "Disconnect" }));
    expect(calls).toEqual([]);

    const dialog = await screen.findByRole("dialog", { name: "Disconnect Test app?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Disconnect" }));

    expect(await screen.findByText("Disconnected")).toBeTruthy();
    expect(calls).toEqual([{ url: "/api/account/connected-apps/3f1a5b6c-7d8e-4f90-a1b2-c3d4e5f60720", method: "DELETE" }]);
    expect(screen.queryByRole("button", { name: "Disconnect" })).toBeNull();
  });

  // The Disconnect that opened the confirm is gone once it succeeds, so the
  // dialog has nowhere to hand focus back; left alone it drops to <body>.
  // `:focus` asked of the element a query found, as SnapshotList.test does.
  it("hands focus to the row's new status once disconnected", async () => {
    serve([app()]);
    render(<ConnectedAppsSection />);
    await userEvent.click(await screen.findByRole("button", { name: "Disconnect" }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Disconnect" }));
    const status = await screen.findByText("Disconnected. It stopped working immediately.");
    await vi.waitFor(() => expect(status.matches(":focus")).toBe(true));
  });

  it("leaves the app connected when the confirm is cancelled", async () => {
    const calls = serve([app()]);
    render(<ConnectedAppsSection />);
    await userEvent.click(await screen.findByRole("button", { name: "Disconnect" }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(calls).toEqual([]);
    expect(screen.getByText("Connected")).toBeTruthy();
  });

  it("says when a disconnect failed, and keeps the row live", async () => {
    serve([app()], 500);
    render(<ConnectedAppsSection />);
    await userEvent.click(await screen.findByRole("button", { name: "Disconnect" }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Disconnect" }));
    expect(await screen.findByText("That app could not be disconnected. Try again.")).toBeTruthy();
    expect(screen.getByText("Connected")).toBeTruthy();
  });

  // The server cut it off, not the person: they need to know why, and that
  // connecting again is the way back.
  it("tells a grant the server cut off from one its owner disconnected", async () => {
    serve([app({ revokedAt: new Date().toISOString(), revokedReason: "refresh-reuse" })]);
    render(<ConnectedAppsSection />);
    expect(await screen.findByText(/one of its keys was used twice/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Disconnect" })).toBeNull();
  });
});
