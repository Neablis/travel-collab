// The ask route's wall and the two deadlines under it (KI-2026-09-26-s).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ASK_HARD_DEADLINE_MS, ASK_MAX_DURATION_SECONDS, ASK_STEP_DEADLINE_MS } from "./askDeadline";

describe("the ask route's time budget", () => {
  // Next.js reads `maxDuration` statically, so the route has to spell it as a
  // literal; the deadlines are derived from the constant. If the two drift,
  // the deadlines are measured against a wall the platform does not enforce.
  it("derives its deadlines from the same wall the route declares", () => {
    const route = readFileSync(path.join(__dirname, "../../app/api/trips/[tripId]/ask/route.ts"), "utf8");
    const declared = /export const maxDuration = (\d+);/.exec(route)?.[1];
    expect(Number(declared)).toBe(ASK_MAX_DURATION_SECONDS);
  });

  it("stops taking steps, then aborts, both well before the wall", () => {
    expect(ASK_STEP_DEADLINE_MS).toBeLessThan(ASK_HARD_DEADLINE_MS);
    // Room after the abort for the record, the drafted inserts and the
    // settlement to be written before the platform kills the function.
    expect(ASK_MAX_DURATION_SECONDS * 1000 - ASK_HARD_DEADLINE_MS).toBeGreaterThanOrEqual(30_000);
  });
});
