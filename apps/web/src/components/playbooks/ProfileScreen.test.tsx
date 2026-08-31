import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscoverDay, PublicProfileResponse } from "@/lib/playbooks";

const fetchPublicProfileMock = vi.fn();
vi.mock("@/lib/apiClient", () => ({
  fetchPublicProfile: (...a: unknown[]) => fetchPublicProfileMock(...a),
}));

import { ProfileScreen } from "./ProfileScreen";
import { backQuery, backTarget } from "./backLink";

function day(over: Partial<DiscoverDay> = {}): DiscoverDay {
  return {
    savedDayId: "aa000000-0000-4000-8000-000000000001",
    ownerId: "dev-alice",
    name: "Kyoto temples on foot",
    cities: ["Kyoto"],
    matchedCities: [],
    stopCount: 4,
    window: { start: "07:30", end: "18:30" },
    budgetPerPerson: { amountMinor: 2_700, currency: "USD" },
    adds: 2,
    visibility: "public",
    sourceTripName: "Japan",
    createdAt: "2026-08-01T00:00:00.000Z",
    publishedAt: "2026-08-02T00:00:00.000Z",
    isMine: false,
    ...over,
  };
}

const profile: PublicProfileResponse = {
  author: { userId: "dev-alice", displayName: "dev-alice", daysShared: 2, adds: 3 },
  knows: [
    { city: "Kyoto", days: 2 },
    { city: "Hakone", days: 1 },
  ],
  days: [day(), day({ savedDayId: "aa000000-0000-4000-8000-000000000002", name: "Tokyo to Hakone", adds: 1 })],
};

const ok = <T,>(value: T) => ({ ok: true as const, value });

beforeEach(() => {
  fetchPublicProfileMock.mockReset().mockResolvedValue(ok(profile));
});
afterEach(cleanup);

const renderProfile = (from?: string) =>
  render(<ProfileScreen userId="dev-alice" back={backTarget({ from })} />);

