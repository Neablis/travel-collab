import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { tripDetailFixture, historyFixture } from "@tc/factories";

const sendTripCommandMock = vi.fn();
const sendTripCommandBatchMock = vi.fn();
const fetchTripAccessMock = vi.fn();

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
    fetchTripAccess: (...args: unknown[]) => fetchTripAccessMock(...args),
    sendTripCommand: (...args: unknown[]) => sendTripCommandMock(...args),
    sendTripCommandBatch: (...args: unknown[]) => sendTripCommandBatchMock(...args),
  };
});

import { TripProvider, useTrip } from "./TripProvider";

const accessAs = (myRole: "owner" | "editor" | "viewer") => ({
  ok: true as const,
  value: { tripId: "x", myRole, members: [], invites: [] },
});

beforeEach(() => {
  sendTripCommandMock.mockReset();
  sendTripCommandBatchMock.mockReset();
  // Owner by default: every pre-existing test in this file was written
  // against a board its user can fully edit.
  fetchTripAccessMock.mockReset().mockResolvedValue(accessAs("owner"));
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

  // KI-36 changed this deliberately. This test used to be "rolls back the
  // optimistic change on a server failure" and asserted `dayCount` returned
  // to 1 — i.e. the failed edit was thrown away. That assertion was not
  // wrong about the code, it was wrong about the product: `failHead` threw
  // away the whole queue, not just the rejected command, and the user was
  // told only what the server said about the one command it named. A failed
  // send now RETAINS the queue and offers a retry, so the edit staying
  // visible is the point, not a regression.
  it("keeps the optimistic change visible on a server failure, and reports the error", async () => {
    sendTripCommandMock.mockResolvedValue({ ok: false, error: { status: 500, message: "boom", code: "server-error" } });

    render(
      <TripProvider tripId="x">
        <OptimisticProbe />
      </TripProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("dayCount").textContent).toBe("1"));

    fireEvent.click(screen.getByRole("button", { name: "add-day" }));
    await waitFor(() => expect(screen.getByTestId("error").textContent).toBe("boom"));
    // Retained, not reverted: the change is unsent, not undone.
    await waitFor(() => expect(screen.getByTestId("dayCount").textContent).toBe("2"));
  });
});

// ---------------------------------------------------------------------------
// KI-36: a failed send retains its queue, gates further sending on an explicit
// failure, and resumes only on a manual retry.
// ---------------------------------------------------------------------------

function SyncProbe() {
  const { activeTrip, error, sync, dispatch } = useTrip();
  return (
    <div>
      <span data-testid="dayCount">{activeTrip?.days.length ?? 0}</span>
      <span data-testid="error">{error ?? "none"}</span>
      <span data-testid="unsent">{sync.unsent}</span>
      <span data-testid="failedAt">{sync.failure?.at ?? "none"}</span>
      <span data-testid="failureMessage">{sync.failure?.message ?? "none"}</span>
      <button onClick={() => dispatch({ type: "AddDay", tripId: "x", dayId: "d-a" } as never)}>add-a</button>
      <button onClick={() => dispatch({ type: "AddDay", tripId: "x", dayId: "d-b" } as never)}>add-b</button>
      <button onClick={() => sync.retry()}>retry</button>
    </div>
  );
}

const rejection = { ok: false, error: { status: 500, message: "Server rejected: AddDay d-a", code: "server-error" } };

