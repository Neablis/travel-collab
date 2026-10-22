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
  // Test-pruning: the install lifecycle itself (not offered / prompt once /
  // gone after install) is proven at its owner layer by
  // GetTheAppButton.test.tsx against the same store mock, and the store
  // logic by lib/installPrompt.test.ts — so this file keeps only the
  // menu-specific wiring: the control is present inside the menu, and
  // the menu closes behind the browser's dialog. The iOS sheet's two
  // steps are asserted once, in GetTheAppButton.test.tsx's iPad test.
  it("the menu offers Install app once installable, and the menu closes when it is pressed", async () => {
    render(<AccountMenu name="Sam K" email="sam@example.com" />);
    const prompt = fireInstallable();
    await openMenu();
    await userEvent.click(screen.getByRole("button", { name: "Install app" }));
    expect(prompt).toHaveBeenCalledTimes(1);
    // The menu closed behind the browser's own dialog.
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
  });
});
