import { describe, expect, it } from "vitest";
import { inviteCardKey, referralCardKey } from "./keys";

// A cache key is readable by anyone with access to the shared Redis, so it must
// not carry the credential it caches for (CodeRabbit, PR #259).

const TOKEN = "k3vJ9x_Q2mN8pL5rT7wY1zA4bC6dE0fG-hI3jK5lM7n";
const CODE = "ABCDEFGHJK";

describe("cache keys", () => {
  it("never contain the invite token or referral code they are for", () => {
    expect(inviteCardKey(TOKEN)).not.toContain(TOKEN);
    expect(referralCardKey(CODE)).not.toContain(CODE);
  });

  it("are one stable digest per value, so a lookup and its delete meet", () => {
    expect(inviteCardKey(TOKEN)).toBe(inviteCardKey(TOKEN));
    expect(inviteCardKey(TOKEN)).not.toBe(inviteCardKey(`${TOKEN}x`));
    expect(inviteCardKey(TOKEN)).toMatch(/^[a-z]+:og:invite:[0-9a-f]{64}$/);
    expect(referralCardKey(CODE)).toMatch(/^[a-z]+:og:referral:[0-9a-f]{64}$/);
  });
});
