import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { pageFixture, tripDetailFixture } from "@tc/factories";
import { SYSTEM_ACTOR_ID } from "@tc/contracts";
import { DEFAULT_TEMPLATES } from "@tc/pages";
import { makePagesHandlers } from "@/mocks/handlers";
import type { AskEvent, AskScope, AskWireMessage } from "@/lib/apiClient";

const TRIP_ID = "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f";
const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

// The wire is mocked at `askAssistant` and nothing else is, for the reason
// `PageAssistant.test.tsx` gives: `apiClient.test.ts` already owns SSE frame
// parsing, and these tests are about what this SCREEN does with an event once
// it has one. `fetchTripDetail` stays real, through MSW, because the title
// block's meta line is one of the things under test.
const askAssistantMock = vi.fn();
vi.mock("@/lib/apiClient", async (orig) => {
  const actual = await orig<typeof import("@/lib/apiClient")>();
  return { ...actual, askAssistant: (...args: unknown[]) => askAssistantMock(...args) };
});

// Imported after the `vi.mock` calls, which are hoisted anyway — written this
// way so a reader is not left wondering whether the screen got the real client.
import { NotebookScreen } from "./NotebookScreen";

/** The turn as `askAssistant` runs it: emit these events, then resolve `ok`. */
function turnEmitting(...events: AskEvent[]) {
  return async (
    _tripId: string,
    _messages: AskWireMessage[],
    _scope: AskScope,
    onEvent: (e: AskEvent) => void,
  ) => {
    for (const event of events) onEvent(event);
    return { ok: true as const, value: { text: "" } };
  };
}

