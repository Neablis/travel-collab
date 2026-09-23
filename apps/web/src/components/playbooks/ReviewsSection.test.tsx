import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { REVIEW_NOTE_MAX, type Review, type ReviewSummary } from "@tc/contracts";
import { makeReportHandlers, makeReviewsHandlers } from "@/mocks/handlers";
import { ReviewRail } from "./ReviewRail";
import { ReviewConflictBanner, ReviewsSection } from "./ReviewsSection";
import { holdReview } from "./reviewQueue";
import { useDayReviews } from "./useDayReviews";

// M12 links 3, 4 and 6 — the shared day's review states, against the MSW
// reviews route (which recounts its summary from its rows on every call, the
// way the real one does). The screen's own test covers WHERE these mount; this
// one covers what they do.

const DAY = "aa000000-0000-4000-8000-000000000001";
const SEEN = "2026-09-01T00:00:00.000Z";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  server.events.removeAllListeners();
  vi.restoreAllMocks();
});
afterAll(() => server.close());

function review(over: Partial<Review> = {}): Review {
  return {
    savedDayId: DAY,
    reviewerId: "dev-mei",
    reviewerDisplayName: "Mei Tanaka",
    stars: 5,
    note: "Go before the coach parties.",
    createdAt: "2026-09-10T00:00:00.000Z",
    updatedAt: "2026-09-10T00:00:00.000Z",
    isMine: false,
    ...over,
  };
}

/** Every request the section makes, as `METHOD body` — what it SENT is the assertion. */
function record(): { method: string; body: unknown }[] {
  const seen: { method: string; body: unknown }[] = [];
  server.events.on("request:start", async ({ request }) => {
    const body = request.method === "GET" ? null : await request.clone().json().catch(() => null);
    seen.push({ method: request.method, body });
  });
  return seen;
}

/** What `SharedDayScreen` wires, minus the day around it. */
function Harness({ publishedAt }: { publishedAt?: string | null }) {
  const reviews = useDayReviews(DAY, publishedAt);
  return (
    <>
      <ReviewConflictBanner reviews={reviews} />
      {reviews.data !== null && <ReviewRail summary={reviews.data.summary} />}
      <ReviewsSection reviews={reviews} savedDayId={DAY} canReview />
    </>
  );
}

function setOnline(online: boolean) {
  vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(online);
}

async function reconnect() {
  setOnline(true);
  await act(async () => {
    window.dispatchEvent(new Event("online"));
  });
}

async function rate(stars: number, note = "") {
  await userEvent.click(await screen.findByRole("button", { name: stars === 1 ? "1 star" : `${stars} stars` }));
  if (note !== "") await userEvent.type(screen.getByLabelText("Your note"), note);
}

describe("the rating rail", () => {
  const summary = (over: Partial<ReviewSummary>): ReviewSummary => ({
    average: 4.5,
    count: 4,
    histogram: { 1: 0, 2: 0, 3: 1, 4: 0, 5: 3 },
    ...over,
  });

  it("states the average, the count and a 5→1 histogram when the day is rated", () => {
    render(<ReviewRail summary={summary({})} />);
    expect(screen.getByTestId("rating-average").textContent).toBe("4.5");
    expect(screen.getByTestId("review-count").textContent).toBe("4 reviews");
    const bars = within(screen.getByTestId("rating-histogram")).getAllByRole("listitem");
    expect(bars.map((b) => b.getAttribute("aria-label"))).toEqual([
      "5 stars: 3",
      "4 stars: 0",
      "3 stars: 1",
      "2 stars: 0",
      "1 star: 0",
    ]);
  });

  // A null average is the contract's "nobody has rated this"; a 0.0 would be
  // a claim nobody made.
  it("says it is unrated, with no number and no histogram, when nobody has reviewed it", () => {
    render(<ReviewRail summary={summary({ average: null, count: 0, histogram: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } })} />);
    expect(screen.getByText("Unrated so far — nobody has run it and come back.")).toBeTruthy();
    expect(screen.queryByTestId("rating-average")).toBeNull();
    expect(screen.queryByTestId("rating-histogram")).toBeNull();
  });
});

