import { describe, expect, it } from "vitest";
import { parseBundle, type BundlePlaybook, type ContentBundleV1 } from "./schema.ts";
import { bandOf, lintBundle, seasonOf, summarise, totalMinor } from "./lint.ts";

// Each rule, fired on purpose.
//
// `content.test.ts` runs the same lint over the checked-in bundles and asserts
// it finds NOTHING — which is the answer you want and the answer a lint that
// checks nothing also gives. These are the other half: every rule shown
// catching the thing it was written for, so a rule deleted or inverted by a
// later edit fails here rather than passing quietly there.

const TODAY = "2026-09-06";

const stop = (over: Record<string, unknown> = {}) => ({
  title: "A stop",
  timeWindow: { start: "09:00", end: "10:00" },
  location: { name: "Somewhere", city: "Lisbon" },
  ...over,
});

const playbook = (over: Partial<BundlePlaybook> = {}): unknown => ({
  key: "a-day",
  name: "A day",
  ownerId: "dev-carlos",
  visibility: "public",
  keptOn: "2026-04-12T09:00:00.000Z",
  sourceTrip: { name: "A trip" },
  addedBy: [{ addedBy: "dev-priya" }],
  stops: [stop({ cost: { amountMinor: 1_000, currency: "USD" } })],
  ...over,
});

const bundleWith = (over: Record<string, unknown>): ContentBundleV1 =>
  parseBundle({
    $schema: "travel-collab/content-bundle/v1",
    bundle: { id: "test", name: "Test", origin: "ai" },
    ...over,
  });

const messages = (bundle: ContentBundleV1) => lintBundle(bundle, TODAY).map((f) => `${f.severity}: ${f.message}`);

describe("lintBundle", () => {
  it("passes a well-formed bundle", () => {
    expect(lintBundle(bundleWith({ playbooks: [playbook()] }), TODAY)).toEqual([]);
  });

  // `keptOn` seeds `created_at`/`published_at` and Discover's "newest" sorts on
  // them — a day created in the future is the freshest-looking thing in a fresh
  // database. CodeRabbit found this three times in one file on PR 104.
  it("refuses a keptOn in the future", () => {
    const findings = messages(bundleWith({ playbooks: [playbook({ keptOn: "2027-01-01T00:00:00.000Z" })] }));
    expect(findings).toContainEqual(expect.stringContaining("is in the future"));
    expect(findings[0]).toMatch(/^error/);
  });

  // "Copying your own day into your own trip does not count" — the ledger rule
  // the leaderboard's credibility rests on.
  it("refuses an author in their own adds ledger", () => {
    const findings = messages(
      bundleWith({ playbooks: [playbook({ addedBy: [{ addedBy: "dev-carlos" }] })] }),
    );
    expect(findings).toContainEqual(expect.stringContaining("their own adds ledger"));
  });

  // `saved_day_adds` is keyed on (saved_day_id, trip_id): two adds naming one
  // trip collapse into one row and the day quietly loses a count.
  it("refuses two adds naming the same trip", () => {
    const tripId = "11111111-1111-4111-8111-111111111111";
    const findings = messages(
      bundleWith({
        playbooks: [playbook({ addedBy: [{ tripId, addedBy: "dev-priya" }, { tripId, addedBy: "dev-maeve" }] })],
      }),
    );
    expect(findings).toContainEqual(expect.stringContaining("the same tripId"));
  });

  // Written order IS the order a person sees: the Day-columns lens and the
  // calendar render `day.activityIds` verbatim.
  it("refuses stops written out of chronological order", () => {
    const findings = messages(
      bundleWith({
        playbooks: [
          playbook({
            stops: [
              stop({ title: "Dinner", timeWindow: { start: "20:00", end: "21:30" } }),
              stop({ title: "Breakfast", timeWindow: { start: "08:00", end: "09:00" } }),
            ],
          }),
        ],
      }),
    );
    expect(findings).toContainEqual(expect.stringContaining("before \"Dinner\" ends"));
  });

  // `savedDayFacts` refuses to sum a day whose priced stops disagree, so the
  // card shows "—" and the budget filter cannot see it.
  it("refuses a day that mixes currencies", () => {
    const findings = messages(
      bundleWith({
        playbooks: [
          playbook({
            stops: [
              stop({ cost: { amountMinor: 1_000, currency: "USD" } }),
              stop({ title: "Later", timeWindow: { start: "11:00", end: "12:00" }, cost: { amountMinor: 900, currency: "EUR" } }),
            ],
          }),
        ],
      }),
    );
    expect(findings).toContainEqual(expect.stringContaining("mixes currencies"));
  });

  it("refuses a duplicate key inside one bundle", () => {
    const findings = messages(bundleWith({ playbooks: [playbook(), playbook({ name: "Another" })] }));
    expect(findings).toContainEqual(expect.stringContaining("duplicate key"));
  });

  // Warnings, not errors: each is a real state the product renders, and one a
  // content author may have meant.
  it("warns about a stop with no city, and a published day with nothing priced", () => {
    const noCity = messages(
      bundleWith({ playbooks: [playbook({ stops: [stop({ location: { name: "Somewhere" } })] })] }),
    );
    expect(noCity).toContainEqual(expect.stringContaining("warning"));
    expect(noCity).toContainEqual(expect.stringContaining("no location.city"));

    const unpriced = messages(bundleWith({ playbooks: [playbook({ stops: [stop()] })] }));
    expect(unpriced).toContainEqual(expect.stringContaining("nothing priced"));
    expect(unpriced.every((m) => m.startsWith("warning"))).toBe(true);
  });

  it("refuses a backlog item with a time window, and warns about an empty day", () => {
    const trip = {
      key: "a-trip",
      name: "A trip",
      startsInDays: 10,
      days: [{ label: "Day one", stops: [stop()] }, { label: "Day two", stops: [] }],
      backlog: [stop({ title: "Parked" })],
    };
    const findings = messages(bundleWith({ trips: [trip] }));
    expect(findings).toContainEqual(expect.stringContaining("carries a time window"));
    expect(findings).toContainEqual(expect.stringContaining('"Day two" has no stops'));
  });
});

