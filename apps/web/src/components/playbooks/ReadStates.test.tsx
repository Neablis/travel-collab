import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SyncFailure } from "./ReadStates";

afterEach(cleanup);

// Test-pruning owner test: the sync-failure banner's contract used to be
// proven three times at parent layers (Leaderboard, Profile, Discover) and
// zero times here. The banner owns: it renders nothing without an error,
// it shows exactly one Retry that calls reload, and it says Retrying…
// (disabled) while a reload is in flight. The pages keep only their own
// halves — their error copy and their skeleton behaviour — which are not
// the banner's to prove.
describe("SyncFailure", () => {
  const read = (overrides: { error?: string | null; loading?: boolean; reload?: () => void } = {}) => ({
    error: null as string | null,
    loading: false,
    reload: vi.fn(),
    ...overrides,
  });

  it("renders nothing when the read has no error", () => {
    render(<SyncFailure read={read()} what="the board" />);
    expect(screen.queryByTestId("library-sync-failure")).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("shows one Retry, and it reloads", async () => {
    const reload = vi.fn();
    render(<SyncFailure read={read({ error: "Network error", reload })} what="the board" />);
    const banner = screen.getByTestId("library-sync-failure");
    expect(banner.textContent).toContain("Could not reach the board. What is shown may be out of date.");
    // Exactly one, and it is the banner's — a second Retry elsewhere on a
    // page that failed its first read would be two answers to the same
    // question.
    expect(screen.getAllByRole("button", { name: "Retry" })).toHaveLength(1);
    expect(within(banner).getByRole("button", { name: "Retry" })).toBeTruthy();
    await userEvent.click(within(banner).getByRole("button", { name: "Retry" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("says Retrying and disables the button while a reload is in flight", () => {
    render(<SyncFailure read={read({ error: "Network error", loading: true })} what="the board" />);
    const retry = screen.getByRole("button", { name: "Retrying…" });
    expect(retry).toBeTruthy();
    expect((retry as HTMLButtonElement).disabled).toBe(true);
  });
});
