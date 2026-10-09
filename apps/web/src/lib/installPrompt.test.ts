import { describe, expect, it, vi } from "vitest";
import {
  createInstallPrompt,
  dismissInstallNudge,
  installNudgeDismissed,
  isIosSafari,
  isReturningVisitor,
  recordVisit,
} from "./installPrompt";

// A window with only what the store reads: events, one media query, a navigator.
function fakeWindow({
  userAgent = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/129 Mobile Safari/537.36",
  maxTouchPoints = 5,
  standalone,
  displayModeStandalone = false,
}: {
  userAgent?: string;
  maxTouchPoints?: number;
  standalone?: boolean;
  displayModeStandalone?: boolean;
} = {}) {
  const target = new EventTarget();
  const media = Object.assign(new EventTarget(), { matches: displayModeStandalone, media: "(display-mode: standalone)" });
  const win = Object.assign(target, {
    navigator: { userAgent, maxTouchPoints, standalone },
    matchMedia: () => media,
  });
  return { win: win as unknown as Window, media };
}

// What Chromium hands the page: cancelable, with `prompt()` and `userChoice`.
function installEvent(outcome: "accepted" | "dismissed" = "accepted") {
  const event = new Event("beforeinstallprompt", { cancelable: true });
  const prompt = vi.fn(async () => {});
  Object.assign(event, { prompt, userChoice: Promise.resolve({ outcome, platform: "web" }) });
  return { event, prompt };
}

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";
// iPadOS asks for the desktop site, so its Safari says Macintosh; only touch tells it apart.
const IPAD_AS_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15";

describe("createInstallPrompt", () => {
  it("offers nothing in a browser that never says it can install", () => {
    const { win } = fakeWindow();
    expect(createInstallPrompt(win).route()).toBeNull();
  });

  it("stashes beforeinstallprompt, keeping the browser's own banner away", () => {
    const { win } = fakeWindow();
    const store = createInstallPrompt(win);
    const onChange = vi.fn();
    store.subscribe(onChange);
    const { event } = installEvent();
    win.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(store.route()).toBe("prompt");
    expect(onChange).toHaveBeenCalled();
  });

  it("prompts with the stashed event and reports the reader's choice", async () => {
    const { win } = fakeWindow();
    const store = createInstallPrompt(win);
    const { event, prompt } = installEvent("dismissed");
    win.dispatchEvent(event);
    await expect(store.prompt()).resolves.toBe("dismissed");
    expect(prompt).toHaveBeenCalledTimes(1);
    // An event can be prompted once; the row waits for the browser's next one.
    expect(store.route()).toBeNull();
    await expect(store.prompt()).resolves.toBeNull();
  });

  it("hides everything once the app is installed", () => {
    const { win } = fakeWindow({ userAgent: IPHONE });
    const store = createInstallPrompt(win);
    win.dispatchEvent(installEvent().event);
    win.dispatchEvent(new Event("appinstalled"));
    expect(store.route()).toBeNull();
  });

  it("hides everything inside the installed app (display-mode: standalone)", () => {
    const { win, media } = fakeWindow({ displayModeStandalone: true });
    const store = createInstallPrompt(win);
    win.dispatchEvent(installEvent().event);
    expect(store.route()).toBeNull();
    // And follows the query when it changes under a live page.
    const onChange = vi.fn();
    store.subscribe(onChange);
    media.matches = false;
    media.dispatchEvent(new Event("change"));
    expect(onChange).toHaveBeenCalled();
    expect(store.route()).toBe("prompt");
  });

  it("shows iOS Safari the steps, and an iOS home-screen app nothing", () => {
    expect(createInstallPrompt(fakeWindow({ userAgent: IPHONE }).win).route()).toBe("ios");
    expect(createInstallPrompt(fakeWindow({ userAgent: IPHONE, standalone: true }).win).route()).toBeNull();
  });

  it("stops notifying a listener that unsubscribed", () => {
    const { win } = fakeWindow();
    const store = createInstallPrompt(win);
    const onChange = vi.fn();
    store.subscribe(onChange)();
    win.dispatchEvent(installEvent().event);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("isIosSafari", () => {
  it.each([
    ["an iPhone", IPHONE, 5, true],
    ["an iPad asking for the desktop site", IPAD_AS_MAC, 5, true],
    ["a Mac (no touch)", IPAD_AS_MAC, 0, false],
    ["Chrome on an iPhone", IPHONE.replace("Version/18.0", "CriOS/129.0"), 5, false],
    ["Firefox on an iPhone", IPHONE.replace("Version/18.0", "FxiOS/131.0"), 5, false],
    ["Android Chrome", "Mozilla/5.0 (Linux; Android 14) Chrome/129 Mobile Safari/537.36", 5, false],
  ])("%s", (_label, userAgent, maxTouchPoints, expected) => {
    expect(isIosSafari({ userAgent, maxTouchPoints })).toBe(expected);
  });
});

// A Storage in memory, or one that throws on every call (Safari's private mode).
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
}
const throwingStorage = () => {
  throw new DOMException("denied", "SecurityError");
};

describe("visits and the nudge's Not now", () => {
  const day1 = new Date(2026, 9, 8, 22, 0);
  const day1Later = new Date(2026, 9, 8, 23, 59);
  const day2 = new Date(2026, 9, 9, 0, 1);

  it("is a first visit until the app is opened on a second day", () => {
    const storage = memoryStorage();
    recordVisit(day1, () => storage);
    expect(isReturningVisitor(() => storage)).toBe(false);
    recordVisit(day1Later, () => storage);
    expect(isReturningVisitor(() => storage)).toBe(false);
    recordVisit(day2, () => storage);
    expect(isReturningVisitor(() => storage)).toBe(true);
  });

  it("reads a garbled record as a first visit", () => {
    const storage = memoryStorage();
    storage.setItem("caesura_visit_days", "{not json");
    expect(isReturningVisitor(() => storage)).toBe(false);
    recordVisit(day1, () => storage);
    expect(isReturningVisitor(() => storage)).toBe(false);
  });

  it("remembers Not now on this device", () => {
    const storage = memoryStorage();
    expect(installNudgeDismissed(() => storage)).toBe(false);
    dismissInstallNudge(() => storage);
    expect(installNudgeDismissed(() => storage)).toBe(true);
  });

  it("asks for nothing when storage throws: never returning, always dismissed", () => {
    expect(() => recordVisit(day2, throwingStorage)).not.toThrow();
    expect(() => dismissInstallNudge(throwingStorage)).not.toThrow();
    expect(isReturningVisitor(throwingStorage)).toBe(false);
    expect(installNudgeDismissed(throwingStorage)).toBe(true);
  });
});
