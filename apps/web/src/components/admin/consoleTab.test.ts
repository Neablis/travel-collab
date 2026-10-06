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
      "ai",
    ]);
  });

  it("renders Financial for a missing or unknown tab", () => {
    expect(resolveConsoleTab(undefined)).toBe("financial");
    expect(resolveConsoleTab("")).toBe("financial");
    expect(resolveConsoleTab("billing")).toBe("financial");
    // The value, not the label: `?tab=AI models` is a typed URL, not a tab.
    expect(resolveConsoleTab("AI models")).toBe("financial");
  });

  it("labels the fourth tab AI models, after Library (M36 link 4)", () => {
    expect(CONSOLE_TABS.at(-1)).toEqual({ value: "ai", label: "AI models" });
    expect(resolveConsoleTab("ai")).toBe("ai");
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
