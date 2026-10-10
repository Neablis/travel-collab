import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { CoverCandidate } from "@tc/contracts";
import { tripCoverFactory } from "@tc/factories";
import { makeCoverHandlers } from "@/mocks/handlers";
import { CoverSection } from "./CoverSection";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  server.events.removeAllListeners();
});
afterAll(() => server.close());

const TRIP = "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f";

function candidate(n: number): CoverCandidate {
  return {
    id: `photo-${n}`,
    urls: {
      raw: `https://images.unsplash.com/photo-${n}?ixid=t`,
      regular: `https://images.unsplash.com/photo-${n}?ixid=t&w=1080`,
      small: `https://images.unsplash.com/photo-${n}?ixid=t&w=400`,
    },
    alt: null,
    photographerName: `Photographer ${n}`,
    photographerUrl: `https://unsplash.com/@p${n}`,
    photoPageUrl: `https://unsplash.com/photos/photo-${n}`,
    downloadLocation: `https://api.unsplash.com/photos/photo-${n}/download`,
  };
}

/** `count` candidates numbered from `from`. */
const run = (from: number, count: number) => Array.from({ length: count }, (_, i) => candidate(from + i));

async function searchFor(q: string) {
  await userEvent.type(screen.getByRole("searchbox", { name: "Search photos" }), q);
  await userEvent.click(screen.getByRole("button", { name: "Search" }));
}

const tiles = () => screen.queryAllByRole("button", { name: /^Use photo by / });

