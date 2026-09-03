import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { PageScreen } from "./PageScreen";
import { pageFixture, tripDetailFixture } from "@tc/factories";
import { makePagesHandlers } from "@/mocks/handlers";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  cleanup();
});
afterAll(() => server.close());

describe("PageScreen", () => {
  it("loads a page and renders the editor with its content", async () => {
    const trip = tripDetailFixture();
    const page = pageFixture({
      tripId: trip.tripId,
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hello notebook" }] }] },
    });
    server.use(
      ...makePagesHandlers([page]),
      http.get("/api/trips/:tripId", () => HttpResponse.json({ trip })),
    );

    render(<PageScreen tripId={trip.tripId} pageId={page.id} />);

    expect(await screen.findByText("Hello notebook")).toBeTruthy();
  });

  it("resolves a day macro's own params against the loaded TripDetail", async () => {
    const dayId = "1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d";
    const trip = tripDetailFixture({
      days: [{ dayId, activityIds: [], date: "2027-06-01", costSubtotal: 0 }],
    });
    const page = pageFixture({
      tripId: trip.tripId,
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              // The day is the widget's, not the page's (SPEC §18): the page
              // below is about nothing in particular.
              { type: "macro", attrs: { name: "cost.day", params: { dayRef: { kind: "index", index: 0 } } } },
            ],
          },
        ],
      },
    });
    server.use(
      ...makePagesHandlers([page]),
      http.get("/api/trips/:tripId", () => HttpResponse.json({ trip })),
    );

    render(<PageScreen tripId={trip.tripId} pageId={page.id} />);

    expect(await screen.findByText("no costs on this day")).toBeTruthy();
  });
});