describe("TripProvider failed-send queue (KI-36)", () => {
  it("does not re-send the failed head on a loop — the failure gates the sender", async () => {
    // THE REGRESSION THIS FILE EXISTS FOR. `pending.length === 0` used to be
    // the only thing stopping the sequential sender, so simply retaining the
    // queue (KI-36's stated fix path) re-fired the effect and re-sent the same
    // rejected command without bound — measured at 41 sends in 300ms before
    // the gate was added. If the `optimistic.failure` clause is ever dropped
    // from the sender's early return, this test hangs on the count.
    sendTripCommandMock.mockResolvedValue(rejection);

    render(
      <TripProvider tripId="x">
        <SyncProbe />
      </TripProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("dayCount").textContent).toBe("1"));
    fireEvent.click(screen.getByRole("button", { name: "add-a" }));
    await waitFor(() => expect(screen.getByTestId("failedAt").textContent).not.toBe("none"));

    // Give a runaway loop several hundred milliseconds of room to run away in.
    await new Promise((r) => setTimeout(r, 300));
    expect(sendTripCommandMock).toHaveBeenCalledTimes(1);
  });

  it("retains the edit queued BEHIND the failed one instead of discarding it", async () => {
    // The KI's actual symptom: d-b was never sent, never rejected, and never
    // mentioned — it just vanished with an alert that only named d-a.
    let settleFirst: (v: unknown) => void = () => {};
    sendTripCommandMock.mockImplementationOnce(() => new Promise((res) => { settleFirst = res; }));

    render(
      <TripProvider tripId="x">
        <SyncProbe />
      </TripProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("dayCount").textContent).toBe("1"));

    fireEvent.click(screen.getByRole("button", { name: "add-a" }));
    await waitFor(() => expect(sendTripCommandMock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "add-b" })); // queues behind the in-flight head
    await waitFor(() => expect(screen.getByTestId("dayCount").textContent).toBe("3"));

    await act(async () => { settleFirst(rejection); });
    await waitFor(() => expect(screen.getByTestId("error").textContent).toMatch(/Server rejected/));

    // Both edits are still here, and the count of unsent work is real.
    expect(screen.getByTestId("dayCount").textContent).toBe("3");
    expect(screen.getByTestId("unsent").textContent).toBe("2");
  });

  it("exposes a real failure timestamp and the server's message", async () => {
    sendTripCommandMock.mockResolvedValue(rejection);
    const before = Date.now();

    render(
      <TripProvider tripId="x">
        <SyncProbe />
      </TripProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("dayCount").textContent).toBe("1"));
    fireEvent.click(screen.getByRole("button", { name: "add-a" }));

    await waitFor(() => expect(screen.getByTestId("failedAt").textContent).not.toBe("none"));
    const at = Date.parse(screen.getByTestId("failedAt").textContent!);
    expect(Number.isNaN(at)).toBe(false);
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(Date.now());
    expect(screen.getByTestId("failureMessage").textContent).toBe("Server rejected: AddDay d-a");
  });

  it("retry re-sends the retained head, then drains the rest of the queue", async () => {
    let settleFirst: (v: unknown) => void = () => {};
    sendTripCommandMock.mockImplementationOnce(() => new Promise((res) => { settleFirst = res; }));

    render(
      <TripProvider tripId="x">
        <SyncProbe />
      </TripProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("dayCount").textContent).toBe("1"));
    fireEvent.click(screen.getByRole("button", { name: "add-a" }));
    await waitFor(() => expect(sendTripCommandMock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "add-b" }));
    await waitFor(() => expect(screen.getByTestId("dayCount").textContent).toBe("3"));

    await act(async () => { settleFirst(rejection); });
    await waitFor(() => expect(screen.getByTestId("unsent").textContent).toBe("2"));
    expect(sendTripCommandMock).toHaveBeenCalledTimes(1); // gated: nothing re-sent on its own

    // Both retried sends now succeed.
    sendTripCommandMock.mockResolvedValue({ ok: true, value: { detail: twoDayDetail(), history: historyFixture("x") } });
    fireEvent.click(screen.getByRole("button", { name: "retry" }));

    await waitFor(() => expect(screen.getByTestId("unsent").textContent).toBe("0"));
    // The head went again AND the edit queued behind it finally reached the
    // server — it was never discarded, so there was something left to send.
    expect(sendTripCommandMock).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId("failedAt").textContent).toBe("none");
    expect(screen.getByTestId("error").textContent).toBe("none");
  });

  it("keeps the failure recorded when the user makes further edits (the page alert does not)", async () => {
    sendTripCommandMock.mockResolvedValue(rejection);

    render(
      <TripProvider tripId="x">
        <SyncProbe />
      </TripProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("dayCount").textContent).toBe("1"));
    fireEvent.click(screen.getByRole("button", { name: "add-a" }));
    await waitFor(() => expect(screen.getByTestId("failedAt").textContent).not.toBe("none"));

    // A fresh dispatch clears the transient page alert...
    fireEvent.click(screen.getByRole("button", { name: "add-b" }));
    await waitFor(() => expect(screen.getByTestId("error").textContent).toBe("none"));
    // ...but the queue is still unsent and still failed, and stays gated.
    expect(screen.getByTestId("failedAt").textContent).not.toBe("none");
    expect(screen.getByTestId("unsent").textContent).toBe("2");
    await new Promise((r) => setTimeout(r, 100));
    expect(sendTripCommandMock).toHaveBeenCalledTimes(1);
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


// M11 link 3. The server refuses a viewer's writes regardless
// (accessPolicy.ts + access/invites.int.test.ts); this stops the optimistic
// queue predicting a change that is about to be refused, which is what would
// otherwise make a card visibly move and then jump back.
describe("TripProvider — a viewer's board is read-only", () => {
  it("sends nothing and explains why", async () => {
    fetchTripAccessMock.mockResolvedValue(accessAs("viewer"));
    render(
      <TripProvider tripId="x">
        <Probe />
      </TripProvider>,
    );
    await screen.findByText(tripDetailFixture().name);

    fireEvent.click(screen.getByText("dispatch"));

    await waitFor(() =>
      expect(screen.getByTestId("error").textContent).toBe("You have view-only access to this trip."),
    );
    expect(sendTripCommandMock).not.toHaveBeenCalled();
    expect(sendTripCommandBatchMock).not.toHaveBeenCalled();
  });

  it("lets an editor through", async () => {
    fetchTripAccessMock.mockResolvedValue(accessAs("editor"));
    sendTripCommandMock.mockResolvedValue({
      ok: true,
      value: { detail: oneDayTripDetailFixture(), history: historyFixture("x") },
    });
    render(
      <TripProvider tripId="x">
        <Probe />
      </TripProvider>,
    );
    await screen.findByText(tripDetailFixture().name);

    fireEvent.click(screen.getByText("dispatch"));

    await waitFor(() => expect(sendTripCommandMock).toHaveBeenCalledTimes(1));
  });

  // The client is not the security boundary: if the role read fails, the
  // board behaves exactly as it did before roles existed and the server
  // still decides.
  it("does not lock the board when the role read fails", async () => {
    fetchTripAccessMock.mockResolvedValue({ ok: false, error: { status: 500, message: "boom" } });
    sendTripCommandMock.mockResolvedValue({
      ok: true,
      value: { detail: oneDayTripDetailFixture(), history: historyFixture("x") },
    });
    render(
      <TripProvider tripId="x">
        <Probe />
      </TripProvider>,
    );
    await screen.findByText(tripDetailFixture().name);

    fireEvent.click(screen.getByText("dispatch"));

    await waitFor(() => expect(sendTripCommandMock).toHaveBeenCalledTimes(1));
  });
});
