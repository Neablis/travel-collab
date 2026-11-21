import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MfaStatusResponse } from "@/lib/mfaWire";
import { setLockSetting, type UnlockResult } from "@/lib/pwaLock";

const unlock = vi.fn<() => Promise<UnlockResult>>();
vi.mock("@/lib/pwaLock", async (original) => ({
  ...(await original<typeof import("@/lib/pwaLock")>()),
  unlockWithPasskey: () => unlock(),
}));
const signOutMock = vi.fn();
vi.mock("next-auth/react", () => ({ signOut: (...args: unknown[]) => signOutMock(...args) }));

import { PwaLockGate } from "./PwaLockGate";

const MIN = 60_000;
const passkey = { id: "f1", name: "Phone", kind: "passkey" as const, createdAt: "2026-11-01T00:00:00Z", lastUsedAt: null };
let status: MfaStatusResponse = { enabled: true, factors: [passkey], recoveryCodesLeft: 10 };

function installed(standalone: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: standalone && query === "(display-mode: standalone)" }));
}
function idleFor(ms: number, setting = "15m") {
  window.localStorage.setItem("caesura_lock_after", setting);
  window.localStorage.setItem("caesura_last_active", String(Date.now() - ms));
}
function app(signedIn = true) {
  return render(
    <PwaLockGate signedIn={signedIn} userId="u1">
      <button type="button">Plan a trip</button>
    </PwaLockGate>,
  );
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(status), { status: 200 })),
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  unlock.mockReset();
  signOutMock.mockReset();
  window.localStorage.clear();
  status = { enabled: true, factors: [passkey], recoveryCodesLeft: 10 };
});

const lockScreen = () => screen.queryByRole("dialog", { name: "Caesura is locked" });

describe("PwaLockGate", () => {
  it("locks an installed app reopened past its idle time, and only the passkey clears it", async () => {
    installed(true);
    idleFor(20 * MIN);
    unlock.mockResolvedValue("unlocked");
    app();
    expect(await screen.findByRole("dialog", { name: "Caesura is locked" })).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Unlock with passkey" }));
    expect(lockScreen()).toBeNull();
    expect(screen.getByRole("button", { name: "Plan a trip" })).toBeTruthy();
    expect(Number(window.localStorage.getItem("caesura_last_active"))).toBeGreaterThan(Date.now() - MIN);
  });

  it("stays locked, and says so, when the passkey is refused", async () => {
    installed(true);
    idleFor(20 * MIN);
    unlock.mockResolvedValue("refused");
    app();
    await userEvent.click(await screen.findByRole("button", { name: "Unlock with passkey" }));
    expect((await screen.findByRole("alert")).textContent).toBe("That passkey could not unlock the app. Try again.");
    expect(lockScreen()).toBeTruthy();
  });

  it("says it is offline, not that the passkey failed, when the unlock cannot reach the server", async () => {
    installed(true);
    idleFor(20 * MIN);
    unlock.mockResolvedValue("offline");
    app();
    await userEvent.click(await screen.findByRole("button", { name: "Unlock with passkey" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "You're offline. Your passkey can open the app once you're connected.",
    );
  });

  it("signs out from the lock screen, and takes the account's Ask conversations with it", async () => {
    installed(true);
    idleFor(20 * MIN);
    window.localStorage.setItem("ask_thread_v1:u1:home", "[]");
    app();
    await userEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    expect(signOutMock).toHaveBeenCalledWith({ callbackUrl: "/" });
    expect(window.localStorage.getItem("ask_thread_v1:u1:home")).toBeNull();
  });

  it("moves focus to Unlock when it locks, and back to where it was once unlocked", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    installed(true);
    idleFor(0);
    unlock.mockResolvedValue("unlocked");
    app();
    const planATrip = await screen.findByRole("button", { name: "Plan a trip" });
    planATrip.focus();
    await act(async () => {
      vi.advanceTimersByTime(16 * MIN);
    });
    const unlockButton = screen.getByRole("button", { name: "Unlock with passkey" });
    expect(unlockButton.matches(":focus")).toBe(true);
    await act(async () => {
      unlockButton.click();
    });
    expect(lockScreen()).toBeNull();
    expect(planATrip.matches(":focus")).toBe(true);
  });

  it("does not lock in a browser tab", async () => {
    installed(false);
    idleFor(20 * MIN);
    app();
    expect(await screen.findByRole("button", { name: "Plan a trip" })).toBeTruthy();
    expect(lockScreen()).toBeNull();
  });

  it("clears the setting instead of locking an account with no passkey left", async () => {
    installed(true);
    idleFor(20 * MIN);
    status = { enabled: true, factors: [{ ...passkey, kind: "totp" }], recoveryCodesLeft: 10 };
    app();
    expect(await screen.findByRole("button", { name: "Plan a trip" })).toBeTruthy();
    expect(lockScreen()).toBeNull();
    expect(window.localStorage.getItem("caesura_lock_after")).toBeNull();
  });

  it("watches from the moment the lock is turned on, without a relaunch", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    installed(true);
    app();
    expect(await screen.findByRole("button", { name: "Plan a trip" })).toBeTruthy();
    act(() => {
      setLockSetting("15m");
    });
    await act(async () => {
      vi.advanceTimersByTime(16 * MIN);
    });
    expect(lockScreen()).toBeTruthy();
  });

  it("locks an app left open in the foreground once the idle time passes", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    installed(true);
    idleFor(0);
    app();
    expect(await screen.findByRole("button", { name: "Plan a trip" })).toBeTruthy();
    expect(lockScreen()).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(16 * MIN);
    });
    expect(lockScreen()).toBeTruthy();
  });
});
