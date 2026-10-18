// Home's list goes with the page (2026-10-18). What reaches the screen must be
// what `fetchTrips()` would have handed it, and a read that fails must leave
// the screen to read for itself — reported, because the fallback alone would
// hide it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ListedTripSummary } from "@tc/contracts";
import { tripSummaryFactory } from "@tc/factories";

const listed = vi.hoisted(() => ({ read: vi.fn<(userId: string) => Promise<unknown[]>>() }));
vi.mock("@/server/listedTrips", () => ({ listedTripsFor: listed.read }));
vi.mock("@/server/auth", () => ({ auth: async () => ({ user: { id: "user-a" } }) }));
const captureException = vi.hoisted(() => vi.fn());
vi.mock("@sentry/nextjs", () => ({ captureException }));

import Home from "./page";

type Served = React.ReactElement<{ initialTrips: ListedTripSummary[] | null; initialToday: string | null }>;

beforeEach(() => {
  listed.read.mockReset();
  captureException.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Home's server read", () => {
  it("hands the screen the list as the contract parses it, and the server's UTC date", async () => {
    const trip = tripSummaryFactory.build();
    // A field the contract does not name stays on the server.
    listed.read.mockResolvedValue([{ ...trip, unreadChat: 2, spend: null, internal: "not for the client" }]);

    // Half past eleven at night in Chicago is already the 16th in UTC.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2030-06-15T23:30:00-05:00"));

    const served = (await Home()) as Served;

    expect(listed.read).toHaveBeenCalledWith("user-a");
    expect(served.props.initialTrips).toEqual([{ ...trip, unreadChat: 2, spend: null }]);
    expect(served.props.initialToday).toBe("2030-06-16");
  });

  it("reports a failed read and serves no list, so the screen reads it itself", async () => {
    const fault = new Error("trip summaries read failed");
    listed.read.mockRejectedValue(fault);

    const served = (await Home()) as Served;

    expect(captureException).toHaveBeenCalledWith(fault);
    // `null`, not `[]`: an empty list is an answer, and would draw the first
    // run for a reader who has trips.
    expect(served.props.initialTrips).toBeNull();
  });
});
