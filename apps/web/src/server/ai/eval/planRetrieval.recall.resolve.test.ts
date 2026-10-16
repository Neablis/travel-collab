// Unit tests for Gate 1 label name → id resolution (RAG stack, Part 3).
// The database is mocked: these tests prove the resolution logic (exact-name
// match, missing → throw, ambiguous → throw), not the SQL itself.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveLabelIds } from "./planRetrieval.recall.resolve";

vi.mock("@/server/db/client", () => ({
  db: {
    execute: vi.fn(),
  },
}));

import { db } from "@/server/db/client";

const mockExecute = vi.mocked(db.execute);

function mockRows(rows: { id: string }[]) {
  mockExecute.mockResolvedValueOnce({ rows } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
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
  });

  it("resolves a trip name to its trip_details id", async () => {
    mockRows([{ id: "trip-uuid-1" }]);
    const result = await resolveLabelIds([
      { id: "q-02", labels: [{ sourceType: "trip", sourceName: "Japan (recall eval)", dayIndex: 3 }] },
    ]);
    expect(result.get("q-02")).toEqual([
      { sourceType: "trip", sourceId: "trip-uuid-1", dayIndex: 3 },
    ]);
    expect(mockExecute).toHaveBeenCalledTimes(1);
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
