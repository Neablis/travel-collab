import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import type { BatchableCommand, SuggestionChange, TripDetail, TripRole } from "@tc/contracts";
import { activityFactory, tripDetailFixture, uuidFrom } from "@tc/factories";
import { TripBoardScreen } from "@/components/board/TripBoardScreen";
import { TripProvider } from "@/components/trip/context/TripProvider";
import { EditorHost } from "@/components/trip/context/EditorHost";
import { FocusProvider } from "@/components/trip/context/FocusProvider";
import { LensRouter } from "@/components/trip/context/LensRouter";
import { makeAccountPlanHandler, makeTripHandlers } from "@/mocks/handlers";

// Ghosts, the chip and resolving (spec §2.4), through the whole board screen
// and MSW: who sees which control is decided by the provider's role and the
// session, and an accept is only done once the trip has been read again. The
// overlay's own classification is `suggestionOverlay.test.ts`'s; these trips
// are chosen so each change lands in one obvious place.

const search = new URLSearchParams("view=Plan");
vi.mock("next/navigation", () => ({
  useSearchParams: () => search,
  usePathname: () => "/trips/x",
  useRouter: () => ({ replace: () => {} }),
}));

let sessionUserId = "dev-alice";
const server = setupServer(
  makeAccountPlanHandler(),
  http.get("/api/auth/session", () => HttpResponse.json({ user: { id: sessionUserId } })),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  cleanup();
  sessionUserId = "dev-alice";
});
afterAll(() => server.close());

const DAY_1 = uuidFrom(9101, 7);
const DAY_2 = uuidFrom(9102, 7);
const COLOSSEUM = uuidFrom(9103, 7);
const GELATO = uuidFrom(9104, 7);

function trip(): TripDetail {
  const tripId = uuidFrom(9100, 7);
  return tripDetailFixture({
    tripId,
    members: [
      { userId: "dev-alice", role: "owner" },
      { userId: "dev-sam", role: "suggester" },
    ],
    days: [
      { dayId: DAY_1, activityIds: [COLOSSEUM], date: null, costSubtotal: 0 },
      { dayId: DAY_2, activityIds: [], date: null, costSubtotal: 0 },
    ],
    activities: {
      [COLOSSEUM]: activityFactory.build({ activityId: COLOSSEUM, title: "Colosseum tour", timeWindow: { start: "09:00", end: "11:00" }, cost: null }),
    },
  });
}

let seq = 0;
function change(tripId: string, description: string, commands: BatchableCommand[], extra: Partial<SuggestionChange> = {}): SuggestionChange {
  seq += 1;
  return {
    id: uuidFrom(9200 + seq, 7),
    suggestionId: uuidFrom(9300, 7),
    tripId,
    authorId: "dev-sam",
    note: null,
    createdAt: "2026-10-03T10:00:00.000Z",
    commands,
    description,
    status: "pending",
    dependsOn: [],
    resolvedBy: null,
    resolvedAt: null,
    ...extra,
  };
}

const addGelato = (tripId: string) =>
  change(tripId, "Added Gelato to Day 2", [
    { type: "AddActivity", tripId, activityId: GELATO, dayId: DAY_2, title: "Gelato", timeWindow: { start: "14:00", end: "15:00" } },
  ]);

function mount(myRole: TripRole, changes: (tripId: string) => SuggestionChange[]) {
  const fixture = trip();
  const seeded = changes(fixture.tripId);
  const resolved: { changeId: string; action: string }[] = [];
  server.use(...makeTripHandlers(fixture, { myRole, suggestions: seeded }));
  server.events.on("request:start", ({ request }) => {
    const match = /\/suggestions\/changes\/([^/]+)$/.exec(new URL(request.url).pathname);
    if (match && request.method === "POST") {
      void request.clone().json().then((body: { action: string }) => resolved.push({ changeId: match[1]!, action: body.action }));
    }
  });
  render(
    <TripProvider tripId={fixture.tripId}>
      <FocusProvider>
        <EditorHost>
          <LensRouter>
            <TripBoardScreen tripId={fixture.tripId} />
          </LensRouter>
        </EditorHost>
      </FocusProvider>
    </TripProvider>,
  );
  return { fixture, seeded, resolved };
}

afterEach(() => server.events.removeAllListeners());

