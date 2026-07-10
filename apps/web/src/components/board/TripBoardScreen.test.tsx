import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { TripCommand, type TripDetail } from "@tc/contracts";
import { TripBoardScreen } from "@/components/board/TripBoardScreen";
import { historyFixture, tripDetailFixture } from "@/mocks/fixtures";
import { makeTripHandlers } from "@/mocks/handlers";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  cleanup();
});
afterAll(() => server.close());

describe("TripBoardScreen", () => {
  it("loads the trip and adds a day through the command endpoint", async () => {
    const fixture = tripDetailFixture();
    server.use(...makeTripHandlers(fixture));
    render(<TripBoardScreen tripId={fixture.tripId} />);

    expect(await screen.findByRole("heading", { name: "Rome 2027" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "+ Add day" }));
    await waitFor(() => expect(screen.getAllByTestId("day-column")).toHaveLength(1));
  });

  it("shows an error state for a missing trip", async () => {
    const fixture = tripDetailFixture();
    server.use(...makeTripHandlers(fixture));
    render(<TripBoardScreen tripId="00000000-0000-4000-8000-000000000000" />);
    expect(await screen.findByRole("alert")).toBeTruthy();
  });

  it("history panel previews a past version read-only, and reverts to it", async () => {
    const ancientId = "55555555-5555-4555-8555-555555555555";
    const fixture = tripDetailFixture();
    const history = historyFixture(fixture.tripId);
    const pastFixture = tripDetailFixture({
      backlog: [ancientId],
      activities: {
        [ancientId]: { activityId: ancientId, title: "Ancient Rome", timeWindow: null, location: null, notes: null, anchors: [] },
      },
    });
    const onCommand = vi.fn<(command: TripCommand) => void>();
    server.use(...makeTripHandlers(fixture, { history, detailAt: { 2: pastFixture }, onCommand }));
    render(<TripBoardScreen tripId={fixture.tripId} />);

    expect(await screen.findByRole("heading", { name: "Rome 2027" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    fireEvent.click(screen.getByRole("button", { name: /Undid: Added "Colosseum" to the backlog/ }));

    await screen.findByText("Viewing version 2 (read-only)");
    expect(await screen.findByText("Ancient Rome")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Revert to here" }));
    await waitFor(() =>
      expect(onCommand).toHaveBeenCalledWith(
        expect.objectContaining({ type: "RevertToState", toSeq: 2 }),
      ),
    );
    await waitFor(() => expect(screen.queryByText(/Viewing version/)).toBeNull());
  });

  it("switches between Board, Map, Timeline and Calendar lenses", async () => {
    const fixture = tripDetailFixture();
    server.use(...makeTripHandlers(fixture));
    render(<TripBoardScreen tripId={fixture.tripId} />);

    expect(await screen.findByRole("heading", { name: "Rome 2027" })).toBeTruthy();
    expect(screen.getByTestId("backlog-column")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Map" }));
    expect(await screen.findByText(/No located activities yet/)).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Timeline" }));
    expect(await screen.findByText("No days yet.")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Calendar" }));
    expect(await screen.findByText("Set a start date to see the calendar.")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Board" }));
    expect(await screen.findByTestId("backlog-column")).toBeTruthy();
  });

  it("posts a SetTripStartDate command from the Calendar lens's TripDateControl", async () => {
    const fixture = tripDetailFixture();
    const onCommand = vi.fn<(command: TripCommand) => void>();
    server.use(...makeTripHandlers(fixture, { onCommand }));
    render(<TripBoardScreen tripId={fixture.tripId} />);

    expect(await screen.findByRole("heading", { name: "Rome 2027" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Calendar" }));
    await screen.findByText("Set a start date to see the calendar.");

    const dateInput = screen.getAllByLabelText("Start date")[0]!;
    fireEvent.change(dateInput, { target: { value: "2027-06-01" } });

    await waitFor(() =>
      expect(onCommand).toHaveBeenCalledWith(
        expect.objectContaining({ type: "SetTripStartDate", startDate: "2027-06-01" }),
      ),
    );
  });

  it("shows the conflict badge for an anchor-violating activity and clears it once the trip date resolves the conflict", async () => {
    const activityId = "44444444-4444-4444-8444-444444444444";
    const dayId = "66666666-6666-4666-8666-666666666666";

    const withConflict = tripDetailFixture({
      startDate: "2027-06-07", // a Monday
      days: [{ dayId, activityIds: [activityId], date: "2027-06-07" }],
      activities: {
        [activityId]: {
          activityId,
          title: "Weekday Market",
          timeWindow: null,
          location: null,
          notes: null,
          anchors: [{ kind: "dayOfWeek", days: ["tue", "wed"] }],
        },
      },
      conflicts: [
        {
          id: `anchor-violation:${activityId}:dayOfWeek`,
          kind: "anchor-violation",
          severity: "warn",
          subjects: [activityId],
          description: '"Weekday Market" has an anchor its current placement does not satisfy.',
          resolutions: ["Shift the trip's dates", "Move the activity to a different day", "Edit or remove the anchor"],
        },
      ],
    });
    const resolved: TripDetail = { ...withConflict, startDate: "2027-06-08", conflicts: [] };

    let detail = withConflict;
    server.use(
      http.get("/api/trips/:tripId", () => HttpResponse.json({ trip: detail })),
      http.post("/api/trips/:tripId/commands", async ({ request }) => {
        const command = TripCommand.parse(await request.json());
        if (command.type === "SetTripStartDate") detail = resolved;
        return HttpResponse.json({ ok: true, tripId: detail.tripId });
      }),
      http.get("/api/trips/:tripId/history", () =>
        HttpResponse.json({ history: { tripId: withConflict.tripId, entries: [], canUndo: false, canRedo: false } }),
      ),
    );

    render(<TripBoardScreen tripId={withConflict.tripId} />);

    expect(await screen.findByText("Weekday Market")).toBeTruthy();
    expect(screen.getByRole("img", { name: "conflict" })).toBeTruthy();

    const dateInput = screen.getAllByLabelText("Start date:")[0]!;
    fireEvent.change(dateInput, { target: { value: "2027-06-08" } });

    await waitFor(() => expect(screen.queryByRole("img", { name: "conflict" })).toBeNull());
  });
});