describe("the report's derivations", () => {
  // Discover's `BUDGET_BAND_EDGES` — restated in `lint.ts` because `apps/web`
  // is downstream. The edges are the boundary cases, so they are what is
  // asserted.
  it("puts a total in the band Discover would", () => {
    expect(bandOf(19_999)).toBe("under200");
    expect(bandOf(20_000)).toBe("200to500");
    expect(bandOf(49_999)).toBe("200to500");
    expect(bandOf(50_000)).toBe("500to1000");
    expect(bandOf(99_999)).toBe("500to1000");
    expect(bandOf(100_000)).toBe("over1000");
  });

  it("buckets a keptOn into the season Discover would", () => {
    expect(seasonOf("2026-01-15T00:00:00.000Z")).toBe("winter");
    expect(seasonOf("2026-12-15T00:00:00.000Z")).toBe("winter");
    expect(seasonOf("2026-04-15T00:00:00.000Z")).toBe("spring");
    expect(seasonOf("2026-07-15T00:00:00.000Z")).toBe("summer");
    expect(seasonOf("2026-10-15T00:00:00.000Z")).toBe("autumn");
  });

  it("sums only the priced stops, and reports a currency disagreement", () => {
    expect(totalMinor([stop(), stop({ cost: { amountMinor: 250, currency: "USD" } })])).toEqual({
      total: 250,
      currency: "USD",
      mixed: false,
    });
    expect(
      totalMinor([
        stop({ cost: { amountMinor: 250, currency: "USD" } }),
        stop({ cost: { amountMinor: 100, currency: "EUR" } }),
      ]).mixed,
    ).toBe(true);
  });

  // Only PUBLISHED days occupy a bucket: a private day fills no slot in a
  // filter that never returns it.
  it("counts seasons and bands over published days only", () => {
    const bundle = bundleWith({
      playbooks: [
        playbook({ key: "public-day" }),
        playbook({ key: "private-day", visibility: "private", keptOn: "2026-07-01T00:00:00.000Z" }),
      ],
    });
    const summary = summarise([bundle]);
    expect(summary.playbooks).toBe(2);
    expect(summary.publicPlaybooks).toBe(1);
    expect(summary.seasons).toEqual({ winter: 0, spring: 1, summer: 0, autumn: 0 });
    expect(summary.authorKinds).toEqual({ ai: 2 });
  });
});
