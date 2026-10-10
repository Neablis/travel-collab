import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UnderlineTabs, tabId, tabPanelId } from "./underline-tabs";

const OPTIONS = [
  { value: "profile", label: "Profile" },
  { value: "plan", label: "Plan & usage" },
  { value: "tokens", label: "API tokens" },
] as const;

function renderTabs(value: (typeof OPTIONS)[number]["value"] | null = "profile") {
  const onValueChange = vi.fn();
  render(
    <UnderlineTabs
      value={value}
      onValueChange={onValueChange}
      options={OPTIONS}
      idPrefix="account"
      aria-label="Account sections"
    />,
  );
  return { onValueChange };
}

describe("UnderlineTabs", () => {
  it("is a tablist with one tab per option and exactly one selected", () => {
    renderTabs("plan");
    const list = screen.getByRole("tablist", { name: "Account sections" });
    expect(list).toBeTruthy();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Profile", "Plan & usage", "API tokens"]);
    expect(tabs.filter((t) => t.getAttribute("aria-selected") === "true").map((t) => t.textContent)).toEqual([
      "Plan & usage",
    ]);
  });

  it("reports the clicked tab", () => {
    const { onValueChange } = renderTabs();
    fireEvent.click(screen.getByRole("tab", { name: "API tokens" }));
    expect(onValueChange).toHaveBeenCalledWith("tokens");
  });

  // SPEC §33.2's treatment, and the reason this is not `TabStrip`: a place is a
  // 2px brand edge on a hairline base line, not a moss pill. `components/ui/**`
  // is the one place the lint wall allows a class assertion, because a
  // primitive mapping a look onto tokens has nothing else to assert.
  it("draws §33.2's underline: a brand edge when selected, transparent when not, on a hairline base line", () => {
    renderTabs("plan");
    expect(screen.getByRole("tablist").className).toContain("border-hairline");
    const selected = screen.getByRole("tab", { name: "Plan & usage" });
    const idle = screen.getByRole("tab", { name: "Profile" });
    expect(selected.className).toContain("border-brand");
    expect(selected.className).toContain("text-ink");
    expect(idle.className).toContain("border-transparent");
    expect(idle.className).toContain("text-slate");
    // The overlap that makes one rule with a thick segment rather than two
    // stacked lines. Losing it is a silent visual regression.
    expect(selected.className).toContain("-mb-px");
    // It is NOT the pill. If someone swaps the primitive back, this fails.
    expect(selected.className).not.toContain("bg-moss");
  });

  // SPEC §13.1 — "44px targets, always" — and §34.3 repeats it for the phone
  // account screen. The desktop artboard draws 40px, so the floor is released
  // for a mouse at md and up (`fine:`, M39 D3) — a tablet keeps 44px.
  it("is 44px under a finger and the artboard's 40px for a mouse from md up", () => {
    renderTabs();
    const tab = screen.getByRole("tab", { name: "Profile" });
    expect(tab.className).toContain("min-h-11");
    expect(tab.className).toContain("fine:min-h-10");
    // `min-h`, not `h`: a wrapped label has to push the row taller rather than
    // overflow it.
    expect(tab.className).not.toMatch(/(^|\s)h-1[01](\s|$)/);
  });

  it("namespaces its tab ids so two strips cannot collide", () => {
    renderTabs();
    const tab = screen.getByRole("tab", { name: "API tokens" });
    expect(tab.id).toBe(tabId("account", "tokens"));
    expect(tabId("discover", "tokens")).not.toBe(tabId("account", "tokens"));
  });

  // axe `aria-valid-attr-value` (critical) on /playbooks: every tab pointed
  // `aria-controls` at a panel id nothing rendered. A tab points at a panel
  // only when the caller says it renders one, and only the selected tab,
  // because callers mount one panel at a time.
  it("points only the selected tab at its panel, and only when the caller renders one", () => {
    const { unmount } = render(
      <UnderlineTabs
        value="plan"
        onValueChange={() => {}}
        options={OPTIONS}
        idPrefix="account"
        hasPanel
        aria-label="Account sections"
      />,
    );
    expect(screen.getByRole("tab", { name: "Plan & usage" }).getAttribute("aria-controls")).toBe(
      tabPanelId("account", "plan"),
    );
    expect(screen.getByRole("tab", { name: "API tokens" }).hasAttribute("aria-controls")).toBe(false);
    unmount();

    renderTabs("plan");
    for (const tab of screen.getAllByRole("tab")) expect(tab.hasAttribute("aria-controls")).toBe(false);
  });

  // A `role="tablist"` owes arrow-key movement. Without these the tabs are a row
  // of buttons wearing a tab's clothes, which is what `TabStrip` is today.
  it("moves with the arrow keys, wrapping at both ends", () => {
    const { onValueChange } = renderTabs("plan");
    const list = screen.getByRole("tablist");
    fireEvent.keyDown(list, { key: "ArrowRight" });
    expect(onValueChange).toHaveBeenLastCalledWith("tokens");
    fireEvent.keyDown(list, { key: "ArrowLeft" });
    expect(onValueChange).toHaveBeenLastCalledWith("profile");
  });

  it("wraps past the ends rather than stopping", () => {
    const first = renderTabs("profile");
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowLeft" });
    expect(first.onValueChange).toHaveBeenLastCalledWith("tokens");
  });

  it("takes Home and End to the ends", () => {
    const { onValueChange } = renderTabs("plan");
    const list = screen.getByRole("tablist");
    fireEvent.keyDown(list, { key: "End" });
    expect(onValueChange).toHaveBeenLastCalledWith("tokens");
    fireEvent.keyDown(list, { key: "Home" });
    expect(onValueChange).toHaveBeenLastCalledWith("profile");
  });

  it("leaves other keys alone, so typing in the page is not swallowed", () => {
    const { onValueChange } = renderTabs();
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "a" });
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowDown" });
    expect(onValueChange).not.toHaveBeenCalled();
  });

  // Roving tabindex: the strip is ONE tab stop. Without this, tabbing through
  // the page walks every tab before reaching the panel underneath.
  it("is a single tab stop", () => {
    renderTabs("plan");
    const tabbable = screen.getAllByRole("tab").filter((t) => t.getAttribute("tabindex") === "0");
    expect(tabbable.map((t) => t.textContent)).toEqual(["Plan & usage"]);
  });

  // Account's tokens sub-view (SPEC §35.4) belongs to the strip without being
  // one of its tabs. Roving tabindex alone would give every tab -1 there and the
  // strip would vanish from keyboard order; the first tab keeps the stop.
  it("keeps one tab stop, on the first tab, when nothing is selected", () => {
    renderTabs(null);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.filter((t) => t.getAttribute("aria-selected") === "true")).toEqual([]);
    const tabbable = tabs.filter((t) => t.getAttribute("tabindex") === "0");
    expect(tabbable.map((t) => t.textContent)).toEqual(["Profile"]);
  });
});
