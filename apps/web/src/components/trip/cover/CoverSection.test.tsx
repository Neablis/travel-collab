import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
    // The opening probe (an empty query, which spends nothing), then the two pages.
    expect(asked).toEqual(["?q=&page=1", "?q=kyoto+maple&page=1", "?q=kyoto+maple&page=2"]);
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
    // The probe is refused too, and a 429 is not "not set up".
    await searchFor("kyoto");
    expect(await screen.findByText(/a lot of photo searches for now.*try again/i)).toBeTruthy();
    expect(screen.getByRole("searchbox", { name: "Search photos" })).toBeTruthy();
    expect(screen.queryByText("Cover photos aren't available here yet.")).toBeNull();
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
});
