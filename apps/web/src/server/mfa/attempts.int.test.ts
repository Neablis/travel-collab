import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { attemptCode, isLocked } from "./attempts";

const T0 = new Date("2026-11-20T12:00:00Z");
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);
const newUser = () => `dev-${randomUUID()}`;
const recordFailure = (user: string, at: Date) => attemptCode(user, at, async () => false);

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

  it("evaluates at most five of ten simultaneous wrong guesses", async () => {
    const user = newUser();
    let evaluated = 0;
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        attemptCode(user, T0, async () => {
          evaluated += 1;
          return false;
        }),
      ),
    );
    expect(evaluated).toBe(5);
    expect(results.filter((r) => r === "locked")).toHaveLength(5);
  });

  it("does not count a correct code, and refuses every code while locked", async () => {
    const user = newUser();
    for (let i = 0; i < 4; i++) expect(await attemptCode(user, minutes(i), async () => true)).toBe("ok");
    expect(await isLocked(user, minutes(4))).toBe(false);
    for (let i = 0; i < 5; i++) await recordFailure(user, minutes(i));
    let evaluated = false;
    expect(await attemptCode(user, minutes(5), async () => (evaluated = true))).toBe("locked");
    expect(evaluated).toBe(false);
  });
});
