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

const server = setupServer(
  // Every notebook page fetches the account now (ADR-037 open question 2), so
  // this is a suite-wide default rather than a line in each test. Individual
  // tests override it with `server.use` when the account is what they are
  // about. Without it the suite's `onUnhandledRequest: "error"` logs on every
  // test, which is how a genuinely unhandled request later gets missed.
  http.get("/api/account/preferences", () =>
    HttpResponse.json({ preferences: { displayName: null, homeAirport: null, distanceUnit: "km" } }),
  ),
  // Same reasoning as the account default above: every notebook page now asks
  // for the trip's addressable collections (ADR-037 open question 4).
  http.get("/api/trips/:tripId/globals", () =>
    HttpResponse.json({ globals: { days: [], cities: [], tags: [], bookedCount: 0 } }),
  ),
);
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

// ADR-037 open question 2: the account is always in scope. This is the only
// test that proves `WidgetContext.user` actually ARRIVES — everything else
// about it is types, and a typed field nothing populates renders "not set up"
// forever without failing anything.
describe("PageScreen and the account (ADR-037 open question 2)", () => {
  const pageWithAccountName = {
    type: "doc" as const,
    content: [
      { type: "paragraph", content: [{ type: "macro", attrs: { name: "account.name", params: {} } }] },
    ],
  };

  async function renderWithPreferences(preferences: unknown | null) {
    const trip = tripDetailFixture();
    const page = pageFixture({ tripId: trip.tripId, content: pageWithAccountName as never });
    server.use(
      ...makePagesHandlers([page]),
      http.get("/api/trips/:tripId", () => HttpResponse.json({ trip })),
      http.get("/api/account/preferences", () =>
        preferences === null
          ? HttpResponse.json({ error: "boom" }, { status: 500 })
          : HttpResponse.json({ preferences }),
      ),
    );
    render(<PageScreen tripId={trip.tripId} pageId={page.id} />);
  }

  it("renders the account's chosen name in a widget on the page", async () => {
    await renderWithPreferences({ displayName: "Priya", homeAirport: "SFO", distanceUnit: "km" });
    expect(await screen.findByText("Priya")).toBeTruthy();
  });

  it("still opens the notebook when the preferences request fails, and says the widget is not set up", async () => {
    // The trade this makes explicit: a preferences fetch is not a page
    // dependency. Failing it must cost one widget, never the notebook — the
    // page below must still render rather than showing the error screen.
    await renderWithPreferences(null);
    expect(await screen.findByText("no name set")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says the widget is not set up rather than falling back to anything else", async () => {
    // ADR-037 decision 6, and the reason this widget does NOT use
    // `lib/displayName.ts`'s fallback chain: that chain ends at the email
    // address, and a notebook is a shared document.
    //
    // `homeAirport` is deliberately NON-empty. CodeRabbit caught this on #134:
    // with every other preference null too, a resolver that wrongly fell back
    // to a sibling field would still render "no name set" and this test would
    // still pass. A real value there makes that fallback observable: the widget
    // must still say "no name set", and "SFO" must appear nowhere.
    //
    // CodeRabbit also suggested scoping the assertion to the widget's own node
    // via `closest('[data-macro-name="account.name"]')`. Not taken: that trips
    // `testing-library/no-node-access`, which KI-2026-09-02-b grandfathers for
    // existing violations and says not to add more of. It buys nothing here
    // either — breaking the resolver to fall back to `homeAirport` fails the
    // first assertion below on its own, which is how this was checked.
    await renderWithPreferences({ displayName: null, homeAirport: "SFO", distanceUnit: "km" });
    expect(await screen.findByText("no name set")).toBeTruthy();
    expect(screen.queryByText("SFO")).toBeNull();
  });
});
