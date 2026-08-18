import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { ShareButton } from "./ShareButton";

afterEach(cleanup);

// ShareButton wraps itself in <Preview id="share-button"> internally, so
// every test below renders `<ShareButton>` directly — no outer <Preview>
// needed to get the "Preview · M11" chip, the data-preview-id region, or the
// pointer-events shield (same contract as KeepDayDialog.test.tsx).
describe("ShareButton", () => {
  it("renders a Share button inside the share-button Preview region", () => {
    render(<ShareButton />);
    const region = document.querySelector('[data-preview-id="share-button"]');
    expect(region).not.toBeNull();
    expect(region?.textContent).toContain("Share");
  });

  it("shows the M11 milestone via tooltip (compact icon badge, not a text chip)", () => {
    render(<ShareButton />);
    const region = document.querySelector('[data-preview-id="share-button"]');
    expect(region?.getAttribute("title")).toMatch(/M11/);
  });

  it("defaults to the ghost variant (trip header call site)", () => {
    render(<ShareButton />);
    const button = screen.getByRole("button", { name: "Share" });
    expect(button.className).toMatch(/text-slate/);
  });

  it("renders the secondary variant when asked (next-trip hero call site)", () => {
    render(<ShareButton variant="secondary" />);
    const button = screen.getByRole("button", { name: "Share" });
    expect(button.className).toMatch(/border-border-strong/);
  });

  it("is genuinely inert: pointer-events shielded, never fires", async () => {
    render(<ShareButton />);
    const button = screen.getByRole("button", { name: "Share" });
    await expect(userEvent.click(button)).rejects.toThrow();
  });
});