describe("posting a review", () => {
  it("shows the empty state before anyone has rated the day", async () => {
    server.use(...makeReviewsHandlers(DAY, []));
    render(<Harness />);
    expect(await screen.findByTestId("reviews-empty")).toBeTruthy();
    expect(screen.getByTestId("review-meta").textContent).toBe("nothing yet");
  });

  // §15: "posting recomputes the average live" — from the PUT's own summary,
  // not a re-read. Only one GET may be seen.
  it("moves the average from the post's own answer, without reading again", async () => {
    server.use(...makeReviewsHandlers(DAY, [review({ stars: 5 })]));
    const seen = record();
    render(<Harness />);
    expect((await screen.findByTestId("rating-average")).textContent).toBe("5.0");

    await rate(1);
    await userEvent.click(screen.getByRole("button", { name: "Post" }));

    await waitFor(() => expect(screen.getByTestId("rating-average").textContent).toBe("3.0"));
    expect(screen.getByTestId("review-count").textContent).toBe("2 reviews");
    expect(seen.filter((r) => r.method === "GET")).toHaveLength(1);
    expect(seen.filter((r) => r.method === "PUT").map((r) => r.body)).toEqual([{ stars: 1, note: null }]);
  });

  // One review per person per day: "Change it" reopens the form prefilled, and
  // the second post REPLACES the first rather than adding a row.
  it("treats a second post as an update to the same review", async () => {
    server.use(...makeReviewsHandlers(DAY, [review({ stars: 5 })]));
    render(<Harness />);
    await rate(4, "Worth it.");
    await userEvent.click(screen.getByRole("button", { name: "Post" }));
    expect((await screen.findByTestId("review-done")).textContent).toBe("You rated this 4 stars.");

    await userEvent.click(screen.getByRole("button", { name: "Change it" }));
    expect((screen.getByLabelText("Your note") as HTMLInputElement).value).toBe("Worth it.");
    await rate(2);
    await userEvent.click(screen.getByRole("button", { name: "Post" }));

    expect((await screen.findByTestId("review-done")).textContent).toBe("You rated this 2 stars.");
    const rows = screen.getAllByTestId("review-row");
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => within(r).queryByText("Yours") !== null)).toHaveLength(1);
    expect(screen.getByTestId("rating-average").textContent).toBe("3.5");
  });

  // M12's gate box: refused, not truncated. The design's `slice(0, 140)` is
  // exactly the silent truncation it forbids.
  it("refuses a note over the cap instead of cutting it, and sends nothing", async () => {
    server.use(...makeReviewsHandlers(DAY, []));
    const seen = record();
    render(<Harness />);
    await rate(3);
    const long = "x".repeat(REVIEW_NOTE_MAX + 1);
    fireEvent.change(screen.getByLabelText("Your note"), { target: { value: long } });

    expect((screen.getByLabelText("Your note") as HTMLInputElement).value).toBe(long);
    expect(screen.getByTestId("note-count").textContent).toBe("1 over");
    const post = screen.getByRole("button", { name: "Post" }) as HTMLButtonElement;
    expect(post.disabled).toBe(true);
    await userEvent.click(post);
    expect(seen.filter((r) => r.method === "PUT")).toHaveLength(0);
  });

  it("says so when the server refuses the review", async () => {
    server.use(...makeReviewsHandlers(DAY, []));
    // A later `use` is matched first — within one call, the earlier handler wins.
    server.use(
      http.put("/api/saved-days/:savedDayId/reviews", () => HttpResponse.json({ error: "invalid-review" }, { status: 400 })),
    );
    render(<Harness />);
    await rate(3, "fine");
    await userEvent.click(screen.getByRole("button", { name: "Post" }));
    expect((await screen.findByRole("alert")).textContent).toContain("a note can be at most 140 characters");
    expect(screen.queryByTestId("review-done")).toBeNull();
  });
});

