import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tripDetailFixture } from "@tc/factories";

const TRIP_ID = "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f";

// `fetchPages` is mocked rather than served through MSW because these tests are
// about what this LENS does across two attempts — the outcome has to differ
// between the first call and the second, which is the whole claim.
const fetchPagesMock = vi.fn();
// `fetchPage` (the DOCUMENT, singular) is mocked too, and only the re-read
// suite at the bottom gives it behaviour — every other test here fails or
// hangs at `fetchPages` and never reaches it.
//
// It earns its own mock because it is the field that actually goes stale when
// a co-traveller edits: the summary list can be byte-identical while the
// CONTENT changed, so asserting on `fetchPages` alone leaves the thing
// Mitchell reported uncovered.
const fetchPageMock = vi.fn();
vi.mock("@/lib/pagesClient", async (orig) => {
  const actual = await orig<typeof import("@/lib/pagesClient")>();
  return {
    ...actual,
    fetchPages: (...args: unknown[]) => fetchPagesMock(...args),
    fetchPage: (...args: unknown[]) => fetchPageMock(...args),
  };
});

vi.mock("@/lib/apiClient", async (orig) => {
  const actual = await orig<typeof import("@/lib/apiClient")>();
  return { ...actual, fetchTripGlobals: async () => ({ ok: false, error: { status: 0, message: "no" } }) };
});

import { OverviewLens } from "./OverviewLens";

afterEach(cleanup);
beforeEach(() => {
  fetchPagesMock.mockReset();
  fetchPageMock.mockReset();
});

const failed = { ok: false as const, error: { status: 500, message: "boom" } };

// A real, cacheable answer. `cachedRead` stores only `ok: true`, so the
// re-read suite at the bottom of this file needs one or its cache stays empty
// and its claim evaporates.
const OVERVIEW_PAGE_ID = "3f5a1c22-9b4e-4d77-8a21-5c6d7e8f9a01";
const okPages = {
  ok: true as const,
  value: {
    pages: [
      {
        id: OVERVIEW_PAGE_ID,
        tripId: TRIP_ID,
        title: "Trip Overview",
        context: { tripId: TRIP_ID, kind: "overview" as const },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        actorId: "system",
      },
    ],
    viewerId: "u1",
  },
};

