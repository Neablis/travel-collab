import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CarriedAsk } from "@tc/contracts";
import { forgetAskConversationsOf, ownedAskName } from "./askOwnership";
import {
  PENDING_CARRIED_ASKS_MAX_AGE_MS,
  loadCarriedAsks,
  rememberIntoTrip,
  saveCarriedAsks,
  rememberNewTripHandOff,
  takeIntoTrip,
  takeNewTripHandOff,
} from "./pendingCarriedAsks";

// What rides the navigation into a new trip (ADR-084 §5): Home's hand-off to
// New trip, and what New trip leaves for the trip it made. Node project, so
// `window.localStorage` is a Map-backed stand-in, as `pendingPlaybookAdd.test.ts`.

const TRIP = "bb000000-0000-4000-8000-000000000001";
const OTHER_TRIP = "bb000000-0000-4000-8000-000000000002";
const NOW = 1_700_000_000_000;
const MEZCAL: CarriedAsk = { said: "add a mezcal tasting", kind: "itinerary" };
const MARKET: CarriedAsk = { said: "find a market morning", kind: "itinerary" };

let store: Map<string, string>;

beforeEach(() => {
  store = new Map();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      get length() {
        return store.size;
      },
      key: (index: number) => [...store.keys()][index] ?? null,
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Home's hand-off to New trip", () => {
  it("is taken once, with its prefill and asks", () => {
    rememberNewTripHandOff({ prefill: { place: "Oaxaca", days: 14, tags: ["meal"] }, asks: [MEZCAL] }, NOW);
    expect(takeNewTripHandOff(NOW)).toEqual({ prefill: { place: "Oaxaca", days: 14, tags: ["meal"] }, asks: [MEZCAL] });
    // Read-and-clear: a second open of New trip is a fresh one, not this hand-off again.
    expect(takeNewTripHandOff(NOW)).toBeNull();
  });

  it("is dropped once older than its max age", () => {
    rememberNewTripHandOff({ prefill: {}, asks: [MEZCAL] }, NOW);
    expect(takeNewTripHandOff(NOW + PENDING_CARRIED_ASKS_MAX_AGE_MS + 1)).toBeNull();
  });

  // A stored record is same-origin script's to forge; what it may say is held
  // to the shapes the picker can show, so a tag it has no tile for is refused.
  it("is refused whole when any field is not one the picker can show", () => {
    store.set("pending_new_trip_hand_off", JSON.stringify({ prefill: { tags: ["lodging"] }, asks: [], at: NOW }));
    expect(takeNewTripHandOff(NOW)).toBeNull();
  });
});

describe("what New trip leaves for the trip it made", () => {
  it("is taken once, by that trip only", () => {
    rememberIntoTrip(TRIP, { kickoff: "Plan this trip with me — Oaxaca.", asks: [MEZCAL] }, NOW);
    // Another trip opened inside the window gets nothing, and spends it.
    expect(takeIntoTrip(OTHER_TRIP, NOW)).toBeNull();
    expect(takeIntoTrip(TRIP, NOW)).toBeNull();

    rememberIntoTrip(TRIP, { kickoff: null, asks: [MEZCAL] }, NOW);
    expect(takeIntoTrip(TRIP, NOW)).toEqual({ kickoff: null, asks: [MEZCAL] });
    expect(takeIntoTrip(TRIP, NOW)).toBeNull();
  });

  it("is dropped once older than its max age", () => {
    rememberIntoTrip(TRIP, { kickoff: "Plan this trip with me — Oaxaca.", asks: [] }, NOW);
    expect(takeIntoTrip(TRIP, NOW + PENDING_CARRIED_ASKS_MAX_AGE_MS + 1)).toBeNull();
  });
});

// M56 part 6 review: the kickoff survives a reload in the thread, so the asks
// beside it have to as well, until each is pressed.
describe("the asks a new trip's rail still offers", () => {
  const THREAD = ownedAskName("user-1", `trip:${TRIP}`);

  it("are kept beside the thread until the last is pressed, and go with its owner's sign-out", () => {
    saveCarriedAsks(THREAD, [MEZCAL, MARKET]);
    expect(loadCarriedAsks(THREAD)).toEqual([MEZCAL, MARKET]);
    saveCarriedAsks(THREAD, [MARKET]);
    expect(loadCarriedAsks(THREAD)).toEqual([MARKET]);
    saveCarriedAsks(THREAD, []);
    expect(store.size).toBe(0);

    saveCarriedAsks(THREAD, [MEZCAL]);
    forgetAskConversationsOf("user-1");
    expect(loadCarriedAsks(THREAD)).toEqual([]);
  });

  it("offers none from a stored list it cannot parse", () => {
    saveCarriedAsks(THREAD, [MEZCAL]);
    const [key] = [...store.keys()];
    store.set(key ?? "", JSON.stringify([{ said: "book it", kind: "anything" }]));
    expect(loadCarriedAsks(THREAD)).toEqual([]);
  });
});
