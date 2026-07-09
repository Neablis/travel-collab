import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { setupServer } from "msw/node";
import { TripBoardScreen } from "@/components/board/TripBoardScreen";
import { tripDetailFixture } from "@/mocks/fixtures";
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
});