describe("suggestions on the board", () => {
  it("shows an owner a suggested stop whose Accept makes it real", async () => {
    const { seeded, resolved } = mount("owner", (tripId) => [addGelato(tripId)]);

    const ghost = await screen.findByRole("button", { name: "Suggested: Added Gelato to Day 2" });
    // A ghost is reviewed, never edited: no editable block exists for it yet.
    expect(screen.queryByRole("button", { name: /^Edit Gelato/ })).toBeNull();
    fireEvent.click(ghost);
    fireEvent.click(await screen.findByRole("button", { name: "Accept: Added Gelato to Day 2" }));

    await waitFor(() => expect(resolved).toEqual([{ changeId: seeded[0]!.id, action: "accept" }]));
    expect(await screen.findByRole("button", { name: /^Edit Gelato/ })).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Suggested: Added Gelato to Day 2" })).toBeNull());
  });

  it("marks a moved stop where it is and draws where it would land", async () => {
    mount("owner", (tripId) => [
      change(tripId, "Moved Colosseum tour to Day 2", [{ type: "MoveActivity", tripId, activityId: COLOSSEUM, toDayId: DAY_2, position: 0 }]),
    ]);

    const marker = await screen.findByRole("button", { name: "Suggested change to Colosseum tour" });
    expect(within(screen.getByRole("list", { name: "Day 2 timeline" })).getByRole("button", { name: "Suggested: Moved Colosseum tour to Day 2" })).toBeTruthy();
    fireEvent.click(marker);
    const review = await screen.findByRole("list", { name: "Suggested changes" });
    expect(within(review).getByRole("button", { name: "Accept: Moved Colosseum tour to Day 2" })).toBeTruthy();
    expect(within(review).getByRole("button", { name: "Dismiss: Moved Colosseum tour to Day 2" })).toBeTruthy();
  });

  it("shows a suggester Withdraw on their own change, and no Accept or Dismiss", async () => {
    sessionUserId = "dev-sam";
    const { seeded, resolved } = mount("suggester", (tripId) => [addGelato(tripId)]);

    fireEvent.click(await screen.findByRole("button", { name: "Suggested: Added Gelato to Day 2" }));
    fireEvent.click(await screen.findByRole("button", { name: "Withdraw: Added Gelato to Day 2" }));
    expect(screen.queryByRole("button", { name: /^Accept:/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Dismiss:/ })).toBeNull();
    await waitFor(() => expect(resolved).toEqual([{ changeId: seeded[0]!.id, action: "withdraw" }]));
  });

  it("shows a viewer neither ghosts nor the chip", async () => {
    mount("viewer", (tripId) => [addGelato(tripId), change(tripId, 'Renamed the trip to "Roma"', [{ type: "SetTripName", tripId, name: "Roma" }])]);

    expect(await screen.findByText("Viewer")).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Day 1 timeline" })).getByText(/^Colosseum tour,/)).toBeTruthy();
    // An absence means nothing until any read the board was going to make has
    // landed: without this, opening the gate to a viewer still passed.
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(screen.queryByRole("button", { name: /^Suggested/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /suggestions?$/ })).toBeNull();
  });
});

describe("the suggestions chip", () => {
  it("counts every pending change and lists the ones the board cannot draw", async () => {
    mount("owner", (tripId) => {
      const add = addGelato(tripId);
      return [
        add,
        // An edit to a stop that is itself only suggested has nowhere to sit (W42).
        change(tripId, "Renamed Gelato to Gelateria", [{ type: "UpdateActivity", tripId, activityId: GELATO, title: "Gelateria" }], {
          dependsOn: [add.id],
        }),
        change(tripId, 'Renamed the trip to "Roma"', [{ type: "SetTripName", tripId, name: "Roma" }], { note: "Shorter, please" }),
        change(tripId, "Removed Pantheon", [{ type: "RemoveActivity", tripId, activityId: uuidFrom(9999, 7) }]),
      ];
    });

    fireEvent.click(await screen.findByRole("button", { name: "4 suggestions" }));
    const list = await screen.findByRole("list", { name: "Suggestions not on the board" });

    // The dependent waits for its parent, and says which.
    expect(
      within(list).getByRole("button", { name: "Accept: Renamed Gelato to Gelateria", description: "Accept “Added Gelato to Day 2” first" }),
    ).toHaveProperty("disabled", true);
    expect(within(list).getByRole("button", { name: 'Accept: Renamed the trip to "Roma"' })).toHaveProperty("disabled", false);
    expect(screen.getByText(/Shorter, please/)).toBeTruthy();

    // Stale: nothing to accept, only to clear away.
    const stale = within(list)
      .getAllByRole("listitem")
      .find((item) => within(item).queryByText("Removed Pantheon"))!;
    expect(within(stale).getByText("No longer applies")).toBeTruthy();
    expect(within(stale).queryByRole("button", { name: /^Accept/ })).toBeNull();
    expect(within(stale).getByRole("button", { name: "Dismiss: Removed Pantheon" })).toBeTruthy();

    // The suggested stop itself is on the board, not in the list.
    expect(within(list).queryByText("Added Gelato to Day 2")).toBeNull();
  });

  it("reads 1 suggestion, singular, and is gone once nothing is pending", async () => {
    mount("owner", (tripId) => [addGelato(tripId)]);
    fireEvent.click(await screen.findByRole("button", { name: "1 suggestion" }));
    expect(await screen.findByText("Every suggestion is on the board.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Suggested: Added Gelato to Day 2" }));
    fireEvent.click(await screen.findByRole("button", { name: "Dismiss: Added Gelato to Day 2" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /suggestion/ })).toBeNull());
  });
});