describe("a public profile", () => {
  // Derived, never authored: every number comes off the same endpoint that
  // produces Discover's cards, and the numbers on screen have to add up
  // against the cards below them.
  it("shows numbers that agree with the days it lists", async () => {
    renderProfile();
    await screen.findByTestId("profile-numbers");
    expect(screen.getByTestId("profile-number-days-shared").textContent).toBe("2Days shared");
    expect(screen.getByTestId("profile-number-added-to-trips").textContent).toBe("3Added to trips");

    const cards = within(screen.getByTestId("profile-days")).getAllByTestId("discover-card");
    expect(cards).toHaveLength(profile.author.daysShared);
    // Both sides RENDERED. This used to sum the fixture and compare it to the
    // fixture, which held whatever the fixture said and never touched the page
    // (CodeRabbit, PR 102) — the agreement being claimed is between the
    // headline number and the cards under it, so both have to be read off the
    // screen.
    const addsOnCards = cards.map((card) => {
      const shown = /Added to (\d+) trips?/.exec(card.textContent ?? "");
      expect(shown, `a card does not say how often it was added: ${card.textContent}`).not.toBeNull();
      return Number(shown![1]);
    });
    expect(addsOnCards).toHaveLength(2);
    expect(addsOnCards.reduce((sum, n) => sum + n, 0)).toBe(
      Number(screen.getByTestId("profile-number-added-to-trips").textContent!.replace(/\D+$/, "")),
    );
  });

  // The day list is a PAGE (`discoverDays` caps it), and `daysShared` counts
  // every published day. When they disagree the page says which it is showing
  // rather than letting the card count read as the total.
  it("says so when it is showing fewer days than the person has shared", async () => {
    fetchPublicProfileMock.mockResolvedValue(
      ok({ ...profile, author: { ...profile.author, daysShared: 30 } }),
    );
    renderProfile();
    expect((await screen.findByTestId("profile-day-page")).textContent).toBe(
      "Showing the 2 newest of 30 days shared.",
    );
  });

  it("says nothing about paging when every shared day is on the page", async () => {
    renderProfile();
    await screen.findByTestId("profile-days");
    expect(screen.queryByTestId("profile-day-page")).toBeNull();
  });

  // A first read that FAILS leaves `loading` false and `data` null. The page
  // used to sit under its own sync banner pulsing a skeleton at a profile that
  // was never coming (CodeRabbit, PR 102).
  it("stops pretending to load when the first read failed", async () => {
    fetchPublicProfileMock.mockResolvedValue({ ok: false, error: { status: 0, message: "Network error" } });
    renderProfile();
    await screen.findByText("This profile could not be loaded");
    expect(screen.queryByTestId("profile-skeleton")).toBeNull();
    // The Retry is the banner's, and there is exactly one of it.
    expect(screen.getAllByRole("button", { name: "Retry" })).toHaveLength(1);
  });

  it("shows the skeleton only while the first read is still in flight", () => {
    fetchPublicProfileMock.mockReturnValue(new Promise(() => {}));
    renderProfile();
    expect(screen.getByTestId("profile-skeleton")).toBeTruthy();
  });

  // §15: no bio, no follow, no avatar, no public user record — and no rating
  // or reviews-received, which are M12's.
  it("has no bio, follow, avatar, rating or review count", async () => {
    renderProfile();
    await screen.findByTestId("profile-numbers");
    expect(screen.queryByRole("button", { name: /follow/i })).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByText(/rating/i)).toBeNull();
    expect(screen.queryByText(/review/i)).toBeNull();
  });

  // A way INTO the library rather than a dead end: the chip is a real Discover
  // search scoped to that city, not a filter on this page's own list.
  it("turns a Knows chip into a scoped Discover search", async () => {
    renderProfile();
    const knows = await screen.findByTestId("knows-cities");
    expect(within(knows).getByRole("link", { name: "Kyoto · 2" }).getAttribute("href")).toBe(
      "/playbooks?city=Kyoto",
    );
  });

  it("comes back to wherever it was entered from", async () => {
    renderProfile("board");
    expect((await screen.findByRole("link", { name: "← Who shares the most" })).getAttribute("href")).toBe(
      "/playbooks/board",
    );
    cleanup();
    renderProfile();
    expect((await screen.findByRole("link", { name: "← Discover" })).getAttribute("href")).toBe("/playbooks");
  });

  it("says plainly when somebody has shared nothing", async () => {
    fetchPublicProfileMock.mockResolvedValue(
      ok({ author: { userId: "dev-dan", displayName: "dev-dan", daysShared: 0, adds: 0 }, knows: [], days: [] }),
    );
    renderProfile();
    expect(await screen.findByText("Nothing shared yet")).toBeTruthy();
  });

  it("offers a Retry when the profile cannot be reached", async () => {
    fetchPublicProfileMock.mockResolvedValue({ ok: false, error: { status: 0, message: "Network error" } });
    renderProfile();
    await waitFor(() => expect(screen.getByTestId("library-sync-failure")).toBeTruthy());
  });
});

describe("the contextual back link", () => {
  // Read from the query string rather than from history: `router.back()`
  // returns to wherever the browser was, which after a reload or a pasted link
  // is not the page the label claims.
  it("returns to the day it was opened from", () => {
    expect(backTarget({ from: "day", day: "abc" })).toEqual({
      href: "/playbooks/day/abc",
      label: "the day",
    });
  });

  it("returns to the profile it was opened from", () => {
    expect(backTarget({ from: "profile", profile: "dev-alice" })).toEqual({
      href: "/playbooks/profile/dev-alice",
      label: "the profile",
    });
  });

  it("falls back to Discover for anything it does not recognise", () => {
    for (const from of [undefined, null, "", "nonsense", "day", "profile"]) {
      expect(backTarget({ from })).toEqual({ href: "/playbooks", label: "Discover" });
    }
  });

  // The write half. A card on a profile has to hand the day route the origin
  // that route reads back, and the two used to be spelled at opposite ends of
  // the codebase with nothing tying them together.
  it("round-trips an origin from the link that carries it", () => {
    expect(backQuery({ from: "profile", profile: "dev-alice" })).toBe(
      "?from=profile&profile=dev-alice",
    );
    const params = new URLSearchParams(backQuery({ from: "profile", profile: "dev alice" }));
    expect(backTarget({ from: params.get("from"), profile: params.get("profile") })).toEqual({
      href: "/playbooks/profile/dev%20alice",
      label: "the profile",
    });
  });

  it("sends a day link on a profile back to that profile, not to Discover", async () => {
    renderProfile();
    const days = await screen.findByTestId("profile-days");
    const link = within(days).getByRole("link", { name: "Kyoto temples on foot" });
    expect(link.getAttribute("href")).toBe(
      "/playbooks/day/aa000000-0000-4000-8000-000000000001?from=profile&profile=dev-alice",
    );
  });
});
