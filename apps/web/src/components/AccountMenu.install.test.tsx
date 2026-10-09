import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInstallPrompt, type InstallPrompt } from "@/lib/installPrompt";
import { AccountMenu } from "./AccountMenu";

vi.mock("next-auth/react", () => ({ getSession: vi.fn(), signOut: vi.fn(async () => {}) }));

// The app's one store is created against the real window on first use and
// kept for the life of the module; each test here gets a fresh one instead, so
// an install event dispatched by one test is not still stashed in the next.
let store: InstallPrompt;
vi.mock("@/lib/installPrompt", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/installPrompt")>();
  return { ...actual, installPromptStore: () => store };
});

beforeEach(() => {
  store = createInstallPrompt(window);
});
afterEach(cleanup);

function fireInstallable() {
  const prompt = vi.fn(async () => {});
  const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
    prompt,
    userChoice: Promise.resolve({ outcome: "accepted", platform: "web" }),
  });
  act(() => {
    window.dispatchEvent(event);
  });
  return prompt;
}

async function openMenu() {
  await userEvent.click(screen.getByRole("button", { name: "Account menu" }));
}

describe("AccountMenu — Install app", () => {
  it("is not offered by a browser that has not said it can install", async () => {
    render(<AccountMenu name="Sam K" email="sam@example.com" />);
    await openMenu();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Install app" })).toBeNull();
  });

  it("asks the browser to install once it has said it can", async () => {
    render(<AccountMenu name="Sam K" email="sam@example.com" />);
    const prompt = fireInstallable();
    await openMenu();
    await userEvent.click(screen.getByRole("button", { name: "Install app" }));
    expect(prompt).toHaveBeenCalledTimes(1);
    // The menu closed behind the browser's own dialog.
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
  });

  it("goes away once the app is installed", async () => {
    render(<AccountMenu name="Sam K" email="sam@example.com" />);
    fireInstallable();
    act(() => {
      window.dispatchEvent(new Event("appinstalled"));
    });
    await openMenu();
    expect(screen.queryByRole("button", { name: "Install app" })).toBeNull();
  });

  it("shows Safari on an iPhone the two steps instead", async () => {
    const iphone = Object.assign(new EventTarget(), {
      navigator: {
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
        maxTouchPoints: 5,
      },
    });
    store = createInstallPrompt(iphone as unknown as Window);
    render(<AccountMenu name="Sam K" email="sam@example.com" />);
    await openMenu();
    await userEvent.click(screen.getByRole("button", { name: "Install app" }));
    const sheet = await screen.findByRole("dialog", { name: "Add Caesura to your Home Screen" });
    expect(sheet.textContent).toContain("Tap Share in Safari's toolbar.");
    expect(sheet.textContent).toContain("Choose Add to Home Screen.");
  });
});
