import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { tripDetailFixture, historyFixture } from "@tc/factories";

const sendTripCommandMock = vi.fn();
const sendTripCommandBatchMock = vi.fn();
const fetchTripAccessMock = vi.fn();
// Settable, like the others: one test needs a trip whose own state refuses
// every command, to prove a predicted rejection is reported rather than eaten.
const fetchTripDetailMock = vi.fn();

function oneDayTripDetailFixture() {
  return tripDetailFixture({
    days: [{ dayId: "d1", activityIds: [], date: null, costSubtotal: 0 }],
  });
}

vi.mock("@/lib/apiClient", async (orig) => {
  const actual = await orig<typeof import("@/lib/apiClient")>();
  return {
    ...actual,
    fetchTripDetail: (...args: unknown[]) => fetchTripDetailMock(...args),
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
  fetchTripDetailMock.mockReset().mockResolvedValue({ ok: true, value: oneDayTripDetailFixture() });
});

function Probe() {
  const { activeTrip, error, dispatch, accessUnknown } = useTrip();
  return (
    <div>
      <span data-testid="trip">{activeTrip?.name}</span>
      <span data-testid="error">{error ?? "none"}</span>
      <span data-testid="accessUnknown">{String(accessUnknown)}</span>
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

// The bug this pins: `runDispatch` used to assign its rejection message inside
// a `setOptimistic` updater and read it on the very next line. React runs
// updaters in the render phase, not synchronously, so that read always saw
// `null` — every CLIENT-PREDICTED rejection was silent. No request, no
// message, a button that did nothing.
//
// Mitchell hit it walking the #71 preview and could only tell me "I don't
// think it's even sending the api request". He was right, and the product had
// no way to say why.
//
// A deleted trip is the sharpest fixture for it: `decideCommand` refuses every
// command on one wholesale, so the rejection is total and deterministic rather
// than depending on the particular command.
describe("TripProvider — a client-predicted rejection says so", () => {
  it("surfaces the reason and sends nothing", async () => {
    fetchTripDetailMock.mockResolvedValue({
      ok: true,
      value: { ...oneDayTripDetailFixture(), status: "deleted" },
    });
    render(
      <TripProvider tripId="x">
        <Probe />
      </TripProvider>,
    );
    await screen.findByText(tripDetailFixture().name);

    fireEvent.click(screen.getByText("dispatch"));

    // The message decide() actually gave, not silence.
    await waitFor(() =>
      expect(screen.getByTestId("error").textContent).toBe("This trip has been deleted."),
    );
    // …and it never reached the network, which is correct — the point is that
    // the user is TOLD, not that the request goes out.
    expect(sendTripCommandMock).not.toHaveBeenCalled();
    expect(sendTripCommandBatchMock).not.toHaveBeenCalled();
  });

  it("stays quiet for a command that predicts cleanly", async () => {
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

    await waitFor(() => expect(sendTripCommandMock).toHaveBeenCalled());
    expect(screen.getByTestId("error").textContent).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// KI-42: a unit `confirmHead` can no longer predict is RETAINED, and the whole
// point of retaining it is that the sender still sends it — the server, not
// this client's re-prediction, decides its fate.
//
// `optimistic.test.ts` can only show the retained unit is *eligible* to be
// sent (queued, in order, with no `failure` gating the sender); it never
// invokes the sender, so a sender regression would leave it green. This is
// that claim enforced end to end, per CodeRabbit's review of PR #73 and
// AGENTS.md's rule that an asserted invariant needs a test or it is a lie
// with a timer on it (the KI-1 / KI-14 class — and the exact class KI-42
// itself was, since the comment it replaced claimed a `failHead` report that
// could never happen).
// ---------------------------------------------------------------------------

function RetainProbe() {
  const { activeTrip, sync, dispatch } = useTrip();
  return (
    <div>
      <span data-testid="dayCount">{activeTrip?.days.length ?? 0}</span>
      <span data-testid="unsent">{sync.unsent}</span>
      <button onClick={() => dispatch({ type: "AddDay", tripId: "x", dayId: "d-a" } as never)}>add-day</button>
      <button
        onClick={() =>
          dispatch({
            type: "AddActivity",
            tripId: "x",
            activityId: "act-1",
            dayId: "d-a",
            title: "Colosseum tour",
          } as never)
        }
      >
        add-activity
      </button>
    </div>
  );
}

describe("TripProvider retained-unit sender (KI-42)", () => {
  it("sends a unit confirmHead retained without a prediction", async () => {
    // Head (AddDay d-a) is held in flight so the second edit queues behind it.
    let settleFirst: (v: unknown) => void = () => {};
    sendTripCommandMock.mockImplementationOnce(() => new Promise((res) => { settleFirst = res; }));

    render(
      <TripProvider tripId="x">
        <RetainProbe />
      </TripProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("dayCount").textContent).toBe("1"));

    fireEvent.click(screen.getByRole("button", { name: "add-day" }));
    await waitFor(() => expect(sendTripCommandMock).toHaveBeenCalledTimes(1));
    // Predicts cleanly against the head's prediction, which has d-a in it.
    fireEvent.click(screen.getByRole("button", { name: "add-activity" }));
    await waitFor(() => expect(screen.getByTestId("unsent").textContent).toBe("2"));
    // Pin that the second unit has NOT been sent yet. Without this, a sender
    // that fired queued units concurrently would reach two calls without the
    // retention ever happening, and the assertion below would pass for the
    // wrong reason — the test would no longer be about KI-42 at all.
    expect(sendTripCommandMock).toHaveBeenCalledTimes(1);

    // The head SUCCEEDS, but the authoritative outcome has no d-a — the state
    // the queued AddActivity predicted against is gone (a concurrent removal).
    // Before KI-42 this dropped the AddActivity silently and it was never sent.
    sendTripCommandMock.mockResolvedValue({
      ok: true,
      value: { detail: oneDayTripDetailFixture(), history: historyFixture("x") },
    });
    await act(async () => {
      settleFirst({ ok: true, value: { detail: oneDayTripDetailFixture(), history: historyFixture("x") } });
    });

    // The retained unit reaches the server: that is the claim, and this is the
    // only place it is enforced.
    await waitFor(() => expect(sendTripCommandMock).toHaveBeenCalledTimes(2));
    expect(sendTripCommandMock.mock.calls[1]![0]).toMatchObject({
      type: "AddActivity",
      activityId: "act-1",
      dayId: "d-a",
    });
  });
});

// ---------------------------------------------------------------------------
// The send-queue wedge (docs/reviews/2026-08-28-project-review.md §1.1).
//
// `inFlight` used to be reset on the line AFTER an unprotected `await`, so a
// throw anywhere in the send path skipped it and the sequential sender was
// gated for the life of the page: no failure recorded, no retry offered, the
// header saying "Saving…" forever and every queued edit lost on navigation.
// apiClient's helpers all resolve rather than reject now (its own totality
// suite pins that), so this is the second line of defence — and the one that
// matters, because it is the only place the cost of being wrong is silent
// data loss rather than a visible error.
// ---------------------------------------------------------------------------

describe("TripProvider sender — a throw in the send path never gates the queue", () => {
  it("records the throw as an ordinary failed send, and retry still drains", async () => {
    sendTripCommandMock.mockRejectedValueOnce(new Error("Failed to fetch"));

    render(
      <TripProvider tripId="x">
        <SyncProbe />
      </TripProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("dayCount").textContent).toBe("1"));
    fireEvent.click(screen.getByRole("button", { name: "add-a" }));

    // Reported through KI-36's existing surface rather than vanishing: the
    // edit is retained, the failure is dated, and the user is told.
    await waitFor(() => expect(screen.getByTestId("failedAt").textContent).not.toBe("none"));
    expect(screen.getByTestId("failureMessage").textContent).toBe("Failed to fetch");
    expect(screen.getByTestId("unsent").textContent).toBe("1");
    expect(screen.getByTestId("dayCount").textContent).toBe("2");

    // The load-bearing assertion. If `inFlight` leaked, the sender's effect
    // returns early forever and this retry sends nothing — `unsent` would
    // stay at 1 and the call count at 1.
    sendTripCommandMock.mockResolvedValue({
      ok: true,
      value: { detail: twoDayDetail(), history: historyFixture("x") },
    });
    fireEvent.click(screen.getByRole("button", { name: "retry" }));

    await waitFor(() => expect(screen.getByTestId("unsent").textContent).toBe("0"));
    expect(sendTripCommandMock).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("failedAt").textContent).toBe("none");
  });
});

// The same class at the other site: a throwing initial read used to leave
// `status` on "loading" forever — a permanent spinner with nothing on screen
// to say why (project review §1.1, second site).
function StatusProbe() {
  const { status, error } = useTrip();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="error">{error ?? "none"}</span>
    </div>
  );
}

describe("TripProvider load — a throwing read is an error state, not a spinner", () => {
  it("leaves status on error with the reason, not on loading", async () => {
    fetchTripDetailMock.mockRejectedValue(new Error("Failed to fetch"));

    render(
      <TripProvider tripId="x">
        <StatusProbe />
      </TripProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("error"));
    expect(screen.getByTestId("error").textContent).toBe("Failed to fetch");
  });
});

// docs/reviews/2026-08-28-m11-pr71-review.md §5's PLAUSIBLE edge: a failed
// access read leaves `myRole` null, so a real VIEWER gets a fully live board
// and every send 403s into a retained queue whose retry can never succeed.
// The decision (reasoned in `load`) is to keep the failure non-fatal — a false
// "view only" would lock an OWNER out of their own trip over one 500 on a
// secondary read, which is both worse and commoner — and to stop it being
// SILENT instead. `accessUnknown` is what the header says out loud.
describe("TripProvider — an access read that fails is surfaced, not acted on", () => {
  it("reports accessUnknown and still lets the board through", async () => {
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

    await waitFor(() => expect(screen.getByTestId("accessUnknown").textContent).toBe("true"));
    // Deliberately NOT read-only: the server is the boundary, and this is the
    // half of the decision that would be silently wrong if it flipped.
    fireEvent.click(screen.getByText("dispatch"));
    await waitFor(() => expect(sendTripCommandMock).toHaveBeenCalledTimes(1));
  });

  it("stays false when the read succeeds", async () => {
    fetchTripAccessMock.mockResolvedValue(accessAs("viewer"));
    render(
      <TripProvider tripId="x">
        <Probe />
      </TripProvider>,
    );
    await screen.findByText(tripDetailFixture().name);

    await waitFor(() => expect(screen.getByTestId("accessUnknown").textContent).toBe("false"));
  });
});

// ---------------------------------------------------------------------------
// KI-70. `dispatch`'s history branch refuses to run while anything is pending —
// "don't interleave undo/redo/revert with unconfirmed optimistic edits" — and
// it reconciles with `{ confirmed, pending: [] }`, which is only safe BECAUSE
// of that refusal. The guard used to read the render-time `pending`, so two
// actions inside one React tick saw the PRE-enqueue value: the guard passed and
// the reconcile threw away the unit queued a moment earlier. One user edit,
// gone, with no error.
//
// `runDispatch` already solved this three lines away, and says so:
// `optimisticRef.current` is advanced synchronously "so anything dispatched
// later in this same tick predicts against this result rather than the
// pre-dispatch queue". The history branch now reads the same value.
// ---------------------------------------------------------------------------

function SameTickProbe() {
  const { activeTrip, dispatch } = useTrip();
  return (
    <div>
      <span data-testid="dayCount">{activeTrip?.days.length ?? 0}</span>
      <button
        // ONE handler, so both dispatches land in one React tick and the second
        // closes over the same render's `pending`. This is the race, not a
        // simulation of it: no timers, no fake scheduler.
        onClick={() => {
          void dispatch({ type: "AddDay", tripId: "x", dayId: "d-race" } as never);
          void dispatch({ type: "UndoLastChange", tripId: "x" } as never);
        }}
      >
        edit-then-undo
      </button>
      <button onClick={() => void dispatch({ type: "UndoLastChange", tripId: "x" } as never)}>
        undo
      </button>
    </div>
  );
}

describe("TripProvider history dispatch in the same tick as an enqueue (KI-70)", () => {
  it("refuses the undo instead of discarding the just-queued edit", async () => {
    // The AddDay send is held in flight, so the queued unit is unambiguously
    // still pending when the undo is decided.
    sendTripCommandMock.mockImplementation(() => new Promise(() => {}));

    render(
      <TripProvider tripId="x">
        <SameTickProbe />
      </TripProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("dayCount").textContent).toBe("1"));

    fireEvent.click(screen.getByRole("button", { name: "edit-then-undo" }));

    // Settled, then asserted: a guard that merely DELAYS the undo is not a
    // guard, so this waits out every microtask rather than sampling early.
    await act(async () => {});
    const sentTypes = sendTripCommandMock.mock.calls.map(
      (call) => (call[0] as { type: string }).type,
    );
    expect(sentTypes).toEqual(["AddDay"]);
  });

  it("keeps the optimistic edit on screen (it used to vanish with no error)", async () => {
    // The undo, if it is allowed through, succeeds and reconciles to a trip
    // with one day — which is what silently ate the queued second day.
    sendTripCommandMock.mockImplementation(async (command: { type: string }) =>
      command.type === "UndoLastChange"
        ? { ok: true, value: { detail: oneDayTripDetailFixture(), history: historyFixture("x") } }
        : new Promise(() => {}),
    );

    render(
      <TripProvider tripId="x">
        <SameTickProbe />
      </TripProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("dayCount").textContent).toBe("1"));

    fireEvent.click(screen.getByRole("button", { name: "edit-then-undo" }));

    // Two days: the confirmed one plus the optimistic d-race. Asserted after a
    // settled microtask queue, so a reconcile that clears `pending` has had
    // every chance to land.
    await act(async () => {});
    expect(screen.getByTestId("dayCount").textContent).toBe("2");
  });

  it("still lets a history command through once nothing is pending", async () => {
    sendTripCommandMock.mockResolvedValue({
      ok: true,
      value: { detail: oneDayTripDetailFixture(), history: historyFixture("x") },
    });

    render(
      <TripProvider tripId="x">
        <SameTickProbe />
      </TripProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("dayCount").textContent).toBe("1"));

    // Undo on its own, with an empty queue: not racing anything. Without this
    // case the two above would pass against a provider that simply never sends
    // a history command at all.
    fireEvent.click(screen.getByRole("button", { name: "undo" }));

    await waitFor(() => {
      const sentTypes = sendTripCommandMock.mock.calls.map(
        (call) => (call[0] as { type: string }).type,
      );
      expect(sentTypes).toContain("UndoLastChange");
    });
  });
});
