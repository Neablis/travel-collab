import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CoverCandidate } from "@tc/contracts";
import { historyFixture, tripCoverFactory, tripDetailFixture } from "@tc/factories";
import { makeCoverHandlers } from "@/mocks/handlers";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

// The trip, its history and the caller's role come from mocks, as in
// TripHeader.test.tsx; the cover routes are real requests answered by MSW, so
// the banner's read and the picker's write go through `apiClient` for real.
const TRIP = vi.hoisted(() => "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f");
let myRole: "viewer" | "editor" | "owner" = "owner";
vi.mock("@/lib/apiClient", async (orig) => {
  const actual = await orig<typeof import("@/lib/apiClient")>();
  return {
    ...actual,
    fetchTripDetail: vi.fn().mockResolvedValue({ ok: true, value: tripDetailFixture({ tripId: TRIP, name: "Japan" }) }),
    fetchTripHistory: vi.fn().mockResolvedValue({ ok: true, value: historyFixture(TRIP) }),
    fetchTripAccess: vi.fn(async () => ({ ok: true as const, value: { tripId: TRIP, myRole, members: [], invites: [], guests: [] } })),
  };
});

import { TripProvider } from "@/components/trip/context/TripProvider";
import { EditorHost } from "@/components/trip/context/EditorHost";
import { TripHeader } from "./TripHeader";
import { cachedRead } from "@/lib/queryCache";
import { coverKeys } from "@/lib/queryKeys";
import { setViewportMatches } from "../../../vitest.setup";
import { tripFirstDataFixture } from "@/test-support/tripFirstData";
import { renderToStaticMarkup } from "react-dom/server";
import { TripCoverBanner } from "./cover/TripCoverBanner";



const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
beforeEach(() => {
  myRole = "owner";
  // The band is a desktop thing, decided in JS (`useIsAbovePhone`).
  setViewportMatches({ "(min-width: 768px)": true });
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
  server.events.removeAllListeners();
  // No cover reset of its own: the cover lives in the query cache, which
  // `vitest.setup.ts` clears after every test.
});
afterAll(() => server.close());

function candidate(n: number): CoverCandidate {
  return {
    id: `photo-${n}`,
    urls: {
      raw: `https://images.unsplash.com/photo-${n}?ixid=t`,
      regular: `https://images.unsplash.com/photo-${n}?ixid=t&w=1080`,
      small: `https://images.unsplash.com/photo-${n}?ixid=t&w=400`,
    },
    alt: `Photo ${n}`,
    photographerName: `Photographer ${n}`,
    photographerUrl: `https://unsplash.com/@p${n}`,
    photoPageUrl: `https://unsplash.com/photos/photo-${n}`,
    downloadLocation: `https://api.unsplash.com/photos/photo-${n}/download`,
  };
}

async function renderHeader() {
  render(
    <TripProvider tripId={TRIP}>
      <EditorHost>
        <TripHeader tripId={TRIP} />
      </EditorHost>
    </TripProvider>,
  );
  await screen.findByRole("heading", { level: 1, name: /Japan/ });
}

const band = () => screen.queryByRole("button", { name: "Edit cover" });
const addCover = () => screen.queryByRole("button", { name: "Add cover" });
const items = () => screen.queryAllByRole("menuitem").map((item) => item.textContent);
/** Opens the band's menu by mouse and chooses `item` from it. */
async function choose(item: string) {
  await userEvent.click(await screen.findByRole("button", { name: "Edit cover" }));
  await userEvent.click(await screen.findByRole("menuitem", { name: item }));
}

