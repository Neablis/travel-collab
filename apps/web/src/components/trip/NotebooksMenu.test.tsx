import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { SYSTEM_ACTOR_ID } from "@tc/contracts";
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

    // Asserted through each LINK's accessible name, not as two independent
    // text lookups. The independent form passed even if the two bindings were
    // swapped onto the wrong notebooks — it proved both strings were somewhere
    // on screen and nothing about which notebook each belonged to, which is the
    // entire claim this test makes (Copilot, PR #126).
    //
    // Anchored at both ends, with LITERAL spaces around the `.+`: the `.+` is
    // the row's second line (asserted on its own below), and the spaces are the
    // claim that this name reads as words. Without the explicit whitespace
    // nodes in the row it computes as "Trip OverviewYours…Trip-wide" — one
    // run-together word to a screen reader.
    expect(await screen.findByRole("link", { name: /Trip Overview/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /^Trip Overview .+ Trip-wide$/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /^Day Sheet .+ Day 6$/ })).toBeTruthy();
  });

  // The design gives every row a second line, and it is the same line the index
  // route already shows (`NotebookScreen`) from the same two helpers — a menu
  // that described one notebook differently from the list it links to would be
  // two answers to one question.
  it("gives each notebook a second line saying where it came from and how stale it is", async () => {
    // Relative to now, so "3 hours ago" is a constant rather than a function of
    // how long ago the fixture's own date was.
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    const seeded = pageFixture({
      id: "11111111-1111-4111-8111-111111111111",
      tripId: TRIP_ID,
      title: "Trip Overview",
      actorId: SYSTEM_ACTOR_ID,
      updatedAt: threeHoursAgo,
    });
    const mine = pageFixture({
      id: "22222222-2222-4222-8222-222222222222",
      tripId: TRIP_ID,
      title: "Packing",
      actorId: "dev-alice",
      updatedAt: threeHoursAgo,
    });
    // The case that needs `viewerId`: `actorId` alone cannot tell a
    // collaborator's notebook from the reader's own, so without the reader
    // threaded through, every row on a shared trip reads "Yours".
    const theirs = pageFixture({
      id: "33333333-3333-4333-8333-333333333333",
      tripId: TRIP_ID,
      title: "Bob's notes",
      actorId: "dev-bob",
      updatedAt: threeHoursAgo,
    });
    server.use(...makePagesHandlers([seeded, mine, theirs], { viewerId: "dev-alice" }));

    render(<NotebooksMenu tripId={TRIP_ID} />);
    fireEvent.click(screen.getByRole("button", { name: "Notebooks" }));

    expect(await screen.findByText("Comes with your trip · edited 3 hours ago")).toBeTruthy();
    expect(screen.getByText("Yours · edited 3 hours ago")).toBeTruthy();
    expect(screen.getByText("From another traveler · edited 3 hours ago")).toBeTruthy();
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

  it("ignores a superseded response, so a slow first open cannot overwrite a newer list", async () => {
    const stale = pageFixture({ id: "11111111-1111-4111-8111-111111111111", tripId: TRIP_ID, title: "Stale" });
    const fresh = pageFixture({ id: "22222222-2222-4222-8222-222222222222", tripId: TRIP_ID, title: "Fresh" });

    // Two opens: the first response is held until after the second has landed,
    // so it resolves LAST. Responses are not guaranteed to arrive in the order
    // they were sent, and without a guard the older one wins by arriving late.
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let call = 0;
    server.use(
      http.get("/api/trips/:tripId/pages", async () => {
        call += 1;
        if (call === 1) {
          await held;
          return HttpResponse.json({ pages: [stale], viewerId: "dev-alice" });
        }
        return HttpResponse.json({ pages: [fresh], viewerId: "dev-alice" });
      }),
    );

    render(<NotebooksMenu tripId={TRIP_ID} />);
    const trigger = screen.getByRole("button", { name: "Notebooks" });
    fireEvent.click(trigger); // open — request 1, held
    fireEvent.click(trigger); // close
    fireEvent.click(trigger); // reopen — request 2, answers immediately

    expect(await screen.findByText("Fresh")).toBeTruthy();

    release();
    // Give the superseded response a chance to land and do damage.
    await waitFor(() => expect(call).toBe(2));
    expect(screen.queryByText("Stale")).toBeNull();
    expect(screen.getByText("Fresh")).toBeTruthy();
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

  it("withholds New notebook from a viewer, who can still read the list", async () => {
    const notebook = pageFixture({ tripId: TRIP_ID, title: "Trip Overview" });
    server.use(...makePagesHandlers([notebook]));

    render(<NotebooksMenu tripId={TRIP_ID} readOnly />);
    fireEvent.click(screen.getByRole("button", { name: "Notebooks" }));

    // Reading is theirs — the GET is viewer-gated.
    expect(await screen.findByRole("link", { name: /Trip Overview/ })).toBeTruthy();
    // Creating is not: the POST is editor-gated, so an offered control is a
    // guaranteed 403. Withheld rather than disabled (ADR-031).
    expect(screen.queryByRole("button", { name: "New notebook" })).toBeNull();
  });

  it("blames the create, not the list, when creating fails — and keeps the notebooks on screen", async () => {
    const notebook = pageFixture({ tripId: TRIP_ID, title: "Trip Overview" });
    server.use(
      http.get("/api/trips/:tripId/pages", () =>
        HttpResponse.json({ pages: [notebook], viewerId: "dev-alice" }),
      ),
      http.post("/api/trips/:tripId/pages", () => HttpResponse.json({ error: "nope" }, { status: 500 })),
    );

    render(<NotebooksMenu tripId={TRIP_ID} />);
    fireEvent.click(screen.getByRole("button", { name: "Notebooks" }));
    expect(await screen.findByRole("link", { name: /Trip Overview/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "New notebook" }));

    // The create's own failure, beside the control that failed.
    expect(await screen.findByText(/Could not create a notebook/)).toBeTruthy();
    // And the list is untouched: writing the create's failure into the LIST's
    // state used to blank the notebooks it had already loaded, then blame the
    // load for something the load did not do.
    expect(screen.getByRole("link", { name: /Trip Overview/ })).toBeTruthy();
    expect(screen.queryByText("Could not load your notebooks.")).toBeNull();
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
