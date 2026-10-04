import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PENDING_PLAYBOOK_ADD_MAX_AGE_MS,
  pendingPlaybookAddDay,
  rememberPlaybookAdd,
  takePlaybookAdd,
} from "./pendingPlaybookAdd";

// The marker that carries a signed-out reader's *Add to a trip* across sign-in
// (ADR-061). This file runs in the node project, so `window.localStorage` is a
// Map-backed stand-in: what is under test is this module's reading of it, not
// the browser's storage.

const DAY = "aa000000-0000-4000-8000-000000000001";
const OTHER_DAY = "aa000000-0000-4000-8000-000000000002";
const NOW = 1_700_000_000_000;

let store: Map<string, string>;

beforeEach(() => {
  store = new Map();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the pending playbook-add marker", () => {
  it("is not set until somebody presses Add", () => {
    expect(takePlaybookAdd(DAY, NOW)).toBe(false);
  });

  it("is redeemed once, on the day it was banked on", () => {
    rememberPlaybookAdd(DAY, NOW);
    expect(takePlaybookAdd(DAY, NOW)).toBe(true);
    // Read-and-clear: the redeeming effect runs twice under StrictMode, and a
    // second dialog-open is what "once" has to rule out.
    expect(takePlaybookAdd(DAY, NOW)).toBe(false);
  });

  it("does not open on another day, and is spent by looking", () => {
    rememberPlaybookAdd(DAY, NOW);
    expect(takePlaybookAdd(OTHER_DAY, NOW)).toBe(false);
    // Spent even though it was not this page's: the reader went somewhere else
    // on their own, and the day they banked must not ambush them later.
    expect(takePlaybookAdd(DAY, NOW)).toBe(false);
  });

  it("is still live at the edge of its window", () => {
    rememberPlaybookAdd(DAY, NOW);
    expect(takePlaybookAdd(DAY, NOW + PENDING_PLAYBOOK_ADD_MAX_AGE_MS)).toBe(true);
  });

  it("expires a moment later, and clears itself", () => {
    rememberPlaybookAdd(DAY, NOW);
    expect(takePlaybookAdd(DAY, NOW + PENDING_PLAYBOOK_ADD_MAX_AGE_MS + 1)).toBe(false);
    expect(store.size).toBe(0);
  });

  it("treats a marker from the future as nothing", () => {
    rememberPlaybookAdd(DAY, NOW + 1);
    expect(takePlaybookAdd(DAY, NOW)).toBe(false);
  });

  it.each([
    ["not JSON", "yesterday"],
    ["the demo marker's shape", String(NOW)],
    ["no time", JSON.stringify({ savedDayId: DAY })],
    ["a time that is not a number", JSON.stringify({ savedDayId: DAY, at: "now" })],
  ])("treats a corrupted value (%s) as nothing", (_label, raw) => {
    store.set("pending_playbook_add", raw);
    expect(takePlaybookAdd(DAY, NOW)).toBe(false);
    expect(store.size).toBe(0);
  });

  it("degrades to no shortcut when storage throws", () => {
    const denied = () => {
      throw new Error("denied");
    };
    vi.stubGlobal("window", { localStorage: { getItem: denied, setItem: denied, removeItem: denied } });
    expect(() => rememberPlaybookAdd(DAY, NOW)).not.toThrow();
    expect(takePlaybookAdd(DAY, NOW)).toBe(false);
  });
});

describe("peeking at the waiting day", () => {
  it("names a live marker's day and leaves it for the day page to spend", () => {
    rememberPlaybookAdd(DAY, NOW);
    expect(pendingPlaybookAddDay(NOW + 1000)).toBe(DAY);
    expect(takePlaybookAdd(DAY, NOW + 2000)).toBe(true);
  });

  it("names nothing once the marker has expired", () => {
    rememberPlaybookAdd(DAY, NOW);
    expect(pendingPlaybookAddDay(NOW + PENDING_PLAYBOOK_ADD_MAX_AGE_MS + 1)).toBeNull();
  });

  it("names nothing that is not shaped like an id, since it becomes a path", () => {
    store.set("pending_playbook_add", JSON.stringify({ savedDayId: "../../account", at: NOW }));
    expect(pendingPlaybookAddDay(NOW)).toBeNull();
  });
});
