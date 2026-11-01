import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiResult } from "@/lib/apiClient";
import type { TurnTrace } from "@/lib/askDebug";

// The breakdown is fetched on first open, and the turn's ledger row is written
// a moment after the stream's last chunk (PR 673 review): so a 404 is retried
// for a short while, and a 500 is not the same message as "no row".
const fetchTurnTrace = vi.hoisted(() => vi.fn<(turnId: string) => Promise<ApiResult<TurnTrace>>>());
vi.mock("@/lib/apiClient", () => ({ fetchTurnTrace }));

const { TurnBreakdown } = await import("./TurnBreakdown");

const trace = (over: Partial<TurnTrace> = {}): TurnTrace => ({
  turnId: "t1",
  endpoint: "ask",
  outcome: "completed",
  taskClass: "plan",
  entryPersona: "schedule",
  latencyMs: 1500,
  costMicroUsd: 1234,
  steps: [
    {
      index: 0,
      persona: "schedule",
      model: "m",
      tokensIn: null,
      tokensOut: null,
      cacheReadTokens: null,
      durationMs: null,
      finishReason: null,
      crossed: null,
      escalated: false,
      pivoted: false,
      calls: [],
    },
  ],
  looseCalls: [],
  outcomes: [],
  gaps: [],
  ...over,
});
const failure = (status: number): ApiResult<TurnTrace> => ({ ok: false, error: { status, message: "x" } });

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  fetchTurnTrace.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const open = async () => {
  render(<TurnBreakdown turnId="t1" ordinal={2} />);
  await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(screen.getByRole("button", { name: "Breakdown of answer 2" }));
};

// Past every retry's wait, so a test does not sit through the real one.
const waitOutRetries = () => act(() => vi.advanceTimersByTimeAsync(3000));

describe("TurnBreakdown", () => {
  it("shows the timeline once the ledger row is there, with null figures as n/a and unpriced", async () => {
    fetchTurnTrace.mockResolvedValue({ ok: true, value: trace({ costMicroUsd: null }) });
    await open();
    expect(await screen.findByRole("list", { name: "Steps" })).toBeTruthy();
    expect(screen.getByText(/n\/a in \(n\/a cached\), n\/a out, n\/a/)).toBeTruthy();
    expect(screen.getByText(/unpriced/)).toBeTruthy();
  });

  it("retries a 404 until the row is written, then shows it", async () => {
    fetchTurnTrace.mockResolvedValueOnce(failure(404)).mockResolvedValueOnce(failure(404)).mockResolvedValue({ ok: true, value: trace() });
    await open();
    await waitOutRetries();
    expect(await screen.findByRole("list", { name: "Steps" })).toBeTruthy();
    expect(fetchTurnTrace).toHaveBeenCalledTimes(3);
  });

  it("says there is no row when every retry of a 404 comes back empty, and a re-open asks again", async () => {
    fetchTurnTrace.mockResolvedValue(failure(404));
    await open();
    await waitOutRetries();
    expect(await screen.findByText("No ledger row for this turn.")).toBeTruthy();
    expect(fetchTurnTrace.mock.calls.length).toBeGreaterThan(1);

    fetchTurnTrace.mockResolvedValue({ ok: true, value: trace() });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByRole("button", { name: "Breakdown of answer 2" })); // close
    await user.click(screen.getByRole("button", { name: "Breakdown of answer 2" })); // open again
    expect(await screen.findByRole("list", { name: "Steps" })).toBeTruthy();
  });

  it("does not retry a 500, and says it could not be read rather than that there is no row", async () => {
    fetchTurnTrace.mockResolvedValue(failure(500));
    await open();
    expect(await screen.findByText("The breakdown could not be read.")).toBeTruthy();
    expect(screen.queryByText("No ledger row for this turn.")).toBeNull();
    expect(fetchTurnTrace).toHaveBeenCalledTimes(1);
  });

  it("lists calls with no recorded step and the same task handed off twice", async () => {
    fetchTurnTrace.mockResolvedValue({
      ok: true,
      value: trace({
        looseCalls: [{ callId: "c9", tool: "search_places", outcome: "ok", durationMs: null }],
        gaps: [
          { persona: "discover", target: "nowhere", task: "book a flight" },
          { persona: "discover", target: "nowhere", task: "book a flight" },
        ],
      }),
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await open();
    expect(await screen.findByText("Calls with no recorded step")).toBeTruthy();
    expect(screen.getByText("search_places")).toBeTruthy();
    expect(screen.getAllByText(/book a flight/)).toHaveLength(2);
    // A duplicate React key is logged, not thrown.
    expect(errors).not.toHaveBeenCalled();
    await act(async () => undefined);
  });
});
