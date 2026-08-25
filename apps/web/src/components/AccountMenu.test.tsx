import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountMenu, AccountMenuFromSession } from "./AccountMenu";

vi.mock("next-auth/react", () => ({
  getSession: vi.fn(),
  signOut: vi.fn(async () => {}),
}));

const resetDemoDataMock = vi.fn();
vi.mock("@/lib/apiClient", () => ({
  resetDemoData: (...args: unknown[]) => resetDemoDataMock(...args),
}));

afterEach(cleanup);

describe("AccountMenu", () => {
  it("shows the signed-in identity behind the avatar", async () => {
    render(<AccountMenu name="Sam K" email="sam@example.com" />);
    await userEvent.click(screen.getByRole("button", { name: "Account menu" }));
    expect(screen.getByText("sam@example.com")).toBeTruthy();
  });

  it("signs out", async () => {
    const onSignOut = vi.fn();
    render(<AccountMenu name="Sam K" email="sam@example.com" onSignOut={onSignOut} />);
    await userEvent.click(screen.getByRole("button", { name: "Account menu" }));
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(onSignOut).toHaveBeenCalled();
  });

  // Task 8b.2 deliberately omitted a third dropdown item ("Your account")
  // rather than ship one that does nothing — this is the exception, and only
  // real outside preview (see AppHeader.tsx / demoDataReset.ts), so its
  // absence when the prop is false must be exact: no disabled item, no trace.
  it("hides the reset item when demoResetEnabled is false", async () => {
    render(<AccountMenu name="Sam K" email="sam@example.com" />);
    await userEvent.click(screen.getByRole("button", { name: "Account menu" }));
    expect(screen.queryByRole("button", { name: "Reset to demo data" })).toBeNull();
  });

  it("requires confirmation before calling onResetDemoData", async () => {
    const onResetDemoData = vi.fn().mockResolvedValue(undefined);
    render(<AccountMenu name="Sam K" email="sam@example.com" demoResetEnabled onResetDemoData={onResetDemoData} />);
    await userEvent.click(screen.getByRole("button", { name: "Account menu" }));
    await userEvent.click(screen.getByRole("button", { name: "Reset to demo data" }));
    expect(onResetDemoData).not.toHaveBeenCalled();

    expect(screen.getByRole("heading", { name: "Reset to demo data" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Reset" }));
    await waitFor(() => expect(onResetDemoData).toHaveBeenCalled());
  });

  it("cancels the reset confirmation without calling onResetDemoData", async () => {
    const onResetDemoData = vi.fn();
    render(<AccountMenu name="Sam K" email="sam@example.com" demoResetEnabled onResetDemoData={onResetDemoData} />);
    await userEvent.click(screen.getByRole("button", { name: "Account menu" }));
    await userEvent.click(screen.getByRole("button", { name: "Reset to demo data" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onResetDemoData).not.toHaveBeenCalled();
  });

  // Mitchell's report, verbatim: "Im really suprised how long the reset
  // took, and there was no ui indicator that it was still seeding which made
  // it dangerous to run." Two greyed-out buttons with unchanged copy reads
  // as broken, not busy — the label and a live region both have to say so.
  it("shows a busy label and announces reset progress while the request is in flight", async () => {
    let resolveReset!: () => void;
    const onResetDemoData = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveReset = resolve;
        }),
    );
    render(<AccountMenu name="Sam K" email="sam@example.com" demoResetEnabled onResetDemoData={onResetDemoData} />);
    await userEvent.click(screen.getByRole("button", { name: "Account menu" }));
    await userEvent.click(screen.getByRole("button", { name: "Reset to demo data" }));
    await userEvent.click(screen.getByRole("button", { name: "Reset" }));

    expect(await screen.findByRole("button", { name: "Resetting…" })).toBeTruthy();
    const status = screen.getByRole("status");
    expect(status.textContent).toMatch(/few seconds/i);

    resolveReset();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Resetting…" })).toBeNull());
  });

  it("keeps the dialog open when Escape is pressed mid-reset", async () => {
    let resolveReset!: () => void;
    const onResetDemoData = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveReset = resolve;
        }),
    );
    render(<AccountMenu name="Sam K" email="sam@example.com" demoResetEnabled onResetDemoData={onResetDemoData} />);
    await userEvent.click(screen.getByRole("button", { name: "Account menu" }));
    await userEvent.click(screen.getByRole("button", { name: "Reset to demo data" }));
    await userEvent.click(screen.getByRole("button", { name: "Reset" }));
    await screen.findByRole("button", { name: "Resetting…" });

    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("heading", { name: "Reset to demo data" })).toBeTruthy();

    resolveReset();
    await waitFor(() => expect(onResetDemoData).toHaveBeenCalledTimes(1));
  });

  it("does not fire a second reset from a repeat click while one is already in flight", async () => {
    let resolveReset!: () => void;
    const onResetDemoData = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveReset = resolve;
        }),
    );
    render(<AccountMenu name="Sam K" email="sam@example.com" demoResetEnabled onResetDemoData={onResetDemoData} />);
    await userEvent.click(screen.getByRole("button", { name: "Account menu" }));
    await userEvent.click(screen.getByRole("button", { name: "Reset to demo data" }));

    const resetButton = screen.getByRole("button", { name: "Reset" });
    await userEvent.click(resetButton);
    await screen.findByRole("button", { name: "Resetting…" });
    // No @testing-library/jest-dom in this repo — check the DOM property
    // directly, same pattern as SettingsSheet.test.tsx's status-text match.
    expect((resetButton as HTMLButtonElement).disabled).toBe(true);

    await userEvent.click(resetButton);
    resolveReset();
    await waitFor(() => expect(onResetDemoData).toHaveBeenCalledTimes(1));
  });

  it("shows an error inline when the reset fails, without closing the dialog", async () => {
    const onResetDemoData = vi.fn().mockRejectedValue(new Error("boom"));
    render(<AccountMenu name="Sam K" email="sam@example.com" demoResetEnabled onResetDemoData={onResetDemoData} />);
    await userEvent.click(screen.getByRole("button", { name: "Account menu" }));
    await userEvent.click(screen.getByRole("button", { name: "Reset to demo data" }));
    await userEvent.click(screen.getByRole("button", { name: "Reset" }));

    expect(await screen.findByText("boom")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Reset to demo data" })).toBeTruthy();
  });
});

