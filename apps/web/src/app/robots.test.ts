import { describe, expect, it } from "vitest";
import robots from "./robots";

describe("robots.txt", () => {
  it("allows the site and the public Playbooks cards, and keeps the rest of /api/ out", () => {
    const { rules } = robots();
    const rule = Array.isArray(rules) ? rules[0]! : rules;
    expect(rule.userAgent).toBe("*");
    // The longer path wins (RFC 9309), so a card under /api/og/playbooks is
    // fetchable while /api/og/invite and /api/og/referral, keyed by tokens, are not.
    expect(rule.allow).toEqual(["/", "/api/og/playbooks"]);
    expect(rule.disallow).toBe("/api/");
  });
});
