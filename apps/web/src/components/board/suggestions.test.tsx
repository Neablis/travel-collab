import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

// Mitchell's preview comment, 2026-10-04 (W76): "A suggested activity should
// stand out more and look more obviously placeholder till approved." Anything
// not yet on the confirmed trip says so in words, on the block, and in its
// name — never by colour alone.
describe("what is not on the trip yet reads as a placeholder", () => {
  const cardFor = (title: RegExp) =>
    screen.getAllByTestId(/^activity-card-/).find((card) => within(card).queryByRole("button", { name: title }) !== null)!;

  it("marks a suggestion Suggested, as a ghost and on the stop it would change", async () => {
    mount("owner", (tripId) => [
      addGelato(tripId),
      change(tripId, "Renamed Colosseum tour", [{ type: "UpdateActivity", tripId, activityId: COLOSSEUM, title: "Colosseum at dawn" }]),
    ]);

    const ghost = await screen.findByRole("button", { name: "Suggested: Added Gelato to Day 2" });
    expect(ghost.getAttribute("data-provisional")).toBe("suggested");
    expect(within(ghost).getByText("Suggested")).toBeTruthy();

    expect(await screen.findByRole("button", { name: "Suggested change to Colosseum tour" })).toBeTruthy();
    const colosseum = cardFor(/^Edit Colosseum tour,.*, has a suggested change$/);
    expect(colosseum.getAttribute("data-provisional")).toBe("suggested");
    expect(within(colosseum).getByText("Suggested")).toBeTruthy();
  });

  it("marks a suggester's unsent stop Not sent, and an unsent edit to an existing stop too", async () => {
    sessionUserId = "dev-sam";
    mount("suggester", () => []);
    expect(await screen.findByText("Suggester")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Add stop" }));
    const sheet = await screen.findByRole("dialog");
    fireEvent.change(within(sheet).getByLabelText("What or where"), { target: { value: "Gelato" } });
    fireEvent.change(within(sheet).getByLabelText("Start", { exact: true }), { target: { value: "14:00" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Add stop" }));

    await screen.findByRole("button", { name: /^Edit Gelato,.*, not sent$/ });
    const gelato = cardFor(/^Edit Gelato/);
    expect(gelato.getAttribute("data-provisional")).toBe("draft");
    expect(within(gelato).getByText("Not sent")).toBeTruthy();

    // An existing stop the draft changes keeps its look, and carries the pill.
    const colosseum = cardFor(/^Edit Colosseum tour/);
    expect(colosseum.getAttribute("data-provisional")).toBeNull();
    fireEvent.click(within(colosseum).getByRole("button", { name: /^Edit Colosseum tour/ }));
    const editor = await screen.findByRole("dialog");
    fireEvent.change(within(editor).getByLabelText("What or where"), { target: { value: "Colosseum at dawn" } });
    fireEvent.click(within(editor).getByRole("button", { name: "Save" }));

    await screen.findByRole("button", { name: /^Edit Colosseum at dawn,.*, not sent$/ });
    const edited = cardFor(/^Edit Colosseum at dawn/);
    expect(edited.getAttribute("data-provisional")).toBe("draft-change");
    expect(within(edited).getByText("Not sent")).toBeTruthy();
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

    // The suggested stop is on the board, so it is not in this list, but the
    // chip still lists it (W74), under the day it is drawn on.
    expect(within(list).queryByText("Added Gelato to Day 2")).toBeNull();
    const onBoard = screen.getByRole("list", { name: "Suggestions on the board" });
    const gelato = within(onBoard).getByRole("listitem");
    expect(within(gelato).getByText("Added Gelato to Day 2")).toBeTruthy();
    expect(within(gelato).getByText(/^Day 2/)).toBeTruthy();
    expect(within(gelato).getByRole("button", { name: "Accept: Added Gelato to Day 2" })).toHaveProperty("disabled", false);
  });

  // Mitchell's production test, 2026-10-04 (W74): with every change on the
  // board the chip said "Every suggestion is on the board." and offered
  // nothing, so an owner who opened it never found Accept or Dismiss.
  it("reads 1 suggestion, singular, accepts it from the list, and is gone once nothing is pending", async () => {
    const { resolved, seeded } = mount("owner", (tripId) => [addGelato(tripId)]);
    fireEvent.click(await screen.findByRole("button", { name: "1 suggestion" }));
    const onBoard = await screen.findByRole("list", { name: "Suggestions on the board" });
    expect(screen.queryByRole("list", { name: "Suggestions not on the board" })).toBeNull();

    fireEvent.click(within(onBoard).getByRole("button", { name: "Accept: Added Gelato to Day 2" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /suggestion/ })).toBeNull());
    expect(resolved).toEqual([{ changeId: seeded[0]!.id, action: "accept" }]);
  });

  it("lets the author withdraw an on-board change from the list", async () => {
    sessionUserId = "dev-sam";
    const { resolved, seeded } = mount("suggester", (tripId) => [addGelato(tripId)]);
    fireEvent.click(await screen.findByRole("button", { name: "1 suggestion" }));
    const onBoard = await screen.findByRole("list", { name: "Suggestions on the board" });
    expect(within(onBoard).queryByRole("button", { name: /^Accept/ })).toBeNull();

    fireEvent.click(await within(onBoard).findByRole("button", { name: "Withdraw: Added Gelato to Day 2" }));
    await waitFor(() => expect(resolved).toEqual([{ changeId: seeded[0]!.id, action: "withdraw" }]));
  });

  // Mitchell's preview comment, 2026-10-04 (W77): "the note from the
  // suggester ... looks like text from the website atm".
  it("shows a suggester's note as a message from them", async () => {
    mount("owner", (tripId) => [change(tripId, 'Renamed the trip to "Roma"', [{ type: "SetTripName", tripId, name: "Roma" }], { note: "Shorter, please" })]);
    fireEvent.click(await screen.findByRole("button", { name: "1 suggestion" }));

    const note = await screen.findByRole("figure", { name: /^Note from / });
    expect(within(note).getByText("Shorter, please")).toBeTruthy();
  });
});

// Mitchell's preview comment, 2026-10-04 (W77): a bulk accept at the top of the
// chip. One change at a time through the same accept as the per-change button,
// parents first; the first refusal stops it and leaves the rest pending.
describe("Accept all", () => {
  it("accepts every change that applies, parents first, and skips one that no longer applies", async () => {
    const { resolved, seeded } = mount("owner", (tripId) => {
      // In creation order, as the list always is; that a parent goes first
      // whatever the order is `acceptAll.test.ts`'s.
      const add = addGelato(tripId);
      const rename = change(tripId, "Renamed Gelato to Gelateria", [{ type: "UpdateActivity", tripId, activityId: GELATO, title: "Gelateria" }], {
        dependsOn: [add.id],
      });
      return [
        add,
        rename,
        change(tripId, "Removed Pantheon", [{ type: "RemoveActivity", tripId, activityId: uuidFrom(9999, 7) }]),
        change(tripId, 'Renamed the trip to "Roma"', [{ type: "SetTripName", tripId, name: "Roma" }]),
      ];
    });
    fireEvent.click(await screen.findByRole("button", { name: "4 suggestions" }));
    fireEvent.click(await screen.findByRole("button", { name: "Accept all" }));

    const [add, rename, , roma] = seeded;
    await waitFor(() => expect(resolved).toHaveLength(3));
    expect(resolved).toEqual([
      { changeId: add!.id, action: "accept" },
      { changeId: rename!.id, action: "accept" },
      { changeId: roma!.id, action: "accept" },
    ]);
    // The stale one is still there for the reviewer to dismiss.
    expect(await screen.findByRole("button", { name: "1 suggestion" })).toBeTruthy();
  });

  it("is a reviewer's: the author is not offered it", async () => {
    sessionUserId = "dev-sam";
    mount("suggester", (tripId) => [
      addGelato(tripId),
      change(tripId, 'Renamed the trip to "Roma"', [{ type: "SetTripName", tripId, name: "Roma" }]),
    ]);
    fireEvent.click(await screen.findByRole("button", { name: "2 suggestions" }));
    expect(await screen.findByRole("button", { name: "Withdraw: Added Gelato to Day 2" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Accept all" })).toBeNull();
  });

  it("stops at the first refusal, says which and why, and leaves the rest pending", async () => {
    const { resolved, seeded } = mount("owner", (tripId) => [
      change(tripId, 'Renamed the trip to "Roma"', [{ type: "SetTripName", tripId, name: "Roma" }]),
      change(tripId, "Set the currency to EUR", [{ type: "SetTripCurrency", tripId, currency: "EUR" }]),
      change(tripId, "Set the start date", [{ type: "SetTripStartDate", tripId, startDate: "2027-05-01" }]),
    ]);
    const refused = seeded[1]!.id;
    server.use(
      http.post("/api/trips/:tripId/suggestions/changes/:changeId", ({ params }) =>
        params.changeId === refused
          ? HttpResponse.json({ error: "This change no longer applies to the trip.", code: "does-not-apply" }, { status: 422 })
          : undefined,
      ),
    );
    fireEvent.click(await screen.findByRole("button", { name: "3 suggestions" }));
    fireEvent.click(await screen.findByRole("button", { name: "Accept all" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "“Set the currency to EUR” was not accepted: This change no longer applies to the trip. The rest are still pending.",
    );
    expect(resolved.map((r) => r.changeId)).toEqual([seeded[0]!.id, refused]);
    expect(screen.getByRole("button", { name: "2 suggestions" })).toBeTruthy();
  });
});

// #314's preview walk: the chip took two clicks to open straight after a
// suggestion arrived by the poll. Not reproduced here (2026-10-04); this holds
// the open state across what the arrival sets off — the list read, and the
// names re-read for an author who joined after they were taken (W67).
describe("a suggestion arriving by the poll", () => {
  it("opens the chip on the first click, and it stays open while the author's name is read", async () => {
    const { fixture } = mount("owner", () => []);
    const tripId = fixture.tripId;
    expect(await screen.findByRole("button", { name: /^Edit Colosseum tour/ })).toBeTruthy();
    const arrived = [
      change(tripId, "Moved Colosseum tour to Day 2", [{ type: "MoveActivity", tripId, activityId: COLOSSEUM, toDayId: DAY_2, position: 0 }], {
        authorId: "dev-newcomer",
      }),
      { ...addGelato(tripId), authorId: "dev-newcomer" },
    ];
    // The names' re-read is held until after the click, so the click lands
    // while it is still out, as it would on a real network; answered at once,
    // it landed before the chip could be found.
    let answerRecheck = () => {};
    const recheckAnswered = new Promise<void>((resolve) => (answerRecheck = resolve));
    server.use(
      http.get("/api/trips/:tripId/suggestions", () => HttpResponse.json({ changes: arrived, rev: "r-arrived" })),
      http.get("/api/trips/:tripId/events", () => HttpResponse.json({ headSeq: 0, events: [], resync: false, suggestionsRev: "r-arrived" })),
      http.get("/api/trips/:tripId/access", async () => {
        await recheckAnswered;
        return undefined;
      }),
    );
    fireEvent.focus(window);

    const chip = await screen.findByRole("button", { name: "2 suggestions" });
    await userEvent.setup().click(chip);
    expect(chip.getAttribute("aria-expanded")).toBe("true");
    expect(screen.queryByText(/Suggested by a former traveler/)).toBeNull();
    answerRecheck();
    // The witness that the re-read landed: the access mock does not list the
    // newcomer, so their by-line turns to "a former traveler" only then.
    expect(await screen.findAllByText(/Suggested by a former traveler/)).toHaveLength(2);
    expect(screen.getByRole("button", { name: "2 suggestions" }).getAttribute("aria-expanded")).toBe("true");
  });
});
