// Unit tests for Gate 1 label name → id resolution (RAG stack, Part 3).
// The database is mocked: these tests prove the resolution logic (exact-name
// match, missing → throw, ambiguous → throw), not the SQL itself.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveLabelIds, resolveTestSourceIds } from "./planRetrieval.recall.resolve";
import { JAPAN_TRIP_NAME } from "./planRetrieval.recall.dataset";

vi.mock("@/server/db/client", () => ({
  db: {
    execute: vi.fn(),
  },
}));

import { db } from "@/server/db/client";

const mockExecute = vi.mocked(db.execute);

function mockRows(rows: { id: string; name?: string }[]) {
  mockExecute.mockResolvedValueOnce({ rows } as never);
}

/** Extract the raw SQL text from a drizzle `sql` template for assertion, recursing into nested `sql.join` fragments. Bound parameters appear as plain strings in the chunks and are included. */
function sqlText(query: unknown): string {
  const chunks = (query as { queryChunks: unknown[] }).queryChunks;
  return chunks
    .map((c) => {
      if (typeof c === "string") return c;
      if (typeof c !== "object" || c === null) return "";
      if ("value" in c) return (c.value as string[]).join("");
      if ("queryChunks" in c) return sqlText(c);
      return "";
    })
    .join("");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("resolveLabelIds", () => {
  it("resolves a playbook name to its saved_days id", async () => {
    mockRows([{ id: "playbook-uuid-1" }]);
    const result = await resolveLabelIds([
      { id: "q-01", labels: [{ sourceType: "playbook", sourceName: "Some Playbook", dayIndex: 0 }] },
    ]);
    expect(result.get("q-01")).toEqual([
      { sourceType: "playbook", sourceId: "playbook-uuid-1", dayIndex: 0 },
    ]);
    expect(mockExecute).toHaveBeenCalledTimes(1);
    // The playbook branch must query saved_days, not trip_details.
    expect(sqlText(mockExecute.mock.calls[0]?.[0])).toContain("saved_days");
  });

  it("resolves a trip name to its trip_details id", async () => {
    mockRows([{ id: "trip-uuid-1" }]);
    const result = await resolveLabelIds([
      { id: "q-02", labels: [{ sourceType: "trip", sourceName: JAPAN_TRIP_NAME, dayIndex: 3 }] },
    ]);
    expect(result.get("q-02")).toEqual([
      { sourceType: "trip", sourceId: "trip-uuid-1", dayIndex: 3 },
    ]);
    expect(mockExecute).toHaveBeenCalledTimes(1);
    // The trip branch must query trip_details, not saved_days.
    expect(sqlText(mockExecute.mock.calls[0]?.[0])).toContain("trip_details");
  });

  it("throws listing the name when nothing matches", async () => {
    mockRows([]);
    await expect(
      resolveLabelIds([
        { id: "q-03", labels: [{ sourceType: "playbook", sourceName: "No Such Playbook", dayIndex: 0 }] },
      ]),
    ).rejects.toThrow('q-03: no playbook named "No Such Playbook"');
  });

  it("throws listing the ids when a name is ambiguous", async () => {
    mockRows([{ id: "id-a" }, { id: "id-b" }]);
    await expect(
      resolveLabelIds([
        { id: "q-04", labels: [{ sourceType: "trip", sourceName: "Dupe Trip", dayIndex: 0 }] },
      ]),
    ).rejects.toThrow('ambiguous trip name "Dupe Trip" (2 rows: id-a, id-b)');
  });

  it("ambiguity on the Japan trip suggests RECALL_EVAL_JAPAN_TRIP_ID", async () => {
    // Mitchell, 2026-10-16: trip titles are not unique — production has two
    // "Japan: Tokyo → Kyoto → Osaka" rows. The error must point at the id
    // pin, not just list the duplicate ids.
    mockRows([{ id: "id-a" }, { id: "id-b" }]);
    await expect(
      resolveLabelIds([
        { id: "q-04b", labels: [{ sourceType: "trip", sourceName: JAPAN_TRIP_NAME, dayIndex: 0 }] },
      ]),
    ).rejects.toThrow("RECALL_EVAL_JAPAN_TRIP_ID");
  });

  it("RECALL_EVAL_JAPAN_TRIP_ID pins the id and skips the name lookup", async () => {
    // With the pin set, the resolver verifies the id exists (one cheap
    // SELECT 1) but never queries by name — duplicate titles cannot
    // misresolve, because there is no name lookup to be ambiguous.
    vi.stubEnv("RECALL_EVAL_JAPAN_TRIP_ID", "pinned-japan-id");
    mockRows([{ id: "pinned-japan-id" }]); // existence check finds the trip
    const result = await resolveLabelIds([
      { id: "q-04c", labels: [{ sourceType: "trip", sourceName: JAPAN_TRIP_NAME, dayIndex: 2 }] },
    ]);
    expect(result.get("q-04c")).toEqual([
      { sourceType: "trip", sourceId: "pinned-japan-id", dayIndex: 2 },
    ]);
    expect(mockExecute).toHaveBeenCalledTimes(1);
    const queried = sqlText(mockExecute.mock.calls[0]?.[0]);
    expect(queried).toContain("SELECT 1");
    expect(queried).not.toContain("doc->>'name'");
  });

  it("a pinned id that matches nothing fails loud", async () => {
    // A typo'd pin must not silently zero the 5 Japan queries — the
    // resolver's fail-loud contract covers the pin too.
    vi.stubEnv("RECALL_EVAL_JAPAN_TRIP_ID", "typo-id");
    mockRows([]); // existence check finds nothing
    await expect(
      resolveLabelIds([
        { id: "q-04e", labels: [{ sourceType: "trip", sourceName: JAPAN_TRIP_NAME, dayIndex: 0 }] },
      ]),
    ).rejects.toThrow('RECALL_EVAL_JAPAN_TRIP_ID="typo-id" matches no trip');
  });

  it("the pin does not apply to non-Japan trip labels", async () => {
    // The env var is scoped to the Japan trip name; any other trip label
    // still resolves by name lookup.
    vi.stubEnv("RECALL_EVAL_JAPAN_TRIP_ID", "pinned-japan-id");
    mockRows([{ id: "other-trip-id" }]);
    const result = await resolveLabelIds([
      { id: "q-04d", labels: [{ sourceType: "trip", sourceName: "Some Other Trip", dayIndex: 0 }] },
    ]);
    expect(result.get("q-04d")).toEqual([
      { sourceType: "trip", sourceId: "other-trip-id", dayIndex: 0 },
    ]);
    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(sqlText(mockExecute.mock.calls[0]?.[0])).toContain("trip_details");
  });

  it("resolves multiple queries independently and fails loud on any miss", async () => {
    mockRows([{ id: "ok-1" }]);
    mockRows([]);
    await expect(
      resolveLabelIds([
        { id: "q-05", labels: [{ sourceType: "playbook", sourceName: "Good", dayIndex: 0 }] },
        { id: "q-06", labels: [{ sourceType: "playbook", sourceName: "Missing", dayIndex: 0 }] },
      ]),
    ).rejects.toThrow('q-06: no playbook named "Missing"');
  });

  it("red-first: would fail if resolution returned the name as the id", async () => {
    // Guard against a regression where the resolver passes names through as
    // ids: the resolved sourceId must be the database id, not the name.
    mockRows([{ id: "real-uuid" }]);
    const result = await resolveLabelIds([
      { id: "q-07", labels: [{ sourceType: "playbook", sourceName: "Some Playbook", dayIndex: 0 }] },
    ]);
    expect(result.get("q-07")?.[0]?.sourceId).not.toBe("Some Playbook");
    expect(result.get("q-07")?.[0]?.sourceId).toBe("real-uuid");
  });
});

describe("resolveTestSourceIds", () => {
  it("returns playbook and trip ids whose names match test patterns", async () => {
    mockRows([{ id: "playbook-test-1", name: "TEST DELETE ME" }]);
    mockRows([
      { id: "trip-test-1", name: "TEST throwaway trip" },
      { id: "trip-test-2", name: "My delete me draft" },
    ]);
    const result = await resolveTestSourceIds();
    expect(result).toEqual([
      { id: "playbook-test-1", name: "TEST DELETE ME", sourceType: "playbook" },
      { id: "trip-test-1", name: "TEST throwaway trip", sourceType: "trip" },
      { id: "trip-test-2", name: "My delete me draft", sourceType: "trip" },
    ]);
    expect(mockExecute).toHaveBeenCalledTimes(2);
    const [playbookSql, tripSql] = mockExecute.mock.calls.map((c) => sqlText(c[0]));
    expect(playbookSql).toContain("saved_days");
    expect(playbookSql).toContain("ILIKE");
    expect(tripSql).toContain("trip_details");
    expect(tripSql).toContain("ILIKE");
  });

  it("returns an empty list when nothing matches (no exclusion)", async () => {
    mockRows([]);
    mockRows([]);
    const result = await resolveTestSourceIds();
    expect(result).toEqual([]);
  });

  it("red-first: would fail if the patterns were matched case-sensitively", async () => {
    // The ILIKE assertions above pin case-insensitive matching: a LIKE-only
    // implementation would miss "test delete me" and silently keep test trips
    // in the eval corpus. toContain("ILIKE") is the whole check — a bare LIKE
    // cannot satisfy it.
    mockRows([{ id: "x" }]);
    mockRows([{ id: "y" }]);
    await resolveTestSourceIds();
    const sqls = mockExecute.mock.calls.map((c) => sqlText(c[0]));
    expect(sqls).toHaveLength(2);
    for (const s of sqls) {
      expect(s).toContain("ILIKE");
    }
  });

  it("red-first: must not use a bare %TEST% pattern (false-positives on Testaccio)", async () => {
    // Mitchell's real Rome trip is "Rome: the Forum at opening, Testaccio at
    // lunch, Trastevere after dark" — "Testaccio" contains "test". A %TEST%
    // pattern would wrongly exclude it from the eval corpus. Both actual test
    // trips are still covered: "TEST DELETE ME" via %delete me%,
    // "TEST throwaway trip - delete me" via %throwaway% (and %delete me%).
    mockRows([]);
    mockRows([]);
    await resolveTestSourceIds();
    const sqls = mockExecute.mock.calls.map((c) => sqlText(c[0]));
    expect(sqls).toHaveLength(2);
    for (const s of sqls) {
      expect(s).not.toContain("%TEST%");
      expect(s).toContain("%delete me%");
      expect(s).toContain("%throwaway%");
    }
  });
});
