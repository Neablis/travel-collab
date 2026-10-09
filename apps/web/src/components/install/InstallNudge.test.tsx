import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInstallPrompt, recordVisit, type InstallPrompt } from "@/lib/installPrompt";
import { Sheet } from "@/components/ui/sheet";
import { INSTALL_NUDGE_DELAY_MS, InstallNudge } from "./InstallNudge";

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

function waitOut() {
  act(() => {
    vi.advanceTimersByTime(INSTALL_NUDGE_DELAY_MS);
  });
}

const nudge = () => screen.queryByRole("region", { name: "Install Caesura" });

beforeEach(() => {
  vi.useFakeTimers();
  phone = true;
  stubMedia();
  window.localStorage.clear();
  store = createInstallPrompt(window);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("InstallNudge", () => {
  it("appears on a returning phone once the trip has been open a few seconds", () => {
    returning();
    render(<InstallNudge eligible />);
    fireInstallable();
    act(() => {
      vi.advanceTimersByTime(INSTALL_NUDGE_DELAY_MS - 1);
    });
    expect(nudge()).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(nudge()?.textContent).toContain("Keep Caesura on your home screen");
  });

  it("never appears on a first visit", () => {
    recordVisit(new Date(2026, 9, 2));
    recordVisit(new Date(2026, 9, 2, 23));
    render(<InstallNudge eligible />);
    fireInstallable();
    waitOut();
    expect(nudge()).toBeNull();
  });

  it.each([
    ["a view the caller ruled out", () => render(<InstallNudge eligible={false} />)],
    [
      "a desktop",
      () => {
        phone = false;
        render(<InstallNudge eligible />);
      },
    ],
  ])("never appears on %s", (_label, mount) => {
    returning();
    mount();
    fireInstallable();
    waitOut();
    expect(nudge()).toBeNull();
  });

  it("never appears where the browser cannot install", () => {
    returning();
    render(<InstallNudge eligible />);
    waitOut();
    expect(nudge()).toBeNull();
  });

  it("stays away while a sheet is open over the page, and comes back after", async () => {
    returning();
    const page = (open: boolean) => (
      <>
        <InstallNudge eligible />
        <Sheet open={open} onOpenChange={() => {}} title="Edit stop">
          editing
        </Sheet>
      </>
    );
    const { rerender } = render(page(true));
    fireInstallable();
    waitOut();
    // `hidden: true`: a modal sheet marks everything outside it `aria-hidden`,
    // which would make the row unfindable by role whether it rendered or not.
    expect(screen.queryByRole("region", { name: "Install Caesura", hidden: true })).toBeNull();
    rerender(page(false));
    // The observer reports a microtask after the sheet's DOM goes.
    await vi.waitFor(() => expect(nudge()).not.toBeNull());
  });

  it("waits for the page to be back at its top before pushing anything down", () => {
    returning();
    render(<InstallNudge eligible />);
    fireInstallable();
    vi.stubGlobal("scrollY", 600);
    waitOut();
    expect(nudge()).toBeNull();
    vi.stubGlobal("scrollY", 0);
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    expect(nudge()).not.toBeNull();
  });

  it("Not now hides it on this device for good", () => {
    returning();
    render(<InstallNudge eligible />);
    fireInstallable();
    waitOut();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(nudge()).toBeNull();
    cleanup();

    // The next page load.
    store = createInstallPrompt(window);
    render(<InstallNudge eligible />);
    fireInstallable();
    waitOut();
    expect(nudge()).toBeNull();
  });

  it("Install asks the browser, and gets out of the way", () => {
    returning();
    render(<InstallNudge eligible />);
    fireInstallable();
    waitOut();
    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(nudge()).toBeNull();
  });

  // Chromium fires a fresh offer on the next load after a cancelled dialog, so
  // an Install that only hid the row for this page asked again on every trip.
  it("Install answers the question for good, whatever the dialog's outcome", () => {
    returning();
    render(<InstallNudge eligible />);
    fireInstallable();
    waitOut();
    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    cleanup();

    // The next page load, with the browser offering again.
    store = createInstallPrompt(window);
    render(<InstallNudge eligible />);
    fireInstallable();
    waitOut();
    expect(nudge()).toBeNull();
  });

  it("a dialog that refuses to open is not an unhandled rejection", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      returning();
      render(<InstallNudge eligible />);
      fireInstallable();
      prompt.mockRejectedValueOnce(new DOMException("already shown", "InvalidStateError"));
      waitOut();
      fireEvent.click(screen.getByRole("button", { name: "Install" }));
      vi.useRealTimers();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("asks for nothing when storage throws", () => {
    returning();
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    try {
      render(<InstallNudge eligible />);
      fireInstallable();
      waitOut();
      expect(nudge()).toBeNull();
    } finally {
      vi.restoreAllMocks();
    }
  });
});
