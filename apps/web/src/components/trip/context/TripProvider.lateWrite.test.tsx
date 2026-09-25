import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tripDetailFixture, historyFixture } from "@tc/factories";
import type { TripDetail } from "@tc/contracts";

// KI-2026-09-14-e. A separate file from TripProvider.test.tsx because that one
// mocks the SEND helpers, and this bug lives in what the real ones do around a
// write: the command POSTs here go through `sendTripCommand` /
// `sendTripCommandBatch` for real, and only `fetch` is held. The reads stay
// mocked — they are the "server", answered from `serverDays`.

const fetchTripDetailMock = vi.fn();
const fetchTripHistoryMock = vi.fn();
const fetchTripEventsMock = vi.fn();
const fetchTripAccessMock = vi.fn();

vi.mock("@/lib/apiClient", async (orig) => {
  const actual = await orig<typeof import("@/lib/apiClient")>();
  return {
    ...actual,
    fetchTripDetail: (...args: unknown[]) => fetchTripDetailMock(...args),
    fetchTripHistory: (...args: unknown[]) => fetchTripHistoryMock(...args),
    fetchTripEvents: (...args: unknown[]) => fetchTripEventsMock(...args),
    fetchTripAccess: (...args: unknown[]) => fetchTripAccessMock(...args),
  };
});

import { TripProvider, useTrip } from "./TripProvider";

/** What the server has applied, as day ids. Moved by a test when a held POST "applies". */
let serverDays: string[];
const detailWith = (dayIds: string[]): TripDetail =>
  tripDetailFixture({ days: dayIds.map((dayId) => ({ dayId, activityIds: [], date: null, costSubtotal: 0 })) });

/** Command POSTs the test is holding, in the order they were sent. */
let held: { url: string; release: () => void }[];

beforeEach(() => {
  serverDays = ["d1"];
  held = [];
  fetchTripDetailMock.mockReset().mockImplementation(async () => ({ ok: true, value: detailWith(serverDays) }));
  fetchTripHistoryMock.mockReset().mockResolvedValue({ ok: true, value: historyFixture("x") });
  // A solo trip: no interval poll, and nothing makes the document regain
  // visibility or focus — which is exactly the case nothing re-read in.
  fetchTripEventsMock.mockReset().mockResolvedValue({ ok: true, value: { headSeq: 0, events: [], resync: false } });
  fetchTripAccessMock.mockReset().mockResolvedValue({ ok: true, value: { tripId: "x", myRole: "owner", members: [], invites: [] } });
  vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    const url = String(input);
    return new Promise<Response>((resolve) => {
      held.push({
        url,
        release: () =>
          resolve(
            new Response(JSON.stringify({ detail: detailWith(serverDays), history: historyFixture("x") }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
          ),
      });
    });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function Board() {
  const { activeTrip, dispatch } = useTrip();
  const add = (dayId: string) => () => dispatch({ type: "AddDay", tripId: "x", dayId } as never);
  return (
    <div>
      <span data-testid="days">{activeTrip?.days.map((d) => d.dayId).join(",") ?? ""}</span>
      <button onClick={add("d-a")}>add-a</button>
      <button onClick={add("d-b")}>add-b</button>
    </div>
  );
}

const mountBoard = () =>
  render(
    <TripProvider tripId="x">
      <Board />
    </TripProvider>,
  );

describe("TripProvider — a write that lands after you navigated back (KI-2026-09-14-e)", () => {
  it("re-reads when a write the previous board sent settles after the new board has read", async () => {
    const first = mountBoard();
    await waitFor(() => expect(screen.getByTestId("days").textContent).toBe("d1"));

    // d-a goes on the wire and is held; d-b queues behind it.
    fireEvent.click(screen.getByRole("button", { name: "add-a" }));
    await waitFor(() => expect(held).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "add-b" }));

    // Navigate away: KI-5's flush sends d-b as a batch, also held.
    first.unmount();
    expect(held).toHaveLength(2);
    expect(held[1]!.url).toContain("/commands/batch");

    // Come back while neither has been applied. The return read is correct
    // at the moment it is taken — the server really has only d1.
    mountBoard();
    await waitFor(() => expect(screen.getByTestId("days").textContent).toBe("d1"));

    // Now the server applies both, late.
    serverDays = ["d1", "d-a"];
    await act(async () => held[0]!.release());
    serverDays = ["d1", "d-a", "d-b"];
    await act(async () => held[1]!.release());

    await waitFor(() => expect(screen.getByTestId("days").textContent).toBe("d1,d-a,d-b"));
  });

  it("does not re-read on mount when no write is outstanding", async () => {
    mountBoard();
    await waitFor(() => expect(screen.getByTestId("days").textContent).toBe("d1"));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(fetchTripDetailMock).toHaveBeenCalledTimes(1);
  });
});
