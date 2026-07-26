import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { tripDetailFixture, historyFixture } from "@/mocks/fixtures";

const sendTripCommandMock = vi.fn();
const sendTripCommandBatchMock = vi.fn();

function oneDayTripDetailFixture() {
  return tripDetailFixture({
    days: [{ dayId: "d1", activityIds: [], date: null, costSubtotal: 0 }],
  });
}

vi.mock("@/lib/apiClient", async (orig) => {
  const actual = await orig<typeof import("@/lib/apiClient")>();
  return {
    ...actual,
    fetchTripDetail: vi.fn().mockResolvedValue({ ok: true, value: oneDayTripDetailFixture() }),
    fetchTripHistory: vi.fn().mockResolvedValue({ ok: true, value: historyFixture("x") }),
    fetchTripDetailAt: vi.fn(),
    sendTripCommand: (...args: unknown[]) => sendTripCommandMock(...args),
    sendTripCommandBatch: (...args: unknown[]) => sendTripCommandBatchMock(...args),
  };
});

import { TripProvider, useTrip } from "./TripProvider";

beforeEach(() => {
  sendTripCommandMock.mockReset();
  sendTripCommandBatchMock.mockReset();
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

function OptimisticProbe() {
  const { activeTrip, error, dispatch } = useTrip();
  return (
    <div>
      <span data-testid="dayCount">{activeTrip?.days.length ?? 0}</span>
      <span data-testid="error">{error ?? "none"}</span>
      <button onClick={() => dispatch({ type: "AddDay", tripId: "x", dayId: "d-new" } as never)}>add-day</button>
    </div>
  );
}
function twoDayDetail() {
  const d = oneDayTripDetailFixture();
  return { ...d, days: [...d.days, { dayId: "d-new", activityIds: [], date: null, costSubtotal: 0 }] };
}

describe("TripProvider optimistic overlay (M6)", () => {
  it("renders the optimistic change before the server responds", async () => {
    let resolveSend: (v: unknown) => void = () => {};
    sendTripCommandMock.mockReturnValue(
      new Promise((res) => {
        resolveSend = res;
      }),
    );

    render(
      <TripProvider tripId="x">
        <OptimisticProbe />
      </TripProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("dayCount").textContent).toBe("1"));

    fireEvent.click(screen.getByRole("button", { name: "add-day" }));
    // Applied instantly, before we resolve the send.
    await waitFor(() => expect(screen.getByTestId("dayCount").textContent).toBe("2"));

    resolveSend({ ok: true, value: { detail: twoDayDetail(), history: historyFixture("x") } });
    await waitFor(() => expect(screen.getByTestId("dayCount").textContent).toBe("2"));
  });

  it("rolls back the optimistic change on a server failure", async () => {
    sendTripCommandMock.mockResolvedValue({ ok: false, error: { status: 500, message: "boom", code: "server-error" } });

    render(
      <TripProvider tripId="x">
        <OptimisticProbe />
      </TripProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("dayCount").textContent).toBe("1"));

    fireEvent.click(screen.getByRole("button", { name: "add-day" }));
    await waitFor(() => expect(screen.getByTestId("error").textContent).toBe("boom"));
    await waitFor(() => expect(screen.getByTestId("dayCount").textContent).toBe("1")); // reverted
  });
});

// The AI planning batch is decided server-side, so the client never held its
// commands to predict from — it reconciles by dropping the authoritative
// { detail, history } straight into confirmed state (no send, no refetch).
function ApplyOutcomeProbe() {
  const { activeTrip, applyOutcome } = useTrip();
  return (
    <div>
      <span data-testid="dayCount">{activeTrip?.days.length ?? 0}</span>
      <button onClick={() => applyOutcome({ detail: twoDayDetail(), history: historyFixture("x") })}>
        apply-outcome
      </button>
    </div>
  );
}

describe("TripProvider applyOutcome (AI plan reconciliation)", () => {
  it("replaces confirmed state from the outcome without sending a command", async () => {
    render(
      <TripProvider tripId="x">
        <ApplyOutcomeProbe />
      </TripProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("dayCount").textContent).toBe("1"));

    fireEvent.click(screen.getByRole("button", { name: "apply-outcome" }));

    // Board reflects the server-decided outcome directly...
    await waitFor(() => expect(screen.getByTestId("dayCount").textContent).toBe("2"));
    // ...and nothing was sent to the command endpoints (no optimistic round-trip).
    expect(sendTripCommandMock).not.toHaveBeenCalled();
    expect(sendTripCommandBatchMock).not.toHaveBeenCalled();
  });
});
