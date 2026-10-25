import { describe, expect, it } from "vitest";
import { z } from "zod";
import { isoDateTime } from "../src/isoDateTime";

// The instants zod 3 accepted and zod 4's own `.datetime()` refuses. Stored
// rows and outside sources were only ever checked against the first, so these
// must keep parsing after the upgrade (PR 561 and PR 563 were the bump).
describe("isoDateTime keeps zod 3's grammar", () => {
  it("accepts an instant without seconds, and an offset without its colon", () => {
    expect(isoDateTime().safeParse("2026-10-25T10:00Z").success).toBe(true);
    expect(isoDateTime({ offset: true }).safeParse("2026-10-25T10:00:00+0200").success).toBe(true);
    expect(isoDateTime({ offset: true }).safeParse("2026-10-25T10:00:00.123+02:00").success).toBe(true);
  });

  it("still refuses what zod 3 refused", () => {
    expect(isoDateTime().safeParse("2026-10-25T10:00:00+02:00").success).toBe(false);
    expect(isoDateTime({ offset: true }).safeParse("2026-10-25T10:00:00+02").success).toBe(false);
    expect(isoDateTime().safeParse("2026-02-30T10:00:00Z").success).toBe(false);
    expect(isoDateTime().safeParse("2026-10-25").success).toBe(false);
  });

  it("publishes as a date-time string", () => {
    expect(z.toJSONSchema(isoDateTime().nullable(), { target: "openapi-3.0" })).toMatchObject({ type: "string", format: "date-time", nullable: true });
  });
});
