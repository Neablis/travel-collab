import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import type { SuggestionChange, TripRole } from "@tc/contracts";
import { tripDetailFixture, uuidFrom } from "@tc/factories";
import { makeTripHandlers } from "@/mocks/handlers";
import { TripProvider, useTrip } from "./TripProvider";

// Through the provider and MSW: the claims are about when the list is read
// over the wire, and the provider is where the hook's triggers are wired.

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  server.events.removeAllListeners();
  cleanup();
});
afterAll(() => server.close());

/** Every request to a suggestions route, as `METHOD path-tail`. */
function suggestionRequests() {
  const seen: string[] = [];
  server.events.on("request:start", ({ request }) => {
    const path = new URL(request.url).pathname;
    if (path.includes("/suggestions")) seen.push(`${request.method} ${path.replace(/^.*\/suggestions/, "suggestions")}`);
  });
  return seen;
}

const NEW_DAY = uuidFrom(8101, 3);

function Probe({ changeId }: { changeId?: string }) {
  const { trip, suggestions, dispatch, draft } = useTrip();
  return (
    <div>
      <span data-testid="days">{trip?.days.length ?? "-"}</span>
      <span data-testid="suggestions">
        {suggestions === null ? "none" : suggestions.changes.map((c) => c.status).join(",") || "empty"}
      </span>
      <button onClick={() => void suggestions?.resolve(changeId!, "accept")}>accept</button>
      <button onClick={() => void dispatch({ type: "AddDay", tripId: trip!.tripId, dayId: NEW_DAY })}>add</button>
      <button onClick={() => void draft?.send()}>send</button>
    </div>
  );
}

function pendingAddDay(tripId: string): SuggestionChange {
  return {
    id: uuidFrom(8102, 3),
    suggestionId: uuidFrom(8103, 3),
    tripId,
    authorId: "dev-bob",
    note: null,
    createdAt: "2026-10-03T10:00:00.000Z",
    commands: [{ type: "AddDay", tripId, dayId: NEW_DAY }],
    description: "Added a day",
    status: "pending",
    dependsOn: [],
    resolvedBy: null,
    resolvedAt: null,
  };
}

async function mount(myRole: TripRole, suggestions: (tripId: string) => SuggestionChange[] = () => []) {
  const fixture = tripDetailFixture();
  const seeded = suggestions(fixture.tripId);
  server.use(...makeTripHandlers(fixture, { myRole, suggestions: seeded }));
  const seen = suggestionRequests();
  render(
    <TripProvider tripId={fixture.tripId}>
      <Probe changeId={seeded[0]?.id} />
    </TripProvider>,
  );
  await waitFor(() => expect(screen.getByTestId("days").textContent).not.toBe("-"));
  return { fixture, seen };
}

/** Long enough for any read the provider was going to make to reach the network. */
const settle = () => act(() => new Promise((r) => setTimeout(r, 50)));

describe("useTripSuggestions, through TripProvider", () => {
  it("reads the list on mount for a suggester", async () => {
    const { seen } = await mount("suggester");
    await waitFor(() => expect(screen.getByTestId("suggestions").textContent).toBe("empty"));
    expect(seen).toEqual(["GET suggestions"]);
  });

  // The list is 404 to a viewer (spec §2.4: ghosts are never shown to one).
  it("never reads it for a viewer, and exposes none", async () => {
    const { seen } = await mount("viewer");
    await settle();
    expect(seen).toEqual([]);
    expect(screen.getByTestId("suggestions").textContent).toBe("none");
  });

  // W16 end to end: the poll's revision is what tells this board that someone
  // else sent or resolved a suggestion. Focus polls even on a solo trip.
  it("reads the list again when the poll's revision moves, and only then", async () => {
    const { seen } = await mount("owner");
    await waitFor(() => expect(seen).toEqual(["GET suggestions"]));

    // The first poll reports the revision the mount read already holds.
    act(() => void window.dispatchEvent(new Event("focus")));
    await settle();
    expect(seen).toEqual(["GET suggestions"]);

    server.use(
      http.get("/api/trips/:tripId/events", () =>
        HttpResponse.json({ headSeq: 0, events: [], resync: false, suggestionsRev: "moved" }),
      ),
    );
    act(() => void window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(seen).toEqual(["GET suggestions", "GET suggestions"]));
  });

  it("accept calls the route, then re-reads the list and the trip", async () => {
    const { fixture, seen } = await mount("owner", (tripId) => [pendingAddDay(tripId)]);
    await waitFor(() => expect(screen.getByTestId("suggestions").textContent).toBe("pending"));

    fireEvent.click(screen.getByRole("button", { name: "accept" }));

    // The list holds pending changes only (W53), so the accepted one leaves it.
    await waitFor(() => expect(screen.getByTestId("suggestions").textContent).toBe("empty"));
    expect(seen).toEqual([
      "GET suggestions",
      `POST suggestions/changes/${pendingAddDay(fixture.tripId).id}`,
      "GET suggestions",
    ]);
    // The accepted day is now confirmed state, read back from the server.
    await waitFor(() => expect(screen.getByTestId("days").textContent).toBe(String(fixture.days.length + 1)));
  });

  it("re-reads the list once a suggester's draft is stored", async () => {
    const { seen } = await mount("suggester");
    await waitFor(() => expect(seen).toEqual(["GET suggestions"]));

    fireEvent.click(screen.getByRole("button", { name: "add" }));
    fireEvent.click(screen.getByRole("button", { name: "send" }));

    await waitFor(() => expect(screen.getByTestId("suggestions").textContent).toBe("pending"));
    expect(seen).toEqual(["GET suggestions", "POST suggestions", "GET suggestions"]);
  });
});
