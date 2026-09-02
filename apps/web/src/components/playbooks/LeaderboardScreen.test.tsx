import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LeaderboardResponse } from "@/lib/playbooks";

const fetchLeaderboardMock = vi.fn();
vi.mock("@/lib/apiClient", () => ({
  fetchLeaderboard: (...a: unknown[]) => fetchLeaderboardMock(...a),
}));

import { LeaderboardScreen } from "./LeaderboardScreen";

const board: LeaderboardResponse = {
  authors: [
    { userId: "dev-bob", displayName: "dev-bob", daysShared: 1, adds: 4 },
    { userId: "dev-alice", displayName: "dev-alice", daysShared: 2, adds: 3 },
    { userId: "dev-carol", displayName: "dev-carol", daysShared: 3, adds: 0 },
  ],
  meUserId: "dev-alice",
};

const ok = <T,>(value: T) => ({ ok: true as const, value });

beforeEach(() => {
  fetchLeaderboardMock.mockReset().mockResolvedValue(ok(board));
});
afterEach(cleanup);

describe("the leaderboard", () => {
  // §15 requires the ranking rule stated in copy — it is the whole credibility
  // of the order, and a reader has no way to tell a ledger-ranked board from a
  // raw-insert one unless the page says which it is.
  it("states the add rule in its own copy", async () => {
    render(<LeaderboardScreen />);
    await screen.findByTestId("board-rows");
    expect(
      screen.getByText(/An add only counts once per trip, and only after the trip has dates/),
    ).toBeTruthy();
    expect(screen.getByText(/Copying your own day into your own trip does not count/)).toBeTruthy();
  });

  it("ranks on adds, not on days shared", async () => {
    render(<LeaderboardScreen />);
    const rows = await screen.findByTestId("board-rows");
    expect(
      within(rows).getAllByTestId("board-row").map((r) => r.getAttribute("data-user-id")),
    ).toEqual(["dev-bob", "dev-alice", "dev-carol"]);
    // dev-carol shares the most days and is last. If this ever passes with
    // carol first, the board has started ranking on post volume.
    expect(within(rows).getAllByTestId("board-row")[2]!.getAttribute("data-user-id")).toBe("dev-carol");
  });

  // Tinted and badged, never pinned. The exit gate names all three.
  it("tints and badges your own row without lifting it", async () => {
    render(<LeaderboardScreen />);
    const rows = await screen.findByTestId("board-rows");
    const mine = within(rows).getAllByTestId("board-row").find((r) => r.getAttribute("data-me") === "true")!;
    expect(mine.getAttribute("data-user-id")).toBe("dev-alice");
    // eslint-disable-next-line no-restricted-syntax -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    expect(mine.className).toContain("bg-brand-tint");
    expect(within(mine).getByText("You")).toBeTruthy();
    // Second, exactly where the ledger put it.
    expect(within(rows).getAllByTestId("board-row").indexOf(mine)).toBe(1);
  });

  it("has one way back, to Discover, and no empty state", async () => {
    render(<LeaderboardScreen />);
    await screen.findByTestId("board-rows");
    expect(screen.getByRole("link", { name: "← Discover" }).getAttribute("href")).toBe("/playbooks");
    // §15 rules an empty state out by construction: the board cannot be empty
    // while any day is shared, so there is nothing here to design.
    expect(screen.queryByText(/nobody/i)).toBeNull();
  });

  it("shows skeleton rows before the first answer", () => {
    fetchLeaderboardMock.mockReturnValue(new Promise(() => {}));
    render(<LeaderboardScreen />);
    expect(screen.getByTestId("board-skeleton")).toBeTruthy();
  });

  // A first read that FAILS leaves `loading` false and `data` null. The board
  // used to pulse skeleton rows forever under its own sync banner (CodeRabbit,
  // PR 102) — which reads as "still loading", not as "this did not work".
  it("stops pretending to load when the first read failed", async () => {
    fetchLeaderboardMock.mockResolvedValue({ ok: false, error: { status: 0, message: "Network error" } });
    render(<LeaderboardScreen />);
    await screen.findByText("The board could not be loaded");
    expect(screen.queryByTestId("board-skeleton")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Retry" })).toHaveLength(1);
  });

  it("offers a Retry when the board cannot be reached", async () => {
    fetchLeaderboardMock.mockResolvedValue({ ok: false, error: { status: 0, message: "Network error" } });
    render(<LeaderboardScreen />);
    // eslint-disable-next-line testing-library/prefer-find-by -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    await waitFor(() => expect(screen.getByTestId("library-sync-failure")).toBeTruthy());
    expect(within(screen.getByTestId("library-sync-failure")).getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});
