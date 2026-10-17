// **The weekly tier rollup** (M47 part 4), against a real database.
//
// Gate box: *the rollup job is idempotent per week*, and the rollup half of *a
// test-mode subscription adds nothing to the tier panels*. The lane shares one
// database across files, so every count here is a difference between two runs
// rather than an absolute.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { and, count, eq } from "drizzle-orm";
import type { PlanId } from "@tc/contracts";
import { db } from "@/server/db/client";
import { tierWeekly, users } from "@/server/db/schema";
import { upsertUser } from "@/server/users";
import { adminUsers, planPanel } from "./admin";
import { rollupTiers, tierSeries, weekStartOf } from "./tierRollup";

async function holder(planId: PlanId, planLivemode = true) {
  const id = `dev-${randomUUID()}`;
  await upsertUser({ id, email: `${id}@example.test`, name: null, image: null });
  await db.update(users).set({ planId, planVersion: 1, planLivemode }).where(eq(users.id, id));
  return id;
}

/** Each plan's row for one week, as stored. */
async function rowsFor(weekStart: string) {
  return db.select().from(tierWeekly).where(eq(tierWeekly.weekStart, weekStart));
}

const accountsOf = (rows: Awaited<ReturnType<typeof rowsFor>>, planId: PlanId) =>
  rows.find((row) => row.planId === planId)?.accounts;

// A week far from any other file's `new Date()`, so no other run lands in it.
const WEDNESDAY = new Date("2031-03-12T15:00:00Z");
const SUNDAY_LATE = new Date("2031-03-16T23:59:59Z");

describe("weekStartOf", () => {
  it("is the Monday, in UTC, of the week `now` falls in", () => {
    expect(weekStartOf(WEDNESDAY)).toBe("2031-03-10");
    expect(weekStartOf(SUNDAY_LATE)).toBe("2031-03-10");
    expect(weekStartOf(new Date("2031-03-10T00:00:00Z"))).toBe("2031-03-10");
  });
});

describe("rollupTiers", () => {
  it("run twice in one week leaves one row per plan, holding the second run's count", async () => {
    await rollupTiers(WEDNESDAY);
    const first = await rowsFor("2031-03-10");
    await holder("premium");
    await rollupTiers(SUNDAY_LATE);
    const second = await rowsFor("2031-03-10");

    const plans = second.map((row) => row.planId).sort();
    expect(plans).toEqual(["free", "plus", "premium", "studio"]);
    expect(accountsOf(second, "premium")).toBe(accountsOf(first, "premium")! + 1);
  });

  it("does not count a plan held from a test-mode checkout", async () => {
    await rollupTiers(WEDNESDAY);
    const before = accountsOf(await rowsFor("2031-03-10"), "plus")!;
    await holder("plus", false);
    await holder("plus", true);
    await rollupTiers(WEDNESDAY);
    expect(accountsOf(await rowsFor("2031-03-10"), "plus")).toBe(before + 1);
  });

  // Decision 1: the chart's *now* is the tier panel's number, so a reader
  // comparing the two tabs never sees them disagree.
  it("counts what the tier panel counts, plan by plan", async () => {
    await holder("premium", false);
    const { accounts } = await rollupTiers(WEDNESDAY);
    const panel = await planPanel(WEDNESDAY);
    expect(accounts).toEqual(Object.fromEntries(panel.map((row) => [row.planId, row.accounts])));
  });

  // Against a count taken here, not an assumed 0: the lane shares one
  // database, and nothing stops another file giving an account `studio`.
  // `studio` is published but not enabled, so that count is 0 unless one does.
  it("writes a row for a plan nobody holds, holding its live count", async () => {
    const [held] = await db
      .select({ n: count() })
      .from(users)
      .where(and(eq(users.planId, "studio"), eq(users.planLivemode, true)));
    await rollupTiers(WEDNESDAY);
    expect(accountsOf(await rowsFor("2031-03-10"), "studio")).toBe(held!.n);
  });

  it("starts a new row when a new week starts", async () => {
    await rollupTiers(WEDNESDAY);
    await rollupTiers(new Date("2031-03-17T00:00:01Z"));
    expect(await rowsFor("2031-03-17")).toHaveLength(4);
    expect(await rowsFor("2031-03-10")).toHaveLength(4);
  });
});

describe("tierSeries", () => {
  it("reads each plan's weeks back, oldest first, bounded by `weeks`", async () => {
    await rollupTiers(new Date("2031-03-10T12:00:00Z"));
    await rollupTiers(new Date("2031-03-17T12:00:00Z"));
    await rollupTiers(new Date("2031-03-24T12:00:00Z"));
    await rollupTiers(new Date("2031-03-31T12:00:00Z"));
    const series = await tierSeries(2, new Date("2031-03-25T12:00:00Z"));
    const premium = series.find((row) => row.planId === "premium")!;
    // 2031-03-10 is more than two weeks back, and 2031-03-31 is after `now`.
    expect(premium.points.map((point) => point.weekStart)).toEqual(["2031-03-17", "2031-03-24"]);
    expect(series.map((row) => row.planId).sort()).toEqual(["free", "plus", "premium", "studio"]);
  });

  // The chart's *since* is when the history starts, which the window can cut.
  it("dates each plan's first week, however far before the window it is", async () => {
    await rollupTiers(new Date("2031-03-10T12:00:00Z"));
    await rollupTiers(new Date("2031-03-24T12:00:00Z"));
    const series = await tierSeries(1, new Date("2031-03-25T12:00:00Z"));
    const premium = series.find((row) => row.planId === "premium")!;
    expect(premium.points.map((point) => point.weekStart)).toEqual(["2031-03-24"]);
    expect(premium.firstWeek).toBe("2031-03-10");
  });

  // A rollup stopped for longer than the window leaves no points, which alone
  // reads as never run.
  it("dates each plan's last week when the window holds none of its rows", async () => {
    await rollupTiers(new Date("2032-06-09T12:00:00Z"));
    const series = await tierSeries(1, new Date("2032-12-20T12:00:00Z"));
    const premium = series.find((row) => row.planId === "premium")!;
    expect(premium.points).toEqual([]);
    expect(premium.lastWeek).toBe("2032-06-07");
  });
});

describe("adminUsers", () => {
  it("hands the Users tab each plan's weekly series", async () => {
    await rollupTiers(WEDNESDAY);
    const { tiers, thisWeek } = await adminUsers(WEDNESDAY);
    expect(tiers).toEqual(await tierSeries(26, WEDNESDAY));
    // What every card compares its newest week with to say "now" or "as of".
    expect(thisWeek).toBe("2031-03-10");
    expect(tiers.find((row) => row.planId === "premium")!.points.at(-1)!.weekStart).toBe("2031-03-10");
  });
});
