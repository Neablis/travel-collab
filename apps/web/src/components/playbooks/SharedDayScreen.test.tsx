import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SavedDay, SavedStop } from "@tc/contracts";
import type { PublicProfileResponse } from "@/lib/playbooks";

const fetchSavedDayMock = vi.fn();
const fetchPublicProfileMock = vi.fn();
const publishMock = vi.fn();
const unpublishMock = vi.fn();
const fetchTripsMock = vi.fn();
const insertSavedDayMock = vi.fn();
const pushMock = vi.fn();

vi.mock("@/lib/apiClient", () => ({
  fetchSavedDay: (...a: unknown[]) => fetchSavedDayMock(...a),
  fetchPublicProfile: (...a: unknown[]) => fetchPublicProfileMock(...a),
  publishSavedDay: (...a: unknown[]) => publishMock(...a),
  unpublishSavedDay: (...a: unknown[]) => unpublishMock(...a),
  fetchTrips: (...a: unknown[]) => fetchTripsMock(...a),
  insertSavedDay: (...a: unknown[]) => insertSavedDayMock(...a),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));

import { SharedDayScreen } from "./SharedDayScreen";

const DAY_ID = "aa000000-0000-4000-8000-000000000001";
const TRIP_ID = "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f";

function stop(over: Partial<SavedStop> = {}): SavedStop {
  return {
    title: "Fushimi Inari at opening",
    timeWindow: { start: "07:30", end: "09:30" },
    location: { name: "Fushimi Inari Taisha", city: "Kyoto" },
    notes: "Go before the coach parties.",
    anchors: [],
    kind: "planned",
    tags: [],
    cost: { amountMinor: 500, currency: "USD" },
    ...over,
  };
}

function savedDay(over: Partial<SavedDay> = {}): SavedDay {
  return {
    savedDayId: DAY_ID,
    ownerId: "dev-alice",
    name: "Kyoto temples on foot",
    stops: [stop(), stop({ title: "Tofuku-ji gardens", timeWindow: { start: "10:15", end: "11:30" }, notes: null, cost: { amountMinor: 1_800, currency: "USD" } })],
    cities: ["Kyoto"],
    visibility: "public",
    adds: 2,
    sourceTripId: "00000000-0000-4000-8000-00000000f000",
    sourceTripName: "Japan",
    createdAt: "2026-08-04T00:00:00.000Z",
    ...over,
  };
}

function profile(over: Partial<PublicProfileResponse["author"]> = {}): PublicProfileResponse {
  return {
    author: { userId: "dev-alice", displayName: "dev-alice", daysShared: 2, adds: 3, ...over },
    knows: [],
    days: [],
  };
}

const ok = <T,>(value: T) => ({ ok: true as const, value });

beforeEach(() => {
  fetchSavedDayMock.mockReset().mockResolvedValue(ok({ savedDay: savedDay(), isAuthor: false }));
  fetchPublicProfileMock.mockReset().mockResolvedValue(ok(profile()));
  publishMock.mockReset().mockResolvedValue(ok(savedDay({ visibility: "public" })));
  unpublishMock.mockReset().mockResolvedValue(ok(savedDay({ visibility: "private" })));
  fetchTripsMock.mockReset().mockResolvedValue(
    ok([{ tripId: TRIP_ID, name: "Japan", status: "active", members: [{ userId: "u", role: "owner", name: null, email: null }], createdAt: "2026-01-01T00:00:00.000Z" }]),
  );
  insertSavedDayMock.mockReset().mockResolvedValue(ok({ detail: {}, history: {} }));
  pushMock.mockReset();
});

afterEach(cleanup);

const renderDay = () =>
  render(<SharedDayScreen savedDayId={DAY_ID} backHref="/playbooks" backLabel="Discover" />);

describe("a shared day", () => {
  it("lists every stop with its notes and its city chip", async () => {
    renderDay();
    const list = await screen.findByTestId("stop-list");
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(within(list).getByText("Go before the coach parties.")).toBeTruthy();
    expect(within(list).getAllByText("Kyoto")).toHaveLength(2);
  });

  // The facts §15 names, minus the ones M12 owns.
  it("states the facts in the rail, derived from the stops", async () => {
    renderDay();
    const rail = await screen.findByTestId("day-facts");
    expect(within(rail).getByText("2")).toBeTruthy();
    expect(within(rail).getByText("$23.00")).toBeTruthy();
    expect(within(rail).getByText("Budget")).toBeTruthy();
    expect(within(rail).queryByText("Budget each")).toBeNull();
    expect(within(rail).getByText("2 trips")).toBeTruthy();
    // Season, and the month it was bucketed from — "Kept in August 2026" became
    // "Season: Summer · August 2026" (Mitchell, 2026-09-01). Both halves,
    // because Discover filters on the first and the second is the fact behind
    // it: a rail showing only the bucket makes the filter unexplainable.
    expect(within(rail).getByText("Summer · August 2026")).toBeTruthy();
    expect(within(rail).queryByText("Kept in")).toBeNull();
  });

  // M12's, and their absence is the milestone's decision rather than an
  // oversight — pinned so restoring them is a deliberate act.
  it("shows no rating, no histogram and no reviews", async () => {
    renderDay();
    await screen.findByTestId("day-facts");
    expect(screen.queryByText(/rating/i)).toBeNull();
    expect(screen.queryByText(/review/i)).toBeNull();
    expect(screen.queryByText(/star/i)).toBeNull();
  });

  it("credits the author with the profile's own numbers, and links to it", async () => {
    renderDay();
    const strip = await screen.findByTestId("author-strip");
    expect(within(strip).getByText("2 days shared · added to 3 trips")).toBeTruthy();
    // A readable handle, never the raw identifier — the link still CARRIES the
    // id, which is the distinction: `displayNameFor` decides what the link
    // says, not where it goes.
    expect(within(strip).getByRole("link", { name: "Alice" }).getAttribute("href")).toContain(
      "/playbooks/profile/dev-alice",
    );
    expect(within(strip).queryByText("dev-alice")).toBeNull();
    expect(fetchPublicProfileMock).toHaveBeenCalledWith("dev-alice");
  });

  // The report that started it: on your OWN day, the strip beside the Publish
  // button was your own account id. "You" is both shorter and the only thing
  // that reader needs (Mitchell, 2026-09-01).
  it("says You beside the Publish button on your own day", async () => {
    fetchSavedDayMock.mockResolvedValue(ok({ savedDay: savedDay(), isAuthor: true }));
    renderDay();
    const strip = await screen.findByTestId("author-strip");
    expect(within(strip).getByRole("link", { name: "You" })).toBeTruthy();
    expect(within(strip).getByRole("button", { name: "Unpublish" })).toBeTruthy();
  });

  it("offers Unpublish only to the author", async () => {
    renderDay();
    await screen.findByTestId("author-strip");
    expect(screen.queryByRole("button", { name: /unpublish/i })).toBeNull();

    cleanup();
    fetchSavedDayMock.mockResolvedValue(ok({ savedDay: savedDay(), isAuthor: true }));
    renderDay();
    const unpublish = await screen.findByRole("button", { name: "Unpublish" });
    // The baseline has to be taken AFTER the second render. The mock resets in
    // `beforeEach` only, and this test renders twice, so the count was already 2
    // before the click — `toBeGreaterThan(1)` held even if the screen patched
    // `visibility` locally and never re-read at all.
    const readsBeforeClick = fetchSavedDayMock.mock.calls.length;
    await userEvent.click(unpublish);
    await waitFor(() => expect(unpublishMock).toHaveBeenCalledWith(DAY_ID));
    // Re-read rather than patched locally: publishing moves a number the author
    // strip gets from the server.
    await waitFor(() =>
      expect(fetchSavedDayMock.mock.calls.length).toBeGreaterThan(readsBeforeClick),
    );
  });

  it("says Publish on the author's own private day", async () => {
    fetchSavedDayMock.mockResolvedValue(
      ok({ savedDay: savedDay({ visibility: "private" }), isAuthor: true }),
    );
    renderDay();
    expect(await screen.findByRole("button", { name: "Publish" })).toBeTruthy();
    expect(screen.getByText("Private")).toBeTruthy();
  });

  it("adds to a chosen trip through the real insert path, then goes to it", async () => {
    renderDay();
    await userEvent.click(await screen.findByRole("button", { name: "Add to a trip" }));
    await screen.findByLabelText("Which trip");
    await userEvent.click(screen.getByRole("button", { name: "Add to trip" }));
    await waitFor(() => expect(insertSavedDayMock).toHaveBeenCalledWith(TRIP_ID, DAY_ID));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith(`/trips/${TRIP_ID}`));
  });

  // The dialog stays mounted between openings, so the trip it remembers can
  // have been deleted since. It used to keep the id anyway — a select with no
  // matching option, and an Add that posted a dead trip id whose 404 this
  // screen then reported as "the day was withdrawn" (CodeRabbit, PR 102).
  it("drops a remembered trip that is no longer in the list", async () => {
    const OTHER_TRIP = "9c2f1b44-1c9e-4a2c-8c7a-3d5e6f7a8b9c";
    renderDay();
    await userEvent.click(await screen.findByRole("button", { name: "Add to a trip" }));
    await screen.findByLabelText("Which trip");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    // Japan is gone; only a trip this dialog has never seen remains.
    fetchTripsMock.mockResolvedValue(
      ok([{ tripId: OTHER_TRIP, name: "Peru", status: "active", members: [{ userId: "u", role: "owner", name: null, email: null }], createdAt: "2026-01-01T00:00:00.000Z" }]),
    );
    await userEvent.click(screen.getByRole("button", { name: "Add to a trip" }));
    const select = await screen.findByLabelText("Which trip");
    expect((select as HTMLSelectElement).value).toBe(OTHER_TRIP);

    await userEvent.click(screen.getByRole("button", { name: "Add to trip" }));
    await waitFor(() => expect(insertSavedDayMock).toHaveBeenCalledWith(OTHER_TRIP, DAY_ID));
  });

  // Project rule 6, the conflict half for this route: the author withdrew the
  // day while the dialog was open. Reported in place, never as a modal.
  it("says the day was withdrawn when the insert 404s", async () => {
    insertSavedDayMock.mockResolvedValue({ ok: false, error: { status: 404, message: "gone" } });
    renderDay();
    await userEvent.click(await screen.findByRole("button", { name: "Add to a trip" }));
    await screen.findByLabelText("Which trip");
    await userEvent.click(screen.getByRole("button", { name: "Add to trip" }));
    expect(await screen.findByTestId("day-withdrawn")).toBeTruthy();
    expect(pushMock).not.toHaveBeenCalled();
  });

  // A private day of somebody else's and a day that never existed are the same
  // 404 by design, so the copy cannot claim to know which.
  it("offers a way back rather than an error when the day is not readable", async () => {
    fetchSavedDayMock.mockResolvedValue({ ok: false, error: { status: 404, message: "not-found" } });
    renderDay();
    expect(await screen.findByText("This day is not in the library")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to Discover" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("returns to wherever it was entered from", async () => {
    render(
      <SharedDayScreen savedDayId={DAY_ID} backHref="/playbooks/board" backLabel="Who shares the most" />,
    );
    expect(
      (await screen.findByRole("link", { name: "← Who shares the most" })).getAttribute("href"),
    ).toBe("/playbooks/board");
  });

  it("renders a day whose stops have all been removed", async () => {
    fetchSavedDayMock.mockResolvedValue(ok({ savedDay: savedDay({ stops: [] }), isAuthor: false }));
    renderDay();
    expect(await screen.findByText("This day has nothing on it")).toBeTruthy();
  });
});