describe("CoverSection — an editor", () => {
  it("shows the current cover with its credit, and removes it", async () => {
    let cleared = 0;
    const cover = tripCoverFactory.build({ alt: "Maples over a temple roof", photographerName: "Aiko Tanaka" });
    server.use(...makeCoverHandlers({ cover, onClear: () => cleared++ }));
    render(<CoverSection tripId={TRIP} canEdit />);

    expect(await screen.findByRole("img", { name: "Maples over a temple roof" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Aiko Tanaka" })).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Remove cover" }));
    await waitFor(() => expect(screen.queryByRole("img", { name: "Maples over a temple roof" })).toBeNull());
    expect(cleared).toBe(1);
    expect(screen.queryByRole("button", { name: "Remove cover" })).toBeNull();
    // The button went with the cover; focus goes to the search, not the page.
    const box = screen.getByRole("searchbox", { name: "Search photos" });
    await waitFor(() => expect(box.matches(":focus")).toBe(true));
  });

  it("searches, shows six results a screen, each credited, and pages through what it has before asking again", async () => {
    const asked: string[] = [];
    server.use(...makeCoverHandlers({ pages: [run(1, 12), run(13, 2)] }));
    server.events.on("request:start", ({ request }) => {
      const url = new URL(request.url);
      if (url.pathname.endsWith("/cover/search")) asked.push(url.search);
    });
    render(<CoverSection tripId={TRIP} canEdit />);

    await searchFor("kyoto maple");
    await waitFor(() => expect(tiles()).toHaveLength(6));
    expect(tiles()[0]!.getAttribute("aria-label")).toBe("Use photo by Photographer 1");
    expect(screen.getByRole("link", { name: "Photographer 1" }).getAttribute("href")).toBe(
      "https://unsplash.com/@p1?utm_source=caesura&utm_medium=referral",
    );
    expect(screen.getByText((_, el) => el?.tagName === "SPAN" && el.textContent === "Photos from Unsplash")).toBeTruthy();

    // The second six were already in hand: no request.
    await userEvent.click(screen.getByRole("button", { name: "More results" }));
    await waitFor(() => expect(tiles()[0]!.getAttribute("aria-label")).toBe("Use photo by Photographer 7"));
    // Past them, page 2 is asked for.
    await userEvent.click(screen.getByRole("button", { name: "More results" }));
    await waitFor(() => expect(tiles().map((t) => t.getAttribute("aria-label"))).toEqual([
      "Use photo by Photographer 13",
      "Use photo by Photographer 14",
    ]));
    // Page 2 was short, so it was the last: no press is offered that would
    // spend a search to learn so, and focus is not dropped on the page.
    const end = screen.getByText("No more photos.");
    expect(screen.queryByRole("button", { name: "More results" })).toBeNull();
    await waitFor(() => expect(end.matches(":focus")).toBe(true));
    // The opening probe (an empty query, which spends nothing), then the two pages.
    expect(asked).toEqual(["?q=&page=1", "?q=kyoto+maple&page=1", "?q=kyoto+maple&page=2"]);
  });

  it("offers no more after a short first page", async () => {
    server.use(...makeCoverHandlers({ pages: [run(1, 3), run(4, 3)] }));
    render(<CoverSection tripId={TRIP} canEdit />);
    await searchFor("dunes");
    await waitFor(() => expect(tiles()).toHaveLength(3));
    expect(screen.getByText("No more photos.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "More results" })).toBeNull();
  });

  // Page 2 repeats a photo page 1 had, so it adds eleven, not twelve: the
  // third screen starts on the 23rd photo, not where a fixed step of six
  // would put it, and the photo repeated is offered once.
  it("pages from the first new photo, and offers a repeated one once", async () => {
    server.use(...makeCoverHandlers({ pages: [run(1, 12), [candidate(12), ...run(13, 11)], run(24, 12)] }));
    render(<CoverSection tripId={TRIP} canEdit />);
    const labels = () => tiles().map((t) => t.getAttribute("aria-label")!.replace("Use photo by Photographer ", ""));

    await searchFor("kyoto");
    await waitFor(() => expect(tiles()).toHaveLength(6));
    const more = () => userEvent.click(screen.getByRole("button", { name: "More results" }));
    await more(); // 7–12, in hand
    await more(); // page 2: 13–18
    await waitFor(() => expect(labels()).toEqual(["13", "14", "15", "16", "17", "18"]));
    await more(); // 19–23, in hand: five, not a sixth that would be 12 again
    await waitFor(() => expect(labels()).toEqual(["19", "20", "21", "22", "23"]));
    await more(); // page 3
    await waitFor(() => expect(labels()).toEqual(["24", "25", "26", "27", "28", "29"]));
  });

  it("picks a result, and shows it as the cover and as pressed", async () => {
    const sent: CoverCandidate[] = [];
    server.use(...makeCoverHandlers({ pages: [run(1, 3)], onSet: (c) => sent.push(c) }));
    render(<CoverSection tripId={TRIP} canEdit />);

    await searchFor("dunes");
    const second = await screen.findByRole("button", { name: "Use photo by Photographer 2" });
    expect(second.getAttribute("aria-pressed")).toBe("false");
    await userEvent.click(second);

    await waitFor(() => expect(second.getAttribute("aria-pressed")).toBe("true"));
    expect(sent.map((c) => c.id)).toEqual(["photo-2"]);
    // The section's own preview is the pick now, credited.
    expect(screen.getByRole("img", { name: "Photo by Photographer 2" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove cover" })).toBeTruthy();
  });

  it("says plainly when nothing matched", async () => {
    server.use(...makeCoverHandlers({ pages: [[]] }));
    render(<CoverSection tripId={TRIP} canEdit />);
    await searchFor("zzzz");
    expect(await screen.findByText("No photos found for “zzzz”.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "More results" })).toBeNull();
  });

  it("replaces the search with a line when covers are not set up here, and keeps the cover", async () => {
    const cover = tripCoverFactory.build({ alt: "A harbour" });
    server.use(...makeCoverHandlers({ cover, search: "unavailable" }));
    render(<CoverSection tripId={TRIP} canEdit />);

    expect(await screen.findByText("Cover photos aren't available here yet.")).toBeTruthy();
    expect(screen.queryByRole("searchbox", { name: "Search photos" })).toBeNull();
    expect(screen.getByRole("img", { name: "A harbour" })).toBeTruthy();
  });

  it("asks politely for a retry when the search quota is spent, and keeps the search", async () => {
    server.use(...makeCoverHandlers({ search: "quota" }));
    render(<CoverSection tripId={TRIP} canEdit />);
    // A 429 is not "not set up".
    await searchFor("kyoto");
    expect(await screen.findByText(/a lot of photo searches for now.*try again/i)).toBeTruthy();
    expect(screen.getByRole("searchbox", { name: "Search photos" })).toBeTruthy();
    expect(screen.queryByText("Cover photos aren't available here yet.")).toBeNull();
  });

  // The rate limiter's own outage is a 503 too (`quotaRefusal`). It is a
  // failed search, not a deployment without covers, so the search stays.
  it("reads a 503 that is not covers-unavailable as a failure, not as no covers", async () => {
    server.use(
      http.get("/api/trips/:tripId/cover/search", ({ request }) =>
        new URL(request.url).searchParams.get("q")
          ? HttpResponse.json({ error: "rate limiter unavailable", reason: "unavailable", retryAfterSeconds: 60 }, { status: 503 })
          : HttpResponse.json({ results: [] }),
      ),
      ...makeCoverHandlers(),
    );
    render(<CoverSection tripId={TRIP} canEdit />);
    await searchFor("kyoto");
    expect(await screen.findByText("That didn't work. Try again.")).toBeTruthy();
    expect(screen.getByRole("searchbox", { name: "Search photos" })).toBeTruthy();
    expect(screen.queryByText("Cover photos aren't available here yet.")).toBeNull();
  });

  it("says when Unsplash's own limit is hit, and for how long", async () => {
    server.use(...makeCoverHandlers({ search: "upstream-limit" }));
    render(<CoverSection tripId={TRIP} canEdit />);
    await searchFor("kyoto");
    expect(await screen.findByText(/Unsplash .* Try again in about 5 minutes\./)).toBeTruthy();
    expect(screen.queryByText(/a lot of photo searches/)).toBeNull();
  });

  it("words a refused pick as picking, not searching", async () => {
    server.use(...makeCoverHandlers({ pages: [run(1, 3)], pick: "quota" }));
    render(<CoverSection tripId={TRIP} canEdit />);
    await searchFor("dunes");
    await userEvent.click(await screen.findByRole("button", { name: "Use photo by Photographer 1" }));
    expect(await screen.findByText(/a lot of cover changes for now.*try again/i)).toBeTruthy();
    expect(screen.queryByText(/photo searches/)).toBeNull();
  });

  // Not knowing is not "no cover": a trip that has one keeps *Remove cover*
  // once the read is retried.
  it("says a failed read failed, and retries it", async () => {
    const cover = tripCoverFactory.build({ alt: "A harbour" });
    server.use(...makeCoverHandlers({ cover, read: "fail-once" }));
    render(<CoverSection tripId={TRIP} canEdit />);

    expect(await screen.findByText("Couldn't load the cover photo.")).toBeTruthy();
    expect(screen.queryByText("No cover photo yet.")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("img", { name: "A harbour" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove cover" })).toBeTruthy();
  });

  // Either read can move what is under the section: the cover by becoming a
  // photo or nothing, the probe by swapping the search row for a line. Each
  // case lets the other read land visibly first, then releases the held one.
  it("has not settled while the cover read is out, though the probe has answered", async () => {
    let settled = 0;
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const cover = tripCoverFactory.build({ alt: "A harbour" });
    // First: the earlier of two matching handlers answers.
    server.use(
      http.get("/api/trips/:tripId/cover", async () => {
        await held;
        return HttpResponse.json({ cover });
      }),
      ...makeCoverHandlers({ cover, search: "unavailable" }),
    );
    render(<CoverSection tripId={TRIP} canEdit onSettled={() => settled++} />);
    expect(await screen.findByText("Cover photos aren't available here yet.")).toBeTruthy();
    expect(settled).toBe(0);
    release();
    expect(await screen.findByRole("img", { name: "A harbour" })).toBeTruthy();
    await waitFor(() => expect(settled).toBe(1));
  });

  it("has not settled while the probe is out, and settles once only", async () => {
    let settled = 0;
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const cover = tripCoverFactory.build({ alt: "A harbour" });
    server.use(
      http.get("/api/trips/:tripId/cover/search", async ({ request }) => {
        // A real search falls through to the handlers below.
        if (new URL(request.url).searchParams.get("q")) return undefined;
        await held;
        return HttpResponse.json({ results: [] });
      }),
      ...makeCoverHandlers({ cover, pages: [run(1, 3)] }),
    );
    render(<CoverSection tripId={TRIP} canEdit onSettled={() => settled++} />);
    expect(await screen.findByRole("img", { name: "A harbour" })).toBeTruthy();
    expect(settled).toBe(0);
    release();
    await waitFor(() => expect(settled).toBe(1));
    // A pick changes the cover again later: that is not a second settling,
    // or a sheet opened at People would jump back there under the picker.
    await searchFor("kyoto");
    await userEvent.click(await screen.findByRole("button", { name: "Use photo by Photographer 2" }));
    expect(await screen.findByRole("img", { name: "Photo by Photographer 2" })).toBeTruthy();
    expect(settled).toBe(1);
  });
});

describe("CoverSection — anyone else on the trip", () => {
  it("sees the cover and its credit, and no way to change it", async () => {
    const cover = tripCoverFactory.build({ alt: "A ridge at dusk", photographerName: "Cy Offline" });
    server.use(...makeCoverHandlers({ cover }));
    render(<CoverSection tripId={TRIP} canEdit={false} />);

    const section = screen.getByRole("region", { name: "Cover photo" });
    expect(await within(section).findByRole("img", { name: "A ridge at dusk" })).toBeTruthy();
    expect(within(section).getByRole("link", { name: "Cy Offline" })).toBeTruthy();
    expect(within(section).queryByRole("searchbox")).toBeNull();
    expect(within(section).queryByRole("button")).toBeNull();
  });

  it("is told there is no cover yet", async () => {
    server.use(...makeCoverHandlers());
    render(<CoverSection tripId={TRIP} canEdit={false} />);
    expect(await screen.findByText("No cover photo yet.")).toBeTruthy();
  });

  // Trip settings unmounts its content when it closes, so every open is a
  // fresh mount. Mitchell: *"it refetches on every open"* — and drew the
  // skeleton each time, then the photo over it.
  it("paints the cover at once when the sheet opens again, without asking again", async () => {
    let reads = 0;
    const cover = tripCoverFactory.build({ alt: "A ridge at dusk" });
    server.use(...makeCoverHandlers({ cover }));
    server.events.on("request:start", ({ request }) => {
      if (request.method === "GET" && new URL(request.url).pathname.endsWith("/cover")) reads++;
    });
    const first = render(<CoverSection tripId={TRIP} canEdit={false} />);
    expect(await screen.findByRole("img", { name: "A ridge at dusk" })).toBeTruthy();
    first.unmount();

    render(<CoverSection tripId={TRIP} canEdit={false} />);
    // On the first frame, not after a read: no `find`.
    expect(screen.getByRole("img", { name: "A ridge at dusk" })).toBeTruthy();
    expect(reads).toBe(1);
  });
});
