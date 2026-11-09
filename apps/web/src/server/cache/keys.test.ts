import { describe, expect, it } from "vitest";
import { inviteCardKey, poppyDelegationKey, referralCardKey } from "./keys";

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

  // A `jti` is only unique per issuer, so two agents' delegations must not
  // share an entry, and a delegation's id is not written into the shared Redis.
  it("keys a delegation by agent and jti together, without writing either", () => {
    const key = poppyDelegationKey("https://a.test/agent.json", "dlg-1");
    expect(key).toMatch(/^[a-z]+:poppy:delegation:[0-9a-f]{64}$/);
    expect(key).not.toContain("dlg-1");
    expect(key).toBe(poppyDelegationKey("https://a.test/agent.json", "dlg-1"));
    expect(key).not.toBe(poppyDelegationKey("https://b.test/agent.json", "dlg-1"));
    expect(key).not.toBe(poppyDelegationKey("https://a.test/agent.json", "dlg-2"));
  });
});
