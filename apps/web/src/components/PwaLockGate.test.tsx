import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dialog } from "@/components/ui/dialog";
import type { MfaStatusResponse } from "@/lib/mfaWire";
import { EARLY_LOCK_SCRIPT, setLockSetting, type UnlockResult } from "@/lib/pwaLock";

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
  document.documentElement.removeAttribute("data-pwa-locked");
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
    // The next account to sign in here must not inherit this one's idle time.
    expect(window.localStorage.getItem("caesura_last_active")).toBeNull();
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

  // The setting is the device's: another account that signs in here may have chosen it.
  it("does not lock an account with no passkey, and leaves the device's setting alone", async () => {
    installed(true);
    idleFor(20 * MIN);
    status = { enabled: true, factors: [{ ...passkey, kind: "totp" }], recoveryCodesLeft: 10 };
    app();
    expect(await screen.findByRole("button", { name: "Plan a trip" })).toBeTruthy();
    await vi.waitFor(() => expect(lockScreen()).toBeNull());
    expect(window.localStorage.getItem("caesura_lock_after")).toBe("15m");
  });

  // Radix listens for Escape on the document in the capture phase, past `inert`.
  it("keeps Escape at the lock from closing a dialog open under it", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    installed(true);
    idleFor(0);
    const onOpenChange = vi.fn();
    render(
      <PwaLockGate signedIn userId="u1">
        <Dialog open onOpenChange={onOpenChange} title="Rename trip">
          <input aria-label="Trip name" defaultValue="Lisbon in Ma" />
        </Dialog>
      </PwaLockGate>,
    );
    await screen.findByRole("dialog", { name: "Rename trip" });
    await act(async () => {
      vi.advanceTimersByTime(16 * MIN);
    });
    expect(lockScreen()).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    expect(onOpenChange).not.toHaveBeenCalled();
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

describe("before the app hydrates", () => {
  // The hide's own rules, as `globals.css` writes them, so jsdom hides what a browser would.
  const rules = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8").match(
    /html\[data-pwa-locked\][^{]*\{[^}]*\}/g,
  );
  const style = document.createElement("style");
  style.textContent = (rules ?? []).join("\n");
  beforeEach(() => document.head.append(style));
  afterEach(() => style.remove());

  // The script as `(app)/layout.tsx` inlines it, run against this window.
  const runEarlyLock = () =>
    runInNewContext(EARLY_LOCK_SCRIPT, {
      localStorage: window.localStorage,
      navigator: window.navigator,
      matchMedia: globalThis.matchMedia,
      document,
      setTimeout: globalThis.setTimeout,
    });
  // The server's paint stands in as a body child, beside the M54 launch splash.
  function serverPaint() {
    const page = document.createElement("main");
    const splash = document.createElement("div");
    splash.className = "launch-overlay";
    document.body.append(splash, page);
    return { page, splash, remove: () => (page.remove(), splash.remove()) };
  }
  const shown = (el: Element) => getComputedStyle(el).visibility !== "hidden";
  const hidden = () => {
    const paint = serverPaint();
    const result = !shown(paint.page);
    paint.remove();
    return result;
  };

  it("hides an installed app reopened past its idle time, and the gate shows it once the lock is up", async () => {
    installed(true);
    idleFor(20 * MIN);
    runEarlyLock();
    expect(hidden()).toBe(true);
    app();
    expect(await screen.findByRole("dialog", { name: "Caesura is locked" })).toBeTruthy();
    expect(hidden()).toBe(false);
  });

  // M54 decision 6: the splash is the first frame of a home-screen launch, never hidden then shown.
  it("leaves the launch splash showing while it hides the app", () => {
    installed(true);
    idleFor(20 * MIN);
    const paint = serverPaint();
    runEarlyLock();
    expect(shown(paint.page)).toBe(false);
    expect(shown(paint.splash)).toBe(true);
    paint.remove();
  });

  // A chunk that never loads, or a root that throws in hydration, never mounts the
  // gate: the page must not stay blank for good, with Sign out under it.
  it("shows the page again by itself when the gate never mounts", () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    installed(true);
    idleFor(20 * MIN);
    runEarlyLock();
    vi.advanceTimersByTime(9_000);
    expect(hidden()).toBe(true);
    vi.advanceTimersByTime(1_000);
    expect(hidden()).toBe(false);
  });

  it("hides nothing in a browser tab, within the idle time, or with the lock off", () => {
    installed(false);
    idleFor(20 * MIN);
    runEarlyLock();
    installed(true);
    idleFor(1 * MIN);
    runEarlyLock();
    idleFor(20 * MIN, "off");
    runEarlyLock();
    expect(hidden()).toBe(false);
  });

  it("shows the page when the gate decides not to lock", () => {
    installed(true);
    idleFor(20 * MIN);
    runEarlyLock();
    app(false);
    expect(hidden()).toBe(false);
  });

  // Another window of the app recorded activity between the script and hydration:
  // no lock goes up, so nothing else would show the page.
  it("shows the page when activity elsewhere has brought it back inside the idle time", () => {
    installed(true);
    idleFor(20 * MIN);
    runEarlyLock();
    idleFor(0);
    app();
    expect(lockScreen()).toBeNull();
    expect(hidden()).toBe(false);
  });
});