// Mitchell, 2026-10-10 preview: "I dont like that adding a cover photo makes
// no changes right away, the header of the trip on desktop should also have the
// image in some way … clicking the image should allow you to change it (or
// maybe set it if we have a obvious way to set a header when unset)".
describe("TripHeader — the cover band", () => {
  it("shows the trip's cover as a band, credited, which opens the picker", async () => {
    const cover = tripCoverFactory.build({ alt: "Maples over a temple roof", photographerName: "Aiko Tanaka" });
    server.use(...makeCoverHandlers({ cover }));
    await renderHeader();

    await waitFor(() => expect(band()).not.toBeNull());
    expect(screen.getByRole("img", { name: "Maples over a temple roof" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Aiko Tanaka" })).toBeTruthy();
    expect(addCover()).toBeNull();

    await choose("Change cover");
    const sheet = await screen.findByRole("dialog", { name: /Trip settings/ });
    expect(within(sheet).getByRole("region", { name: "Cover photo" })).toBeTruthy();
  });

  // M49 decision 10, amended 2026-10-25 (Mitchell): no buttons on the band
  // until the cover is activated, then one menu holds all three.
  it("shows an editor no cover buttons until the cover is clicked, then a menu of Change cover, Reposition and Remove", async () => {
    server.use(...makeCoverHandlers({ cover: tripCoverFactory.build() }));
    await renderHeader();
    await waitFor(() => expect(band()).not.toBeNull());
    for (const name of [/change cover/i, /^reposition$/i, /remove/i]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    expect(items()).toEqual([]);

    await userEvent.click(band()!);
    expect(await screen.findByRole("menu")).toBeTruthy();
    expect(items()).toEqual(["Change cover", "Reposition", "Remove"]);
  });

  it("opens the same menu from the keyboard, moves through it with the arrows, and Esc hands focus back to the cover", async () => {
    server.use(...makeCoverHandlers({ cover: tripCoverFactory.build() }));
    await renderHeader();
    await waitFor(() => expect(band()).not.toBeNull());
    band()!.focus();
    await userEvent.keyboard("{Enter}");
    await screen.findByRole("menu");
    expect(items()).toEqual(["Change cover", "Reposition", "Remove"]);
    const item = (name: string) => screen.getByRole("menuitem", { name });
    await waitFor(() => expect(item("Change cover").matches(":focus")).toBe(true));
    await userEvent.keyboard("{ArrowDown}");
    expect(item("Reposition").matches(":focus")).toBe(true);

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    await waitFor(() => expect(band()!.matches(":focus")).toBe(true));
  });

  it("removes the cover from the menu, leaving Add cover in its place with focus on it", async () => {
    let cleared = 0;
    server.use(...makeCoverHandlers({ cover: tripCoverFactory.build({ alt: "Lake roofs" }), onClear: () => cleared++ }));
    await renderHeader();
    await choose("Remove");
    await waitFor(() => expect(screen.queryByRole("img", { name: "Lake roofs" })).toBeNull());
    expect(cleared).toBe(1);
    await waitFor(() => expect(addCover()!.matches(":focus")).toBe(true));
  });

  it("offers Add cover where there is none, and a pick in the picker shows on the trip at once", async () => {
    server.use(...makeCoverHandlers({ cover: null, pages: [[candidate(1), candidate(2)]] }));
    await renderHeader();

    await waitFor(() => expect(addCover()).not.toBeNull());
    expect(band()).toBeNull();

    await userEvent.click(addCover()!);
    const sheet = await screen.findByRole("dialog", { name: /Trip settings/ });
    await userEvent.type(within(sheet).getByRole("searchbox", { name: "Search photos" }), "kyoto");
    await userEvent.click(within(sheet).getByRole("button", { name: "Search" }));
    await userEvent.click(await within(sheet).findByRole("button", { name: "Use photo by Photographer 2" }));

    // No reload and no second read: the band is drawn from what the pick
    // answered, and the stand-in is gone — already behind the open sheet
    // (`hidden: true`, since the modal marks everything outside it hidden),
    // and there when the sheet closes.
    expect(await screen.findByRole("button", { name: "Edit cover", hidden: true })).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(band()).not.toBeNull();
    expect(addCover()).toBeNull();
  });

  // M49 decision 10: Reposition, from the cover's menu, for an editor.
  describe("Reposition", () => {
    const photo = (alt: string) => screen.getByRole("img", { name: alt });
    const patches = () => {
      const sent: unknown[] = [];
      server.events.on("request:start", async ({ request }) => {
        if (request.method === "PATCH") sent.push(await request.clone().json());
      });
      return sent;
    };

    it("moves the photo live and saves it on Enter, which the band then keeps", async () => {
      const sent = patches();
      server.use(...makeCoverHandlers({ cover: tripCoverFactory.build({ alt: "Lake roofs", position: 50 }) }));
      await renderHeader();
      await choose("Reposition");
      expect(screen.getByText("Drag image to reposition")).toBeTruthy();
      expect(band()).toBeNull();

      await userEvent.keyboard("{Shift>}{ArrowDown}{/Shift}{ArrowDown}");
      expect(photo("Lake roofs").style.objectPosition).toBe("center 39%");
      await userEvent.keyboard("{Enter}");

      await waitFor(() => expect(screen.queryByRole("slider", { name: "Cover position" })).toBeNull());
      expect(sent).toEqual([{ position: 39 }]);
      expect(photo("Lake roofs").style.objectPosition).toBe("center 39%");
      expect(band()).not.toBeNull();
    });

    it("puts the photo back on Esc, sending nothing", async () => {
      const sent = patches();
      server.use(...makeCoverHandlers({ cover: tripCoverFactory.build({ alt: "Lake roofs", position: 30 }) }));
      await renderHeader();
      await choose("Reposition");
      await userEvent.keyboard("{ArrowUp}{ArrowUp}");
      expect(photo("Lake roofs").style.objectPosition).toBe("center 32%");

      await userEvent.keyboard("{Escape}");
      expect(screen.queryByRole("slider", { name: "Cover position" })).toBeNull();
      expect(photo("Lake roofs").style.objectPosition).toBe("center 30%");
      expect(sent).toEqual([]);
      await waitFor(() => expect(band()!.matches(":focus")).toBe(true));
    });

    it("closes and says so when the cover was removed meanwhile, offering no retry", async () => {
      server.use(...makeCoverHandlers({ cover: tripCoverFactory.build({ alt: "Lake roofs", position: 30 }) }));
      await renderHeader();
      await choose("Reposition");
      // A co-editor removes it after the band read it.
      server.use(http.patch(`/api/trips/${TRIP}/cover`, () => HttpResponse.json({ error: "no-cover" }, { status: 404 })));
      await userEvent.keyboard("{ArrowUp}{Enter}");

      expect((await screen.findByRole("alert")).textContent).toMatch(/cover was removed/);
      expect(screen.queryByRole("slider", { name: "Cover position" })).toBeNull();
      expect(photo("Lake roofs").style.objectPosition).toBe("center 30%");
      // Back on the cover, not <body>; `:focus`, because the test-quality wall
      // bans `document.activeElement`. Its menu no longer offers Reposition.
      await waitFor(() => expect(band()!.matches(":focus")).toBe(true));
      await userEvent.click(band()!);
      await screen.findByRole("menu");
      expect(items()).toEqual(["Change cover", "Remove"]);
    });
  });

  // PR #384 review: the banner kept a store of its own beside the cache Trip
  // settings reads, so a newer cover read there (a co-editor's) never reached
  // the band, and the band's read never spared Settings its first one.
  it("shares one cover with Trip settings: the band's read paints Settings, and a newer read repaints the band", async () => {
    const reads = { count: 0 };
    server.events.on("request:start", ({ request }) => {
      if (request.method === "GET" && new URL(request.url).pathname === `/api/trips/${TRIP}/cover`) reads.count++;
    });
    server.use(...makeCoverHandlers({ cover: tripCoverFactory.build({ alt: "Old roofs" }) }));
    await renderHeader();
    await waitFor(() => expect(band()).not.toBeNull());
    expect(reads.count).toBe(1);

    await choose("Change cover");
    const sheet = await screen.findByRole("dialog", { name: /Trip settings/ });
    expect(await within(sheet).findByRole("img", { name: "Old roofs" })).toBeTruthy();
    expect(reads.count).toBe(1);
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // Any reader of the key bringing a newer answer — Settings revalidating
    // after the window, say, and finding a co-editor's pick.
    const newer = tripCoverFactory.build({ alt: "New harbour" });
    await act(async () => {
      await cachedRead(coverKeys.trip(TRIP), () => Promise.resolve({ ok: true as const, value: newer }), { dedupeMs: 0 });
    });
    expect(await screen.findByRole("img", { name: "New harbour" })).toBeTruthy();
  });

  // PR #384 review: the band was `hidden md:block`, so a phone still read the
  // cover and downloaded a full-width eager photo it never showed.
  it("neither reads the cover nor draws the band on a phone", async () => {
    setViewportMatches({ "(max-width: 767px)": true });
    let reads = 0;
    server.events.on("request:start", ({ request }) => {
      if (request.method === "GET" && new URL(request.url).pathname === `/api/trips/${TRIP}/cover`) reads++;
    });
    server.use(...makeCoverHandlers({ cover: tripCoverFactory.build({ alt: "Unseen roofs" }) }));
    await renderHeader();
    // Long enough for a read started on mount to have been answered.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(reads).toBe(0);
    expect(screen.queryByRole("img", { name: "Unseen roofs" })).toBeNull();
  });

  // Mitchell, 2026-10-10: the header sits on the photo's faded foot, as a
  // playbook day's title does. See-through there, so the photo shows under
  // it; once it pins, the board scrolls under it, so it must be solid again.
  it("lets the photo show through the header until the header pins, then paints its own background", async () => {
    const watched: { notify?: (entry: Partial<IntersectionObserverEntry>) => void } = {};
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: IntersectionObserverCallback) {
          watched.notify = (entry) => callback([entry as IntersectionObserverEntry], this as never);
        }
        observe() {}
        disconnect() {}
      },
    );
    try {
      server.use(...makeCoverHandlers({ cover: tripCoverFactory.build() }));
      await renderHeader();
      await waitFor(() => expect(band()).not.toBeNull());
      const header = screen.getByRole("banner", { name: "Trip" });
      const seeThrough = () => header.classList.contains("md:bg-transparent");

      expect(seeThrough()).toBe(true);
      // The header's top line scrolls above the header's sticky `top` (0 in jsdom).
      act(() => watched.notify!({ isIntersecting: false, boundingClientRect: { top: -40 } as DOMRectReadOnly }));
      expect(seeThrough()).toBe(false);
      expect(header.classList.contains("bg-surface")).toBe(true);
      act(() => watched.notify!({ isIntersecting: true, boundingClientRect: { top: 200 } as DOMRectReadOnly }));
      expect(seeThrough()).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  // The trip page's first data (`server/tripFirstData.ts`): a cover the server
  // sent is drawn on the first render — the server's HTML has the band — and
  // read from nowhere. On a phone the band is still in the page, so the server
  // and the hydrating render agree, but CSS hides it and its `<picture>` gives
  // a phone a blank source instead of the photo.
  describe("with the server's first data", () => {
    const coverReads = () => {
      const seen = { count: 0 };
      server.events.on("request:start", ({ request }) => {
        if (request.method === "GET" && new URL(request.url).pathname === `/api/trips/${TRIP}/cover`) seen.count++;
      });
      return seen;
    };
    const renderSeeded = (alt: string) =>
      render(
        <TripProvider tripId={TRIP} initial={tripFirstDataFixture({ cover: tripCoverFactory.build({ alt }) })}>
          <EditorHost>
            <TripHeader tripId={TRIP} />
          </EditorHost>
        </TripProvider>,
      );

    it("draws the band on its first render, and reads no cover", async () => {
      const reads = coverReads();
      renderSeeded("Seeded roofs");
      expect(screen.getByRole("img", { name: "Seeded roofs" })).toBeTruthy();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(reads.count).toBe(0);
    });

    it("keeps the band off a phone by CSS, with a blank phone source, and reads no cover", async () => {
      setViewportMatches({ "(max-width: 767px)": true });
      const reads = coverReads();
      renderSeeded("Phone roofs");
      expect(screen.getByRole("img", { name: "Phone roofs" })).toBeTruthy();
      // The band as the server's HTML carries it: hidden below 768px, and a
      // phone's `<source>` that is a blank inline GIF, so the photo is never
      // fetched there.
      // React's own preload of an eager image is lost inside a `<picture>`, so
      // the banner preloads it for desktop only: a phone fetches nothing.
      const html = renderToStaticMarkup(<TripCoverBanner tripId={TRIP} cover={tripCoverFactory.build()} />);
      expect(html).toMatch(/^<link rel="preload" as="image"[^>]* media="\(min-width: 768px\)"[^>]*\/>/);
      expect(html.match(/<link /g)).toHaveLength(1);
      expect(html).toMatch(/\/><div class="[^"]*\bmax-md:hidden\b/);
      expect(html).toMatch(/<picture><source media="\(max-width: 767px\)" srcSet="data:image\/gif;base64,[^"]+"\/><img /);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(reads.count).toBe(0);
    });
  });

  it("gives a reader the band but no way to change it, and no Add cover", async () => {
    myRole = "viewer";
    server.use(...makeCoverHandlers({ cover: tripCoverFactory.build({ alt: "Dunes at dusk" }) }));
    await renderHeader();
    const photo = await screen.findByRole("img", { name: "Dunes at dusk" });
    expect(band()).toBeNull();
    await userEvent.click(photo);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(addCover()).toBeNull();
  });
});
