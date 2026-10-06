import { describe, expect, it } from "vitest";
import { CONSOLE_TABS, consoleTabHref, resolveConsoleTab } from "./consoleTab";

// M36's first gate box: each `?tab=` value renders its tab, and an unknown one
// renders Financial. The page switches on what this returns, so this is the
// cheapest layer that holds the box without rendering an async server component.

describe("resolveConsoleTab", () => {
  it("resolves every tab the strip offers to itself", () => {
    expect(CONSOLE_TABS.map((tab) => resolveConsoleTab(tab.value))).toEqual([
      "financial",
      "users",
      "library",
    ]);
  });

  it("renders Financial for a missing, unknown or not-yet-built tab", () => {
    expect(resolveConsoleTab(undefined)).toBe("financial");
    expect(resolveConsoleTab("")).toBe("financial");
    expect(resolveConsoleTab("billing")).toBe("financial");
    // Link 4 adds AI models; until then its URL is an unknown tab, not a blank one.
    expect(resolveConsoleTab("ai")).toBe("financial");
  });

  it("takes the first of a repeated param", () => {
    expect(resolveConsoleTab(["library", "users"])).toBe("library");
  });
});

describe("consoleTabHref", () => {
  it("carries the tab and nothing else, so an open account closes", () => {
    expect(consoleTabHref("users")).toBe("/admin?tab=users");
  });
});
