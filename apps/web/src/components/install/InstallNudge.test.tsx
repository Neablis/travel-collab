import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInstallPrompt, recordVisit, type InstallPrompt } from "@/lib/installPrompt";
import { InstallNudge } from "./InstallNudge";

// A fresh store per test, as in AccountMenu.install.test.tsx.
let store: InstallPrompt;
vi.mock("@/lib/installPrompt", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/installPrompt")>();
  return { ...actual, installPromptStore: () => store };
});

// jsdom has no layout, so the phone is a media query answered by hand.
let phone = true;
function stubMedia() {
  vi.stubGlobal("matchMedia", (query: string) =>
    Object.assign(new EventTarget(), { media: query, matches: phone && query.includes("max-width: 767px") }),
  );
}

let prompt: ReturnType<typeof vi.fn>;
function fireInstallable() {
  prompt = vi.fn(async () => {});
  const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
    prompt,
    userChoice: Promise.resolve({ outcome: "dismissed", platform: "web" }),
  });
  act(() => {
    window.dispatchEvent(event);
  });
}

function returning() {
  recordVisit(new Date(2026, 9, 1));
  recordVisit(new Date(2026, 9, 2));
}

const card = () => screen.queryByRole("region", { name: "Install Caesura" });

beforeEach(() => {
  phone = true;
  stubMedia();
  window.localStorage.clear();
  store = createInstallPrompt(window);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// The trips list's card (Mitchell, 2026-10-10: install moved off the trip
// page). It asks once, on a returning phone where installing would work.
describe("InstallNudge — the trips list's install card", () => {
  it("appears on a returning phone that can install", () => {
    returning();
    render(<InstallNudge />);
    fireInstallable();
    expect(card()?.textContent).toContain("Keep Caesura on your home screen");
  });

  it("never appears on a first visit", () => {
    recordVisit(new Date(2026, 9, 2));
    recordVisit(new Date(2026, 9, 2, 23));
    render(<InstallNudge />);
    fireInstallable();
    expect(card()).toBeNull();
  });

  it("never appears on a desktop, whose way in is the top nav's Get the app", () => {
    phone = false;
    returning();
    render(<InstallNudge />);
    fireInstallable();
    expect(card()).toBeNull();
  });

  it("never appears where the browser cannot install", () => {
    returning();
    render(<InstallNudge />);
    expect(card()).toBeNull();
  });

  it("Not now hides it on this device for good", () => {
    returning();
    render(<InstallNudge />);
    fireInstallable();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(card()).toBeNull();
    cleanup();

    // The next page load.
    store = createInstallPrompt(window);
    render(<InstallNudge />);
    fireInstallable();
    expect(card()).toBeNull();
  });

  // The same storage key the trip page's row used: a reader who said Not now
  // to that is not asked again by its replacement.
  it("stays away for a reader who dismissed the old trip-page row", () => {
    returning();
    window.localStorage.setItem("caesura_install_nudge_dismissed", "1");
    render(<InstallNudge />);
    fireInstallable();
    expect(card()).toBeNull();
  });

  it("Install asks the browser, and answers the question for good", () => {
    returning();
    render(<InstallNudge />);
    fireInstallable();
    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(card()).toBeNull();
    cleanup();

    // The next load, with the browser offering again after a cancelled dialog.
    store = createInstallPrompt(window);
    render(<InstallNudge />);
    fireInstallable();
    expect(card()).toBeNull();
  });

  it("shows Safari on an iPhone the two steps", async () => {
    returning();
    const iphone = Object.assign(new EventTarget(), {
      navigator: {
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
        maxTouchPoints: 5,
      },
    });
    store = createInstallPrompt(iphone as unknown as Window);
    render(<InstallNudge />);
    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    const steps = await screen.findByRole("dialog", { name: "Add Caesura to your Home Screen" });
    expect(steps.textContent).toContain("Choose Add to Home Screen.");
  });

  it("asks for nothing when storage throws", () => {
    returning();
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    try {
      render(<InstallNudge />);
      fireInstallable();
      expect(card()).toBeNull();
    } finally {
      vi.restoreAllMocks();
    }
  });
});