describe("AccountMenuFromSession", () => {
  it("renders nothing while signed out", async () => {
    const { getSession } = await import("next-auth/react");
    vi.mocked(getSession).mockResolvedValueOnce(null);

    render(<AccountMenuFromSession />);

    await waitFor(() => expect(vi.mocked(getSession)).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Account menu" })).toBeNull();
  });

  it("resolves the session client-side and dispatches the real signOut on click", async () => {
    const { getSession, signOut } = await import("next-auth/react");
    vi.mocked(getSession).mockResolvedValueOnce({
      user: { name: "Sam K", email: "sam@example.com" },
      expires: "",
    });

    render(<AccountMenuFromSession />);

    await userEvent.click(await screen.findByRole("button", { name: "Account menu" }));
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));

    expect(signOut).toHaveBeenCalledWith({ callbackUrl: "/" });
  });

  it("defaults demoResetEnabled to off, so no reset item appears without an explicit prop", async () => {
    const { getSession } = await import("next-auth/react");
    vi.mocked(getSession).mockResolvedValueOnce({
      user: { name: "Sam K", email: "sam@example.com" },
      expires: "",
    });

    render(<AccountMenuFromSession />);

    await userEvent.click(await screen.findByRole("button", { name: "Account menu" }));
    expect(screen.queryByRole("button", { name: "Reset to demo data" })).toBeNull();
  });

  it("calls the real resetDemoData endpoint and reloads on success", async () => {
    const { getSession } = await import("next-auth/react");
    vi.mocked(getSession).mockResolvedValueOnce({
      user: { name: "Sam K", email: "sam@example.com" },
      expires: "",
    });
    resetDemoDataMock.mockResolvedValueOnce({ ok: true, value: { tripId: "trip-1" } });
    // jsdom's window.location.reload isn't a configurable own property, so
    // vi.spyOn can't redefine it directly — replace the whole location object
    // for the span of this test instead.
    const originalLocation = window.location;
    const reloadSpy = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, reload: reloadSpy },
    });

    render(<AccountMenuFromSession demoResetEnabled />);

    await userEvent.click(await screen.findByRole("button", { name: "Account menu" }));
    await userEvent.click(screen.getByRole("button", { name: "Reset to demo data" }));
    await userEvent.click(screen.getByRole("button", { name: "Reset" }));

    await waitFor(() => expect(resetDemoDataMock).toHaveBeenCalled());
    await waitFor(() => expect(reloadSpy).toHaveBeenCalled());
    Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
  });
});
