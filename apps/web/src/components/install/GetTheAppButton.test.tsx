import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInstallPrompt, type InstallPrompt } from "@/lib/installPrompt";
import { GetTheAppButton } from "./GetTheAppButton";

// A fresh store per test, as in AccountMenu.install.test.tsx.
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

const button = () => screen.queryByRole("button", { name: "Get the app" });

// The desktop top nav's install control (Mitchell, 2026-10-10: "along the top
// on desktop next to 'Playbooks' and make it more clear its a app").
describe("GetTheAppButton", () => {
  it("is not offered by a browser that has not said it can install", () => {
    render(<GetTheAppButton />);
    expect(button()).toBeNull();
  });

  it("asks the browser to install once it has said it can", async () => {
    render(<GetTheAppButton />);
    const prompt = fireInstallable();
    await userEvent.click(button()!);
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it("goes away once the app is installed", () => {
    render(<GetTheAppButton />);
    fireInstallable();
    expect(button()).not.toBeNull();
    act(() => {
      window.dispatchEvent(new Event("appinstalled"));
    });
    expect(button()).toBeNull();
  });

  it("shows Safari on an iPad the two steps instead", async () => {
    const ipad = Object.assign(new EventTarget(), {
      navigator: {
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15",
        maxTouchPoints: 5,
      },
    });
    store = createInstallPrompt(ipad as unknown as Window);
    render(<GetTheAppButton />);
    await userEvent.click(button()!);
    expect(await screen.findByRole("dialog", { name: "Add Caesura to your Home Screen" })).toBeTruthy();
  });
});
