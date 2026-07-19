import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { tripDetailFixture, historyFixture } from "@/mocks/fixtures";

const sendTripCommandMock = vi.fn();
vi.mock("@/lib/apiClient", async (orig) => {
  const actual = await orig<typeof import("@/lib/apiClient")>();
  return {
    ...actual,
    fetchTripDetail: vi.fn().mockResolvedValue({ ok: true, value: tripDetailFixture() }),
    fetchTripHistory: vi.fn().mockResolvedValue({ ok: true, value: historyFixture("x") }),
    fetchTripDetailAt: vi.fn(),
    sendTripCommand: (...args: unknown[]) => sendTripCommandMock(...args),
  };
});

import { TripProvider, useTrip } from "./TripProvider";

beforeEach(() => {
  sendTripCommandMock.mockReset();
});

function Probe() {
  const { activeTrip, error, dispatch } = useTrip();
  return (
    <div>
      <span data-testid="trip">{activeTrip?.name}</span>
      <span data-testid="error">{error ?? "none"}</span>
      <button
        onClick={() => dispatch({ type: "AddDay", tripId: "x", dayId: "d9" } as never)}
      >
        dispatch
      </button>
    </div>
  );
}

describe("TripProvider dispatch — no-op command results (#7HuQy)", () => {
  it("does not set error for a no-op result and leaves error null", async () => {
    sendTripCommandMock.mockResolvedValue({
      ok: false,
      error: { status: 409, message: "This change would have no effect.", code: "no-op" },
    });

    render(
      <TripProvider tripId="x">
        <Probe />
      </TripProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("trip").textContent).toBe("Rome 2027"));

    fireEvent.click(screen.getByRole("button", { name: "dispatch" }));

    await waitFor(() => expect(sendTripCommandMock).toHaveBeenCalled());

    // Give any (incorrect) error-setting behavior a chance to flush before asserting.
    await waitFor(() => expect(screen.getByTestId("error").textContent).toBe("none"));
  });

  it("still surfaces a non-no-op error message", async () => {
    sendTripCommandMock.mockResolvedValue({
      ok: false,
      error: { status: 500, message: "Something went wrong.", code: "server-error" },
    });

    render(
      <TripProvider tripId="x">
        <Probe />
      </TripProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("trip").textContent).toBe("Rome 2027"));

    fireEvent.click(screen.getByRole("button", { name: "dispatch" }));

    await waitFor(() => expect(screen.getByTestId("error").textContent).toBe("Something went wrong."));
  });
});