describe("offline, and the conflict it can come back to", () => {
  it("holds a review written offline, badged Queued, and posts it on reconnect", async () => {
    setOnline(false);
    server.use(...makeReviewsHandlers(DAY, [review({ stars: 5 })]));
    const seen = record();
    render(<Harness publishedAt={SEEN} />);
    expect(await screen.findByText(/You are offline — this will be held on your device/)).toBeTruthy();

    await rate(3, "Ferry was late.");
    await userEvent.click(screen.getByRole("button", { name: "Hold until online" }));

    expect((await screen.findByTestId("review-done")).textContent).toBe("Your 3-star review is waiting to send.");
    const queued = screen.getAllByTestId("review-row").find((r) => within(r).queryByText("Queued") !== null);
    expect(queued).toBeTruthy();
    // Held, not counted: the rail is still the server's.
    expect(screen.getByTestId("rating-average").textContent).toBe("5.0");
    expect(seen.filter((r) => r.method === "PUT")).toHaveLength(0);

    await reconnect();

    expect(await screen.findByText("Yours")).toBeTruthy();
    expect(screen.queryByText("Queued")).toBeNull();
    expect(screen.getByTestId("rating-average").textContent).toBe("4.0");
    expect(seen.filter((r) => r.method === "PUT").map((r) => r.body)).toEqual([
      { stars: 3, note: "Ferry was late.", seenPublishedAt: SEEN },
    ]);
  });

  it("posts a review held from an earlier visit as soon as the page opens online", async () => {
    holdReview(DAY, { stars: 4, note: null, heldAt: "2026-09-22T00:00:00.000Z" });
    server.use(...makeReviewsHandlers(DAY, []));
    render(<Harness />);
    expect(await screen.findByText("Yours")).toBeTruthy();
    expect(screen.getByTestId("rating-average").textContent).toBe("4.0");
  });

  // What `SharedDayScreen` does today: its read carries no `publishedAt`. The
  // flush must then ask for NO check. A `null` would mean "I saw it
  // unpublished", and the server would refuse every held review with a 409.
  it("asks for no staleness check when the page never knew the publish time", async () => {
    setOnline(false);
    server.use(...makeReviewsHandlers(DAY, [], { publishedAt: "2026-09-20T00:00:00.000Z" }));
    const seen = record();
    render(<Harness />);
    await rate(4);
    await userEvent.click(await screen.findByRole("button", { name: "Hold until online" }));
    await reconnect();
    expect(await screen.findByText("Yours")).toBeTruthy();
    expect(seen.filter((r) => r.method === "PUT").map((r) => r.body)).toEqual([{ stars: 4, note: null }]);
  });

  // §15's conflict state. The day was republished after the review was written
  // offline, so the flush is refused and the review stays held until the
  // person decides — never silently posted, never silently dropped.
  it("stops on a day changed since the review was written, and lets the person post it anyway", async () => {
    setOnline(false);
    server.use(
      ...makeReviewsHandlers(DAY, [], {
        publishedAt: "2026-09-20T00:00:00.000Z",
        authorDisplayName: "Mei Tanaka",
      }),
    );
    const seen = record();
    render(<Harness publishedAt={SEEN} />);
    await rate(2);
    await userEvent.click(await screen.findByRole("button", { name: "Hold until online" }));
    await reconnect();

    const banner = await screen.findByTestId("review-conflict");
    expect(banner.textContent).toContain("Mei Tanaka changed this day");
    expect(screen.getByText("Queued")).toBeTruthy();

    await userEvent.click(within(banner).getByRole("button", { name: "Post it anyway" }));

    expect(await screen.findByText("Yours")).toBeTruthy();
    expect(screen.queryByTestId("review-conflict")).toBeNull();
    // The first carried the publish time it was written against; "anyway" is
    // the same review with the check dropped.
    expect(seen.filter((r) => r.method === "PUT").map((r) => r.body)).toEqual([
      { stars: 2, note: null, seenPublishedAt: SEEN },
      { stars: 2, note: null },
    ]);
  });

  it("drops a conflicted review when the person discards it", async () => {
    holdReview(DAY, { stars: 2, note: null, seenPublishedAt: SEEN, heldAt: "2026-09-22T00:00:00.000Z" });
    server.use(...makeReviewsHandlers(DAY, [], { publishedAt: "2026-09-20T00:00:00.000Z" }));
    render(<Harness publishedAt={SEEN} />);
    const banner = await screen.findByTestId("review-conflict");
    await userEvent.click(within(banner).getByRole("button", { name: "Discard it" }));
    expect(screen.queryByTestId("review-conflict")).toBeNull();
    expect(await screen.findByTestId("reviews-empty")).toBeTruthy();
  });
});

describe("reporting a review", () => {
  it("reports somebody else's review by day and reviewer, and never offers it on yours", async () => {
    server.use(
      ...makeReviewsHandlers(DAY, [review(), review({ reviewerId: "dev-alice", reviewerDisplayName: "Alice" })]),
      ...makeReportHandlers(),
    );
    const seen = record();
    render(<Harness />);

    // `dev-alice` is the MSW viewer, so hers is "Yours" and carries no Report.
    expect(await screen.findByText("Yours")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^Report / })).toHaveLength(1);

    await userEvent.click(screen.getByRole("button", { name: "Report Mei Tanaka's review" }));
    const send = screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    await userEvent.click(screen.getByRole("radio", { name: "Wrong or misleading" }));
    await userEvent.type(screen.getByLabelText(/Anything an operator should know/), "Closed since June.");
    await userEvent.click(send);

    expect(await screen.findByTestId("report-sent")).toBeTruthy();
    expect(seen.filter((r) => r.method === "POST").map((r) => r.body)).toEqual([
      {
        target: { kind: "review", savedDayId: DAY, reviewerId: "dev-mei" },
        reason: "inaccurate",
        note: "Closed since June.",
      },
    ]);
  });

  it("explains rather than thanks when the thing reported is the reader's own", async () => {
    server.use(
      ...makeReviewsHandlers(DAY, [review()]),
      http.post("/api/reports", () => HttpResponse.json({ error: "own-content" }, { status: 403 })),
    );
    render(<Harness />);
    await userEvent.click(await screen.findByRole("button", { name: "Report Mei Tanaka's review" }));
    await userEvent.click(screen.getByRole("radio", { name: "Spam or advertising" }));
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("This is yours, so there is nothing to report.")).toBeTruthy();
    expect(screen.queryByTestId("report-sent")).toBeNull();
  });
});
