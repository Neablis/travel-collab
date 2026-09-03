import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { setupServer } from "msw/node";
import { pageFixture } from "@tc/factories";
import { makePagesHandlers } from "@/mocks/handlers";
import { NotebooksMenu } from "./NotebooksMenu";

const TRIP_ID = "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f";
const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
beforeEach(() => pushMock.mockClear());
afterEach(() => {
  server.resetHandlers();
  cleanup();
});
afterAll(() => server.close());

// SPEC §11 — "Notebooks is a menu, not a tab". Three sections, one noun.
describe("NotebooksMenu", () => {
  it("does not fetch notebooks until it is opened", async () => {
    const seen: string[] = [];
    server.use(...makePagesHandlers([pageFixture({ tripId: TRIP_ID })]));
    server.events.on("request:start", ({ request }) => seen.push(request.url));

    render(<NotebooksMenu tripId={TRIP_ID} />);

    // This pill sits on the board, where a person can spend an hour without
    // ever opening it. Fetching on mount would put a request on every board
    // load for a list most of them never see.
    expect(await screen.findByRole("button", { name: "Notebooks" })).toBeTruthy();
    expect(seen.filter((url) => url.includes("/pages"))).toEqual([]);
    server.events.removeAllListeners();
  });

  it("lists the trip's notebooks with their binding when opened", async () => {
    const tripWide = pageFixture({
      id: "11111111-1111-4111-8111-111111111111",
      tripId: TRIP_ID,
      title: "Trip Overview",
    });
    const dayBound = pageFixture({
      id: "22222222-2222-4222-8222-222222222222",
      tripId: TRIP_ID,
      title: "Day Sheet",
      context: { tripId: TRIP_ID, dayRef: { kind: "index", index: 5 } },
    });
    server.use(...makePagesHandlers([tripWide, dayBound]));

    render(<NotebooksMenu tripId={TRIP_ID} />);
    fireEvent.click(screen.getByRole("button", { name: "Notebooks" }));

    // The binding is the whole reason the menu lists them rather than just
    // linking to the index: it is what tells two similarly named notebooks
    // apart without opening either.
    expect(await screen.findByText("Trip Overview")).toBeTruthy();
    expect(screen.getByText("Trip-wide")).toBeTruthy();
    expect(screen.getByText("Day 6")).toBeTruthy();
  });

  it("re-reads the list on each open, so a notebook made elsewhere shows up", async () => {
    const first = pageFixture({ id: "11111111-1111-4111-8111-111111111111", tripId: TRIP_ID, title: "Trip Overview" });
    const second = pageFixture({ id: "22222222-2222-4222-8222-222222222222", tripId: TRIP_ID, title: "Packing" });
    server.use(...makePagesHandlers([first]));

    render(<NotebooksMenu tripId={TRIP_ID} />);
    fireEvent.click(screen.getByRole("button", { name: "Notebooks" }));
    expect(await screen.findByText("Trip Overview")).toBeTruthy();

    // The notebook appears in the store while the menu is closed — a second
    // tab, or the index route in this one. Closed by clicking the trigger
    // again, which is how a person closes it.
    fireEvent.click(screen.getByRole("button", { name: "Notebooks" }));
    server.resetHandlers();
    server.use(...makePagesHandlers([first, second]));

    fireEvent.click(screen.getByRole("button", { name: "Notebooks" }));

    expect(await screen.findByText("Packing")).toBeTruthy();
  });

  it("creates a notebook and goes straight to it", async () => {
    const onCreate = vi.fn();
    server.use(...makePagesHandlers([], { onCreate }));

    render(<NotebooksMenu tripId={TRIP_ID} />);
    fireEvent.click(screen.getByRole("button", { name: "Notebooks" }));
    fireEvent.click(await screen.findByRole("button", { name: "New notebook" }));

    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    // A create that leaves you looking at a list is a second click to reach
    // the thing you just made.
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith(expect.stringContaining(`/trips/${TRIP_ID}/pages/`)));
  });

  it("offers a way through to the full index", async () => {
    server.use(...makePagesHandlers([]));

    render(<NotebooksMenu tripId={TRIP_ID} />);
    fireEvent.click(screen.getByRole("button", { name: "Notebooks" }));

    const browse = await screen.findByRole("link", { name: /Browse all notebooks/ });
    expect(browse.getAttribute("href")).toBe(`/trips/${TRIP_ID}/pages`);
  });

  it("says so when the list cannot be read, instead of showing an empty menu", async () => {
    server.use(...makePagesHandlers([]));
    // An empty menu and a broken menu look identical, and only one of them
    // means "you have no notebooks".
    server.resetHandlers();
    const { http, HttpResponse } = await import("msw");
    server.use(http.get("/api/trips/:tripId/pages", () => HttpResponse.json({ error: "nope" }, { status: 500 })));

    render(<NotebooksMenu tripId={TRIP_ID} />);
    fireEvent.click(screen.getByRole("button", { name: "Notebooks" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText("No notebooks yet.")).toBeNull();
  });
});
