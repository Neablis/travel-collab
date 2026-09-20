import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tripDetailFixture } from "@tc/factories";

const TRIP_ID = "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f";

// `fetchPages` is mocked rather than served through MSW because these tests are
// about what this LENS does across two attempts — the outcome has to differ
// between the first call and the second, which is the whole claim.
const fetchPagesMock = vi.fn();
vi.mock("@/lib/pagesClient", async (orig) => {
  const actual = await orig<typeof import("@/lib/pagesClient")>();
  return { ...actual, fetchPages: (...args: unknown[]) => fetchPagesMock(...args) };
});

vi.mock("@/lib/apiClient", async (orig) => {
  const actual = await orig<typeof import("@/lib/apiClient")>();
  return { ...actual, fetchTripGlobals: async () => ({ ok: false, error: { status: 0, message: "no" } }) };
});

import { OverviewLens } from "./OverviewLens";

afterEach(cleanup);
beforeEach(() => {
  fetchPagesMock.mockReset();
});

const failed = { ok: false as const, error: { status: 500, message: "boom" } };

// M26 link 7, §3b: **a failed region retries in place.** This had the message
// and no control at all, so a reader whose Overview failed could only leave the
// tab — the dead end §3b forbids.
describe("OverviewLens — a failed load", () => {
  it("offers a retry rather than leaving the reader stuck", async () => {
    fetchPagesMock.mockResolvedValue(failed);
    render(<OverviewLens detail={tripDetailFixture()} tripId={TRIP_ID} />);

    expect(await screen.findByText(/Couldn't load this trip's Overview/i)).toBeTruthy();
    expect(screen.getByTestId("overview-retry")).toBeTruthy();
  });

  // The assertion that makes this more than a button: the retry must re-run
  // the SAME read. `cachedRead` never stores a failure (queryCache.ts:189
  // says so in as many words), so the second attempt really does reach the
  // network rather than replaying the cached error.
  it("re-runs the read, and recovers when the second attempt succeeds", async () => {
    fetchPagesMock.mockResolvedValueOnce(failed);
    render(<OverviewLens detail={tripDetailFixture()} tripId={TRIP_ID} />);
    await screen.findByTestId("overview-retry");
    expect(fetchPagesMock).toHaveBeenCalledTimes(1);

    // The second attempt finds no Overview page, which is a DIFFERENT and
    // real terminal state — enough to prove the read ran again without
    // dragging a whole page document into this test.
    fetchPagesMock.mockResolvedValue({ ok: true as const, value: { pages: [] } });
    fireEvent.click(screen.getByTestId("overview-retry"));

    await waitFor(() => expect(fetchPagesMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/This trip has no Overview page/i)).toBeTruthy();
  });
});
