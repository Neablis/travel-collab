import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { isLocked, recordFailure } from "./attempts";

const T0 = new Date("2026-11-20T12:00:00Z");
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);
const newUser = () => `dev-${randomUUID()}`;

describe("code attempt limiter", () => {
  it("locks on the fifth failure and not before", async () => {
    const user = newUser();
    for (let i = 0; i < 4; i++) await recordFailure(user, minutes(i));
    expect(await isLocked(user, minutes(4))).toBe(false);
    await recordFailure(user, minutes(4));
    expect(await isLocked(user, minutes(4))).toBe(true);
  });

  it("holds for fifteen minutes after the fifth failure, then lifts by itself", async () => {
    const user = newUser();
    for (let i = 0; i < 5; i++) await recordFailure(user, minutes(i));
    expect(await isLocked(user, minutes(4 + 14))).toBe(true);
    expect(await isLocked(user, minutes(4 + 15))).toBe(false);
  });

  it("does not count failures spread wider than fifteen minutes", async () => {
    const user = newUser();
    for (let i = 0; i < 5; i++) await recordFailure(user, minutes(i * 4));
    expect(await isLocked(user, minutes(16))).toBe(false);
  });

  it("is per account", async () => {
    const [locked, other] = [newUser(), newUser()];
    for (let i = 0; i < 5; i++) await recordFailure(locked, minutes(i));
    expect(await isLocked(other, minutes(5))).toBe(false);
  });
});
