import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isUuid } from "./ids";

// The integration suites prove what the guards ANSWER (404 rather than 500).
// This file guards the other direction, which is the one that would be silent:
// a predicate that got stricter would turn every working request into a 404
// with no error anywhere, and the routes cannot tell that apart from a genuine
// miss. So the first assertion is the load-bearing one — whatever
// `randomUUID()` produces must pass.
describe("isUuid", () => {
  it("accepts every id this system mints", () => {
    for (let i = 0; i < 100; i++) expect(isUuid(randomUUID())).toBe(true);
  });

  it("accepts a canonical uuid whatever the case, and whatever the version nibble", () => {
    expect(isUuid("7D9A1F8E-0000-4000-8000-000000000001")).toBe(true);
    // Not a v4. Still a legal value of a uuid column, and a row could hold it —
    // the question here is "could this name a row", not "did we mint it".
    expect(isUuid("00000000-0000-0000-0000-000000000000")).toBe(true);
  });

  it.each([
    ["a bare word", "not-a-uuid"],
    ["an empty string", ""],
    ["a truncated id", "7d9a1f8e-0000-4000-8000-00000000000"],
    ["an over-long id", "7d9a1f8e-0000-4000-8000-0000000000012"],
    ["non-hex characters", "7d9a1f8g-0000-4000-8000-000000000001"],
    ["the hyphens removed", "7d9a1f8e00004000800000000000001a"],
    ["surrounding whitespace", " 7d9a1f8e-0000-4000-8000-000000000001 "],
    // Postgres would parse this one; we deliberately do not. Nothing in this
    // system produces it, and matching Postgres's full input grammar would
    // mean maintaining a second parser to stay in step with it.
    ["braces", "{7d9a1f8e-0000-4000-8000-000000000001}"],
  ])("rejects %s", (_label, value) => {
    expect(isUuid(value)).toBe(false);
  });
});