const okPageDoc = (text: string) => ({
  ok: true as const,
  value: {
    id: OVERVIEW_PAGE_ID,
    tripId: TRIP_ID,
    title: "Trip Overview",
    context: { tripId: TRIP_ID, kind: "overview" as const },
    content: { v: 1, type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    actorId: "system",
  },
});

// M26 link 7, §3b: **a failed region retries in place.** This had the message
// and no control at all, so a reader whose Overview failed could only leave the
// tab — the dead end §3b forbids.
describe("OverviewLens — a failed load", () => {
  it("offers a retry rather than leaving the reader stuck", async () => {
    fetchPagesMock.mockResolvedValue(failed);
    render(<OverviewLens detail={tripDetailFixture()} tripId={TRIP_ID} />);

    expect(await screen.findByText(/Couldn't load this trip's Overview/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    // The failure reads as a region's, not the page's — §3b's whole point.
    expect(screen.getByText(/the trip itself is fine/i)).toBeTruthy();
  });

  // The assertion that makes this more than a button: the retry must re-run
  // the SAME read. `cachedRead` never stores a failure (queryCache.ts:189
  // says so in as many words), so the second attempt really does reach the
  // network rather than replaying the cached error.
  it("re-runs the read, and recovers when the second attempt succeeds", async () => {
    fetchPagesMock.mockResolvedValueOnce(failed);
    render(<OverviewLens detail={tripDetailFixture()} tripId={TRIP_ID} />);
    await screen.findByTestId("overview-error");
    expect(fetchPagesMock).toHaveBeenCalledTimes(1);

    // The second attempt finds no Overview page, which is a DIFFERENT and
    // real terminal state — enough to prove the read ran again without
    // dragging a whole page document into this test.
    fetchPagesMock.mockResolvedValue({ ok: true as const, value: { pages: [] } });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(fetchPagesMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/This trip has no Overview page/i)).toBeTruthy();
  });
});

// §3b's first rule: "a page's chrome and primary actions are real from the
// first frame and never placeholdered". Overview's one primary action was
// built inside the `ready` branch, so it was missing from exactly the two
// states a reader most needs a way out of.
describe("OverviewLens — the chrome does not wait for the data", () => {
  it("offers Edit while the page is still arriving", () => {
    fetchPagesMock.mockReturnValue(new Promise(() => {}));
    render(<OverviewLens detail={tripDetailFixture()} tripId={TRIP_ID} />);

    // Before the summary lands there is no page id, so it points at the
    // Notebook index — which lists this page. One click further, never wrong.
    const link = screen.getByRole("link", { name: "Edit" });
    expect(link.getAttribute("href")).toBe(`/trips/${TRIP_ID}/pages`);
    // And the body is a placeholder, not a sentence: the region's own label.
    expect(screen.getByRole("status", { name: "Loading the Overview" })).toBeTruthy();
  });

  it("still offers it after the read fails", async () => {
    fetchPagesMock.mockResolvedValue(failed);
    render(<OverviewLens detail={tripDetailFixture()} tripId={TRIP_ID} />);

    await screen.findByTestId("overview-error");
    expect(screen.getByRole("link", { name: "Edit" })).toBeTruthy();
  });
});

// M27 D6. A trip of its own, because `cachedRead` keeps an ok answer and the
// re-read suite below counts reads against `TRIP_ID`'s cache.
describe("OverviewLens — Edit, once the page is known", () => {
  const OWN_TRIP = "0b1c2d3e-4f50-4617-8a9b-0c1d2e3f4a5b";
  const ownPages = {
    ...okPages,
    value: { ...okPages.value, pages: okPages.value.pages.map((p) => ({ ...p, tripId: OWN_TRIP })) },
  };

  // The page opens in Editing and its first crumb comes back here by name —
  // both read `?from=overview` (PageScreen). Without it the Edit button would
  // land the reader in Reading, one more click from what they asked for.
  it("opens the page for editing, saying it came from Overview", async () => {
    fetchPagesMock.mockResolvedValue(ownPages);
    fetchPageMock.mockResolvedValue(okPageDoc("Dear crew"));
    render(<OverviewLens detail={tripDetailFixture()} tripId={OWN_TRIP} />);

    expect(await screen.findByText("Dear crew")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Edit" }).getAttribute("href")).toBe(
      `/trips/${OWN_TRIP}/pages/${OVERVIEW_PAGE_ID}?from=overview`,
    );
  });

  // Before M27 a viewer saw Edit too, and it led to a page they could only
  // read. The letter is still theirs to read; only the action goes.
  it("offers no Edit to a viewer", async () => {
    fetchPagesMock.mockResolvedValue(ownPages);
    fetchPageMock.mockResolvedValue(okPageDoc("Dear crew"));
    render(<OverviewLens detail={tripDetailFixture()} tripId={OWN_TRIP} readOnly />);

    expect(await screen.findByText("Dear crew")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Edit" })).toBeNull();
    expect(screen.getByText("Overview")).toBeTruthy();
  });
});

// **The reported bug's last mile.** Mitchell, 2026-09-22: two devices, one
// editing the Overview notebook, the other sat on this tab and never seeing it
// until a refresh. Three things were wrong; the first two were server-side
// (page writes did not reach the event log, so the poll had nothing to notice)
// and this is the third — the lens read its page once on mount and never
// looked again.
describe("OverviewLens — a co-traveller's edit arrives without a reload", () => {
  // **A SUCCESSFUL first read, and that is what makes this test mean anything.**
  // `cachedRead` only ever stores `ok: true`, so a failing mock leaves the
  // cache empty and the second read reaches the loader whether or not anything
  // was invalidated — which made an earlier version of this test pass with the
  // invalidation deleted. With a cached first answer, the re-read happens only
  // because the lens drops the entry first.
  it("re-reads when the poll reports the trip moved, past a warm cache", async () => {
    fetchPagesMock.mockResolvedValue(okPages);
    fetchPageMock.mockResolvedValue(okPageDoc("before"));
    const detail = tripDetailFixture();
    const { rerender } = render(<OverviewLens detail={detail} tripId={TRIP_ID} remoteRevision={0} />);
    await waitFor(() => expect(fetchPagesMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(fetchPageMock).toHaveBeenCalledTimes(1));

    fetchPageMock.mockResolvedValue(okPageDoc("after"));
    rerender(<OverviewLens detail={detail} tripId={TRIP_ID} remoteRevision={1} />);
    await waitFor(() => expect(fetchPagesMock).toHaveBeenCalledTimes(2));
    // **The document, not just the list.** A co-traveller's edit changes the
    // content while the summary can stay identical, so this is the assertion
    // that covers what was actually reported.
    await waitFor(() => expect(fetchPageMock).toHaveBeenCalledTimes(2));
  });

  // The other half, and the one that stops this being a re-read on every
  // render: the effect is keyed on the COUNTER changing, not on the provider
  // handing down a new object. `TripProvider` re-renders this tree on every
  // poll tick whether or not anything moved.
  it("does not re-read when nothing moved", async () => {
    fetchPagesMock.mockResolvedValue(okPages);
    const detail = tripDetailFixture();
    const { rerender } = render(<OverviewLens detail={detail} tripId={TRIP_ID} remoteRevision={3} />);
    await waitFor(() => expect(fetchPagesMock).toHaveBeenCalledTimes(1));

    rerender(<OverviewLens detail={{ ...detail }} tripId={TRIP_ID} remoteRevision={3} />);
    rerender(<OverviewLens detail={{ ...detail }} tripId={TRIP_ID} remoteRevision={3} />);
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchPagesMock).toHaveBeenCalledTimes(1);
  });
});
