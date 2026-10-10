import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
    fetchTripAccess: vi.fn(async () => ({ ok: true as const, value: { tripId: TRIP, myRole, members: [], invites: [] } })),
  };
});

import { TripProvider } from "@/components/trip/context/TripProvider";
import { EditorHost } from "@/components/trip/context/EditorHost";
import { TripHeader } from "./TripHeader";
import { resetTripCoverCache } from "./cover/tripCoverStore";



const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
beforeEach(() => {
  myRole = "owner";
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
  resetTripCoverCache();
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

const band = () => screen.queryByRole("button", { name: "Change cover photo" });
const addCover = () => screen.queryByRole("button", { name: "Add cover" });

// Mitchell, 2026-10-10 preview: "I dont like that adding a cover photo makes
// no changes right away, the header of the trip on desktop should also have the
// image in some way … clicking the image should allow you to change it (or
// maybe set it if we have a obvious way to set a header when unset)".
describe("TripHeader — the cover band", () => {
  it("shows the trip's cover as a band with the trip's name, credited, which opens the picker", async () => {
    const cover = tripCoverFactory.build({ alt: "Maples over a temple roof", photographerName: "Aiko Tanaka" });
    server.use(...makeCoverHandlers({ cover }));
    await renderHeader();

    await waitFor(() => expect(band()).not.toBeNull());
    expect(screen.getByRole("img", { name: "Maples over a temple roof" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Aiko Tanaka" })).toBeTruthy();
    expect(addCover()).toBeNull();

    await userEvent.click(band()!);
    const sheet = await screen.findByRole("dialog", { name: /Trip settings/ });
    expect(within(sheet).getByRole("region", { name: "Cover photo" })).toBeTruthy();
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
    expect(await screen.findByRole("button", { name: "Change cover photo", hidden: true })).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(band()).not.toBeNull();
    expect(addCover()).toBeNull();
  });

  it("gives a reader the band but no way to change it, and no Add cover", async () => {
    myRole = "viewer";
    server.use(...makeCoverHandlers({ cover: tripCoverFactory.build({ alt: "Dunes at dusk" }) }));
    await renderHeader();
    expect(await screen.findByRole("img", { name: "Dunes at dusk" })).toBeTruthy();
    expect(band()).toBeNull();
    expect(addCover()).toBeNull();
  });
});