const server = setupServer(
  // Every render of this screen now fetches the trip: SPEC §23 puts the trip
  // name in the title block, and with the tab bar scoped (§22) there is no trip
  // header above this route to carry it. A suite-wide default rather than a
  // line in each test — without it `onUnhandledRequest: "error"` fires on every
  // one, which is how a genuinely unhandled request later gets missed.
  http.get("/api/trips/:tripId", () => HttpResponse.json({ trip: tripDetailFixture() })),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
beforeEach(() => {
  pushMock.mockClear();
  askAssistantMock.mockReset();
  askAssistantMock.mockImplementation(turnEmitting({ type: "text", delta: "Two notebooks, both trip-wide." }));
});
afterEach(() => {
  server.resetHandlers();
  cleanup();
});
afterAll(() => server.close());

describe("NotebookScreen", () => {
  it("lists the trip's notebooks by title", async () => {
    const overview = pageFixture({ id: "11111111-1111-4111-8111-111111111111", title: "Trip Overview" });
    const daySheet = pageFixture({ id: "22222222-2222-4222-8222-222222222222", title: "Day Sheet" });
    server.use(...makePagesHandlers([overview, daySheet]));

    render(<NotebookScreen tripId={TRIP_ID} />);

    // Scoped to the list: the gallery above offers a card called "Trip
    // Overview" too, because a seeded notebook is named after its template.
    const list = await screen.findByRole("region", { name: "Your notebooks" });
    expect(within(list).getByText("Trip Overview")).toBeTruthy();
    expect(within(list).getByText("Day Sheet")).toBeTruthy();
    // A notebook has no scope to name (SPEC §18), so the badge #126 shipped
    // here must not come back. Removing the positive assertion only stopped
    // this test requiring the badge — it did not stop it passing WITH one,
    // which is the invariant the PR actually establishes (CodeRabbit on PR 129).
    expect(within(list).queryByText(/Trip-wide|Day \d/)).toBeNull();
  });

  it("creates a new page via the client and navigates to it", async () => {
    const onCreate = vi.fn();
    server.use(...makePagesHandlers([], { onCreate }));

    render(<NotebookScreen tripId={TRIP_ID} />);
    await waitFor(() => expect(screen.queryByText(/Loading/)).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Start from Blank notebook" }));

    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith(expect.stringContaining(`/trips/${TRIP_ID}/pages/`)));
  });

  it("renames a page via the client", async () => {
    const page = pageFixture({ tripId: TRIP_ID });
    const onUpdate = vi.fn();
    server.use(...makePagesHandlers([page], { onUpdate }));

    render(<NotebookScreen tripId={TRIP_ID} />);
    const list = await screen.findByRole("region", { name: "Your notebooks" });
    expect(within(list).getByText(page.title)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: `Rename ${page.title}` }));
    const input = screen.getByLabelText(`Rename ${page.title}`) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Renamed Page" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith(page.id, expect.objectContaining({ title: "Renamed Page" })),
    );
    expect(await within(list).findByText("Renamed Page")).toBeTruthy();
  });

  it("deletes a page via the client", async () => {
    const page = pageFixture({ tripId: TRIP_ID });
    const onDelete = vi.fn();
    server.use(...makePagesHandlers([page], { onDelete }));

    render(<NotebookScreen tripId={TRIP_ID} />);
    const list = await screen.findByRole("region", { name: "Your notebooks" });
    expect(within(list).getByText(page.title)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: `Delete ${page.title}` }));

    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(page.id));
    await waitFor(() => expect(within(list).queryByText(page.title)).toBeNull());
  });

  // SPEC §7's index half. Each of these asserts one thing the design asked for
  // that the flat list did not say — not that a component rendered.

  it("states the standfirst's promise that pages follow the plan", async () => {
    server.use(...makePagesHandlers([pageFixture({ tripId: TRIP_ID })]));

    render(<NotebookScreen tripId={TRIP_ID} />);

    // The promise is the point: a notebook that follows the plan looks exactly
    // like one that does not until something moves.
    expect(await screen.findByText(/Move a day or a stop and every page here follows it/)).toBeTruthy();
  });

  it("tells the three provenances apart — seeded, the reader's own, and a collaborator's", async () => {
    const seeded = pageFixture({
      id: "11111111-1111-4111-8111-111111111111",
      tripId: TRIP_ID,
      title: "Trip Overview",
      actorId: SYSTEM_ACTOR_ID,
    });
    const mine = pageFixture({
      id: "22222222-2222-4222-8222-222222222222",
      tripId: TRIP_ID,
      title: "Packing",
      actorId: "dev-alice",
    });
    // The case that used to read "Yours": a notebook somebody ELSE on this
    // shared trip wrote. `actorId` alone cannot tell it from the reader's own,
    // which is why the route sends `viewerId` (Copilot, PR #126).
    const theirs = pageFixture({
      id: "33333333-3333-4333-8333-333333333333",
      tripId: TRIP_ID,
      title: "Bob's notes",
      actorId: "dev-bob",
    });
    server.use(...makePagesHandlers([seeded, mine, theirs], { viewerId: "dev-alice" }));

    render(<NotebookScreen tripId={TRIP_ID} />);

    expect(await screen.findByText(/Comes with your trip · edited/)).toBeTruthy();
    expect(screen.getByText(/^Yours · edited/)).toBeTruthy();
    expect(screen.getByText(/^From another traveler · edited/)).toBeTruthy();
  });

  it("dates each notebook relatively, not as a wall-clock timestamp", async () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    server.use(...makePagesHandlers([pageFixture({ tripId: TRIP_ID, updatedAt: threeHoursAgo })]));

    render(<NotebookScreen tripId={TRIP_ID} />);

    // "3 hours ago" answers "is this stale?"; the locale timestamp it replaced
    // answered "at what second?", which nobody asks of a notebook.
    expect(await screen.findByText(/edited 3 hours ago/)).toBeTruthy();
  });

  it("offers the two template seeds and a blank, and creates from the seed's own content", async () => {
    const onCreate = vi.fn();
    server.use(...makePagesHandlers([], { onCreate }));
    const dayTemplate = DEFAULT_TEMPLATES.find((t) => t.key === "day-sheet")!;

    render(<NotebookScreen tripId={TRIP_ID} />);
    await waitFor(() => expect(screen.queryByText(/Loading/)).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: `Start from ${dayTemplate.title}` }));

    // The seed's OWN context and content, not a blank doc with the seed's
    // name — the gallery is a second way to reach `templates.ts`, not a
    // second definition of what those templates contain.
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith(
        TRIP_ID,
        expect.objectContaining({
          title: dayTemplate.title,
          context: dayTemplate.buildContext(TRIP_ID),
          content: dayTemplate.content,
        }),
      ),
    );
  });

  // SPEC §23 — the phone assistant, and this is the ONE screen where §23's
  // *"no entry point at all"* was literally true (KI-2026-09-05-aa audited the
  // other three, which all had one). So these are not "the pill still renders"
  // tests: each is a claim §23 or DRIFT build-check 4c makes that nothing else
  // in the suite holds.
  describe("SPEC §23's Ask pill and sheet", () => {
    async function openSheet() {
      server.use(...makePagesHandlers([pageFixture({ tripId: TRIP_ID })]));
      render(<NotebookScreen tripId={TRIP_ID} />);
      await screen.findByRole("region", { name: "Your notebooks" });
      await userEvent.click(screen.getByRole("button", { name: "Ask" }));
    }

    // §23: *"the Notebook index gained a title block — 'Notebook' at title
    // scale with the trip name as its meta line… That is where the trip name
    // lives now."* Load-bearing rather than decorative: since §22 scoped the
    // tab bar, this route sits under no trip header of any kind, so without
    // this line the phone Notebook names no trip at all.
    it("names the trip under the heading, because nothing else on this screen does", async () => {
      server.use(
        ...makePagesHandlers([pageFixture({ tripId: TRIP_ID })]),
        http.get("/api/trips/:tripId", () => HttpResponse.json({ trip: tripDetailFixture({ name: "Kyoto 2027" }) })),
      );

      render(<NotebookScreen tripId={TRIP_ID} />);

      expect(await screen.findByText("Kyoto 2027")).toBeTruthy();
    });

    // The scope is what §23 is actually about — *"the pill inherits the
    // surface's scope"*, which is why it is a pill and not a fourth tab. On
    // this surface no page is open, so the honest scope is the whole trip, and
    // the sheet's first line has to SAY so ("scope is stated, never inferred by
    // the user"). Both halves, because a line that says one thing while the
    // wire carries another is the failure worth catching.
    it("opens a sheet scoped to the trip's Notebook, and says so", async () => {
      await openSheet();

      expect(screen.getByText("Asking about this trip’s Notebook")).toBeTruthy();

      // DRIFT §2i asks for the empty-state hint to be derived from the surface
      // too, not only the context line. The rail's default sentence — "Ask
      // about this trip and the conversation stays here" — is the one that
      // sounds nearly right on this screen and is still the wrong promise: the
      // Notebook sheet reads pages, not the itinerary.
      expect(screen.getByText(/It reads the page you have open/)).toBeTruthy();
      expect(screen.queryByText(/the conversation stays here/)).toBeNull();

      await userEvent.type(screen.getByPlaceholderText(/Ask about this trip/i), "Which of these is stale?{Enter}");
      await waitFor(() => expect(askAssistantMock).toHaveBeenCalled());
      const [, , scope] = askAssistantMock.mock.calls[0]!;
      expect(scope).toEqual({ kind: "trip" });
    });

    // DRIFT.md build-check 4c: *"An open assistant sheet must block the tab
    // bar. Switching tabs behind an open sheet changes its scope mid-
    // conversation."* The scrim is the mechanism, and it is `position: fixed`
    // — so what this asserts is that it is MOUNTED, and the review note beside
    // it records that no ancestor of this mount point creates a containing or
    // stacking block that would trap it (`(app)/layout.tsx` puts only a
    // padding-only wrapper between `<body>` and here).
    it("covers the phone tab bar with a scrim while the sheet is open", async () => {
      await openSheet();

      expect(screen.getByTestId("assistant-scrim")).toBeTruthy();
    });

    // **Closing hangs up on the turn.** The thread lives on this screen, so
    // unmounting the sheet cancels nothing by itself — the same defect Copilot
    // and CodeRabbit found on PR 139 for the notebook page. Asserting the
    // sheet went away would pass whether or not the request was abandoned;
    // asserting the SIGNAL is what makes this about hanging up.
    it("hangs up on a turn in flight when the sheet is dismissed", async () => {
      let signal: AbortSignal | null = null;
      askAssistantMock.mockImplementation(
        async (
          _t: string,
          _m: AskWireMessage[],
          _s: AskScope,
          _onEvent: (e: AskEvent) => void,
          abortSignal: AbortSignal,
        ) => {
          signal = abortSignal;
          return await new Promise<never>(() => {});
        },
      );
      await openSheet();
      await userEvent.type(screen.getByPlaceholderText(/Ask about this trip/i), "Which of these is stale?{Enter}");
      await waitFor(() => expect(signal).not.toBeNull());
      expect(signal!.aborted).toBe(false);

      await userEvent.click(screen.getByRole("button", { name: "Hide" }));

      await waitFor(() => expect(screen.queryByRole("complementary", { name: "Assistant" })).toBeNull());
      expect(signal!.aborted).toBe(true);
    });

    // A trip-scoped turn reaches the WRITE tools, so unlike a notebook page
    // this surface really can be handed a proposal — and it is the board, not
    // this screen, that can land one. Left unhandled the proposal is dropped
    // silently and the answer promises a change nothing carries out, which
    // reads as the assistant being broken rather than as this surface
    // declining (`PageScreen`'s READING_REFUSAL, same argument).
    it("says where a proposal has to be applied instead of dropping it", async () => {
      askAssistantMock.mockImplementation(
        turnEmitting(
          { type: "text", delta: "I can move that." },
          {
            type: "proposal",
            proposal: { proposalId: "p1", changes: [{ type: "activity.move", text: "Move “Dinner” to day 2" }], commands: [], skipped: [] },
          },
        ),
      );
      await openSheet();

      await userEvent.type(screen.getByPlaceholderText(/Ask about this trip/i), "Move dinner to Tuesday{Enter}");

      // The answer's own paragraph. Two other nodes carry the same string —
      // the turn's wrapper, which holds nothing else, and the `sr-only` live
      // region that reads the answer out — so an unqualified query is
      // ambiguous rather than wrong. (That the live region carries it too is
      // the right behaviour: a refusal a screen-reader user does not hear is
      // a refusal that reads as silence.)
      expect(await screen.findByText(/open Plan and ask again/i, { selector: "p:not(.sr-only)" })).toBeTruthy();
    });
  });
});
