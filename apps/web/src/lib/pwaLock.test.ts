import { describe, expect, it } from "vitest";
import { isPastIdle, lastActiveAt, lockSetting, recordActivity, setLockSetting, type LockAfter } from "./pwaLock";

const MIN = 60_000;
const NOW = Date.UTC(2026, 10, 21, 12, 0);

describe("isPastIdle", () => {
  it.each<[string, LockAfter, number | null, boolean]>([
    ["15 minutes, one second short", "15m", NOW - 15 * MIN + 1000, false],
    ["15 minutes, exactly", "15m", NOW - 15 * MIN, true],
    ["an hour, at 59 minutes", "1h", NOW - 59 * MIN, false],
    ["an hour, at 61 minutes", "1h", NOW - 61 * MIN, true],
    ["a day, at 23 hours", "1d", NOW - 23 * 60 * MIN, false],
    ["a day, at 25 hours", "1d", NOW - 25 * 60 * MIN, true],
    ["off, however long", "off", NOW - 1000 * 60 * MIN, false],
    ["no record of activity", "15m", null, false],
    ["a last activity in the future, a clock set back", "15m", NOW + 60 * MIN, false],
  ])("%s", (_, setting, lastActive, expected) => {
    expect(isPastIdle(setting, lastActive, NOW)).toBe(expected);
  });
});

// A Storage in memory, or one that throws on every call (Safari's private mode).
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
}
const throwingStorage = () => {
  throw new DOMException("denied", "SecurityError");
};

describe("the lock setting on this device", () => {
  it("starts the idle clock when it is turned on, so it does not lock over an old timestamp", () => {
    const storage = memoryStorage();
    recordActivity(NOW - 48 * 60 * MIN, () => storage);
    expect(setLockSetting("15m", NOW, () => storage)).toBe(true);
    expect(lockSetting(() => storage)).toBe("15m");
    expect(isPastIdle(lockSetting(() => storage), lastActiveAt(() => storage), NOW)).toBe(false);
    setLockSetting("off", NOW, () => storage);
    expect(lockSetting(() => storage)).toBe("off");
  });

  it("reads a garbled setting as off", () => {
    const storage = memoryStorage();
    storage.setItem("caesura_lock_after", "forever");
    expect(lockSetting(() => storage)).toBe("off");
  });

  it("is off, and never throws, when storage throws", () => {
    expect(lockSetting(throwingStorage)).toBe("off");
    expect(setLockSetting("1h", NOW, throwingStorage)).toBe(false);
    expect(() => recordActivity(NOW, throwingStorage)).not.toThrow();
    expect(lastActiveAt(throwingStorage)).toBeNull();
  });
});
